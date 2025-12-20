const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { initDatabase, query } = require('./db');
const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const profilesRoutes = require('./routes/profiles');
const chatroomsRoutes = require('./routes/chatrooms');
const moderationRoutes = require('./routes/moderation');
const tagsRoutes = require('./routes/tags');
const friendsRoutes = require('./routes/friends');
const commentsRoutes = require('./routes/comments');
const usersRoutes = require('./routes/users');
const chatHandler = require('./socketHandlers/chat');
const { allowGuestSocket } = require('./middleware/auth');
const botService = require('./services/botService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Trust proxy - Required for Railway/Heroku/etc to get real client IP for rate limiting
app.set('trust proxy', 1);

// Middleware
app.use(express.json({ limit: '10mb' })); // Support Base64 images
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Session configuration
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
});

app.use(sessionMiddleware);

// Bot counter for moderation dashboard
global.botRequestCount = 0;

// IP Ban System - tracks violations and temporarily bans repeat offenders
const ipBans = new Map(); // { ip: { bannedUntil: timestamp, violations: count } }
const ipViolations = new Map(); // { ip: [timestamps] }

// Check if IP is banned
const isBanned = (ip) => {
  const ban = ipBans.get(ip);
  if (!ban) return false;

  if (Date.now() > ban.bannedUntil) {
    // Ban expired, remove it
    ipBans.delete(ip);
    return false;
  }

  return true;
};

// Record a rate limit violation and potentially ban the IP
const recordViolation = (ip) => {
  const now = Date.now();
  const violations = ipViolations.get(ip) || [];

  // Keep only violations from last 5 minutes
  const recentViolations = violations.filter(time => now - time < 5 * 60 * 1000);
  recentViolations.push(now);
  ipViolations.set(ip, recentViolations);

  // Ban if 5+ violations in 5 minutes
  if (recentViolations.length >= 5) {
    const banDuration = 15 * 60 * 1000; // 15 minute ban
    const existingBan = ipBans.get(ip) || { violations: 0 };

    ipBans.set(ip, {
      bannedUntil: now + banDuration,
      violations: existingBan.violations + 1
    });

    console.log(`[SECURITY] IP ${ip} temporarily banned for ${banDuration / 60000} minutes (${recentViolations.length} violations)`);

    // Clear violations since we've banned them
    ipViolations.delete(ip);
  }
};

// IP ban check middleware - blocks banned IPs immediately
app.use((req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (isBanned(ip)) {
    const ban = ipBans.get(ip);
    const minutesLeft = Math.ceil((ban.bannedUntil - Date.now()) / 60000);

    console.log(`[SECURITY] Blocked request from banned IP: ${ip} (${minutesLeft} minutes remaining)`);

    return res.status(403).sendFile(path.join(__dirname, '../public/403.html'));
  }

  next();
});

// Simple request logger - shows visitor activity in Railway logs (no database storage)
app.use((req, res, next) => {
  // Skip logging for static assets (CSS, JS, images) and API health checks
  const isStaticAsset = req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2)$/);
  const isHealthCheck = req.path === '/health' || req.path === '/api/health';

  if (!isStaticAsset && !isHealthCheck) {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Detect bots by user agent
    const isBot = /bot|crawler|spider|scraper|scanner|curl|wget|python-requests/i.test(userAgent);

    // Detect exploit scanning attempts
    const isScannerPath = /wp-admin|wp-content|\.env|config\.json|\.git|admin\.php|phpinfo|\.sql|backup|database/i.test(req.path);

    // Log to console for Railway logs (simple format)
    console.log(`[${timestamp}] ${req.method} ${req.path} | IP: ${ip}${isBot ? ' [BOT]' : ''}${isScannerPath ? ' [SCANNER]' : ''}`);

    if (isBot || isScannerPath) {
      // Just increment bot counter for stats
      global.botRequestCount++;
    }
  }
  next();
});

// Share session with Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Allow guest access for Socket.io
io.use(allowGuestSocket);

// Custom rate limit handler - returns JSON for API, redirects for pages
const rateLimitHandler = (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const resetTime = Math.floor(Date.now() / 1000) + Math.floor((req.rateLimit.resetTime - Date.now()) / 1000);
  const waitSeconds = Math.floor((req.rateLimit.resetTime - Date.now()) / 1000);

  // Record this violation for potential IP banning
  recordViolation(ip);

  // Check if this is an API request (check both path and originalUrl to be safe)
  const isApiRequest = req.originalUrl?.startsWith('/api/') || req.url?.startsWith('/api/') || req.path?.startsWith('/api/');

  // API requests get JSON response
  if (isApiRequest) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: waitSeconds,
      resetTime: resetTime
    });
  }

  // Page requests get redirected
  res.redirect(`/429.html?reset=${resetTime}`);
};

// Rate limiting - General API protection
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 API requests per 15 minutes (~13 req/min)
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Rate limiting - Strict for auth endpoints (prevents brute force)
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 login attempts per minute
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: rateLimitHandler,
});

// Rate limiting - GLOBAL burst protection (catches rapid-fire attacks)
const globalBurstLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 50, // 50 requests per second per IP (allows page loads)
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Rate limiting - GLOBAL sustained protection (catches prolonged attacks)
const globalSustainedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP (prevents sustained abuse)
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Apply BOTH global limiters to ALL routes (dual-layer infrastructure protection)
app.use(globalBurstLimiter);
app.use(globalSustainedLimiter);

// Apply general rate limiting to all API routes
app.use('/api/', apiLimiter);

// Protect moderation.html - redirect unauthorized users to 403
app.get('/moderation.html', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/403.html');
  }

  try {
    const result = await query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.redirect('/403.html');
    }

    res.sendFile(path.join(__dirname, '../public/moderation.html'));
  } catch (error) {
    console.error('Moderation page auth error:', error);
    res.redirect('/403.html');
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', usersRoutes);

// Set Socket.io for posts route (for live feed)
postsRoutes.setSocketIO(io);
app.use('/api/posts', postsRoutes); // Post creation limiter applied in routes file

app.use('/api/profiles', profilesRoutes);
app.use('/api/chatrooms', chatroomsRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/friends', friendsRoutes);

// Set Socket.io for comments route (for real-time comments)
commentsRoutes.setSocketIO(io);
app.use('/api/comments', commentsRoutes);

// Socket.io connection handler
chatHandler(io);

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler - must be last route
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

// Initialize database and start server
const startServer = async () => {
  try {
    await initDatabase();
    console.log('Database initialized');

    // Pass Socket.io instance to bot service for live updates
    botService.setSocketIO(io);

    // Start bot service
    await botService.start();

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server, io };
