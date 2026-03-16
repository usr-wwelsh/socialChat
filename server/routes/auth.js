const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth, allowGuest } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

// Register new user
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // Validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Check if username contains only valid characters
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
  }

  try {
    // Check if username already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert new user
    const result = await query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );

    const user = result.rows[0];

    // Clear guest session and set authenticated session
    delete req.session.isGuest;
    delete req.session.guestId;
    delete req.session.guestName;

    req.session.userId = user.id;
    req.session.username = user.username;

    // Auto-send friend request from 'admin' account (like Tom on MySpace!)
    try {
      const adminResult = await query(
        'SELECT id FROM users WHERE username = $1',
        ['admin']
      );

      if (adminResult.rows.length > 0) {
        const adminId = adminResult.rows[0].id;

        // Don't send friend request if the user IS admin
        if (user.id !== adminId) {
          // Order IDs properly (lower ID first)
          const [requesterId, receiverId] = user.id < adminId
            ? [user.id, adminId]
            : [adminId, user.id];

          // Send friend request from admin to new user
          await query(
            `INSERT INTO friendships (requester_id, receiver_id, status)
             VALUES ($1, $2, 'pending')
             ON CONFLICT (requester_id, receiver_id) DO NOTHING`,
            [requesterId, receiverId]
          );

          console.log(`Admin automatically sent friend request to new user: ${user.username}`);
        }
      }
    } catch (adminError) {
      // Don't fail registration if admin friend request fails
      console.error('Failed to send admin friend request:', adminError);
    }

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Find user
    const result = await query(
      'SELECT id, username, password_hash, bio, profile_picture, links, is_banned FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];

    // Check if user is banned
    if (user.is_banned) {
      return res.status(403).json({ error: 'Account has been banned. Contact support for details.' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Clear guest session and set authenticated session
    delete req.session.isGuest;
    delete req.session.guestId;
    delete req.session.guestName;

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        profile_picture: user.profile_picture,
        links: user.links
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logout successful' });
  });
});

// Check authentication status
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, bio, profile_picture, links, created_at, is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get session info (including admin status and guest status)
router.get('/session', allowGuest, async (req, res) => {
  // Check if user is a guest
  if (req.session.isGuest) {
    return res.json({
      isAuthenticated: false,
      isGuest: true,
      guestName: req.session.guestName,
      guestId: req.session.guestId
    });
  }

  if (!req.session.userId) {
    return res.json({ isAuthenticated: false, isGuest: false });
  }

  try {
    const result = await query(
      'SELECT id, username, is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ isAuthenticated: false, isGuest: false });
    }

    const user = result.rows[0];

    res.json({
      isAuthenticated: true,
      isGuest: false,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.is_admin
      }
    });
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
