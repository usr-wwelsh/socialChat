# socialChat Setup Guide

## Prerequisites

- Bun (v1.0 or higher) - [Installation Guide](https://bun.sh/docs/installation)
- PostgreSQL (v12 or higher) - (Optional, SQLite is default)

## Local Development Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up Database

#### Option A: SQLite (Default)

No setup needed. A `db` file will be created automatically on first run at `./db`.

To use a custom path for SQLite:

```bash
SQLITE_PATH=/path/to/your/db bun start
```

#### Option B: PostgreSQL (Optional)

**Set Up PostgreSQL Database**

1.  **Using psql command line:**

    ```bash
    # Connect to PostgreSQL
    psql -U postgres

    # Create database
    CREATE DATABASE socialchat;

    # Exit psql
    \q
    ```

2.  **Using PostgreSQL GUI (pgAdmin, etc.):**

    Create a new database named `socialchat`

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update as needed.

```bash
cp .env.example .env
```

Edit `.env`:

For PostgreSQL:

```
DATABASE_URL=postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/socialchat
```

For SQLite (optional, if using a custom path):

```
SQLITE_PATH=/path/to/your/db
```

Common variables:

```
PORT=3000
SESSION_SECRET=your-random-secret-key-here
NODE_ENV=development

# Optional: S3-Compatible Object Storage
# S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
# S3_BUCKET=your-bucket-name
# S3_ACCESS_KEY_ID=your-access-key-id
# S3_SECRET_ACCESS_KEY=your-secret-access-key
# S3_PUBLIC_URL=https://media.yourdomain.com
# S3_REGION=auto

# Optional: Google Gemini AI Key for Bots
# GEMINI_API_KEY=your-gemini-api-key-here
```

**Important:** Change `SESSION_SECRET` to a random string for security!

### 4. Initialize Database Schema

The database schema will be automatically initialized when you first run the server. It includes:

-   Users table with authentication & E2EE keys
-   Posts table with media support
-   Chatrooms table
-   Chat messages table
-   Direct message conversations & messages
-   Post reactions table
-   Friendships table
-   Tags table
-   Moderation tables
-   Bot activity tracking
-   Visitor analytics

### 5. Start the Development Server

```bash
bun start
```

Or for development with auto-reload:

```bash
bun dev
```

The server will start at `http://localhost:3000`

### 6. Create Your First Account

1.  Navigate to `http://localhost:3000`
2.  You'll be redirected to the login page
3.  Click "Register here"
4.  Create your account with a username and password
5.  Start posting and chatting!

## Deployment to Railway

### 1. Prepare for Railway

Railway has great PostgreSQL support and will handle most configuration automatically. If using SQLite, add a persistent volume.

### 2. Create a New Railway Project

1.  Go to https://railway.app/
2.  Click "New Project"
3.  Select "Deploy from GitHub repo"
4.  Connect your GitHub account and select your repository

### 3. Add PostgreSQL Database (Optional) / Volume (for SQLite)

-   **For PostgreSQL:** In your Railway project, click "New" > "Database" > "PostgreSQL". Railway will create an instance and set `DATABASE_URL`.
-   **For SQLite:** In your Railway project, click "New" > "Storage" > "Volume". Set mount path to `/data`. Then, in your app's environment variables, set `SQLITE_PATH=/data/db`.

### 4. Configure Environment Variables

Railway will automatically set `DATABASE_URL` (for Postgres) or you set `SQLITE_PATH` (for SQLite).

Add these additional variables in Railway dashboard:

```
SESSION_SECRET=your-random-secret-key-here
NODE_ENV=production
```

**Optional S3 / Gemini Keys (from .env):** If you use S3 or the AI bot service, ensure those `S3_` and `GEMINI_API_KEY` environment variables are also set in Railway.

### 5. Deploy

Railway will automatically:
-   Install dependencies
-   Run the schema initialization
-   Start your server

Your app will be live at a Railway-provided URL!

## Features

### Authentication
-   Username/password registration
-   Secure password hashing with bcrypt
-   Session-based authentication
-   End-to-end encrypted direct messages with client-side key derivation (ECDH + AES-GCM)

### User Profiles
-   Customizable profile pictures
-   Bio and links
-   User post history
-   Friend system with requests and accepted lists

### Posts
-   Text posts with up to 5000 characters
-   Image uploads (auto-compressed to WebP, 10MB limit)
-   Video uploads (10MB limit)
-   Audio uploads (20MB limit)
-   Edit and delete your own posts
-   Post reactions (likes)
-   Hashtags and user tagging
-   Link previews

### Real-time Chat
-   Global chatroom (always available)
-   Create custom chatrooms
-   Real-time messaging with Socket.io
-   Typing indicators
-   Delete your own messages
-   Clickable usernames link to profiles
-   Direct messages with friends (E2EE)

### Moderation & Bots
-   Admin moderation dashboard (reports, user bans, content removal)
-   Optional AI bot service with configurable personalities and posting styles

### Discovery
-   Global search for users and posts
-   Trending tags and trending posters

### UI Features
-   Responsive design with sidebar navigation and mobile bottom nav
-   Solaris CDE-inspired dark theme
-   Expandable chat window
-   Image lightbox with zoom & pan
-   Toast notifications
-   Scrollable posts feed
-   Real-time updates

## Project Structure

```
socialChat/
├── server/
│   ├── index.js              # Express server + Socket.io
│   ├── db.js                 # Database connection (PostgreSQL or SQLite)
│   ├── schema.sqlite.sql     # SQLite Database schema
│   ├── schema.postgres.sql   # PostgreSQL Database schema
│   ├── media.js              # Media handling (local filesystem or S3)
│   ├── services/
│   │   ├── botService.js     # AI Bot logic
│   │   └── backupService.js  # S3 SQLite backup scheduler
│   ├── scripts/              # Utility scripts for migration and backup restoration
│   │   ├── migrate-media-to-s3.js # Script to migrate local media to S3
│   │   └── restore-backup.js    # Script to restore SQLite database from S3
│   ├── middleware/
│   │   ├── auth.js           # Authentication middleware
│   │   ├── adminAuth.js      # Admin authentication middleware
│   │   └── upload.js         # Multipart form data upload middleware
│   ├── routes/
│   │   ├── auth.js           # Auth endpoints
│   │   ├── posts.js          # Posts CRUD
│   │   ├── profiles.js       # User profiles
│   │   ├── chatrooms.js      # Chatroom management
│   │   ├── friends.js        # Friend requests and management
│   │   ├── comments.js       # Post comments
│   │   ├── users.js          # User data export
│   │   ├── keys.js           # E2EE Key management
│   │   ├── dms.js            # Direct messages
│   │   ├── discovery.js      # Search, trending, link previews
│   │   └── moderation.js     # Admin moderation
│   └── socketHandlers/
│       └── chat.js           # Real-time chat & DM logic
├── public/
│   ├── index.html            # Main feed page
│   ├── login.html            # Login page
│   ├── register.html         # Registration page
│   ├── profile.html          # User profile page
│   ├── friends.html          # Friends list page
│   ├── moderation.html       # Admin moderation dashboard
│   ├── about.html            # About page
│   ├── css/
│   │   ├── style.css         # Application styles
│   │   └── moderation.css    # Moderation dashboard styles
│   └── js/
│       ├── app.js            # Main app logic
│       ├── auth.js           # Authentication handling
│       ├── posts.js          # Posts feed functionality
│       ├── chat.js           # Real-time chat
│       ├── dm.js             # Direct message logic
│       ├── crypto.js         # E2EE Web Crypto API implementation
│       ├── profile.js        # Profile page logic
│       ├── friends.js        # Friends page logic
│       ├── moderation.js     # Moderation page logic
│       └── toast.js          # Toast notifications
├── media/                    # Local media storage (if S3 not configured)
├── memory/                   # In-memory caches for bots (volatile)
├── package.json
├── bun.lockb
├── .env.example
├── .env                      # Environment variables (not in git)
└── README.md
```

## Troubleshooting

### Database Connection Issues

If you see "database does not exist" (PostgreSQL):
```bash
createdb socialchat
```

If you see authentication errors (PostgreSQL):
```bash
# Update DATABASE_URL in .env with correct credentials
DATABASE_URL=postgresql://username:password@localhost:5432/socialchat
```

### Port Already in Use

If port 3000 is busy, change PORT in `.env`:
```
PORT=3001
```

### Session Issues

If login doesn't work, make sure `SESSION_SECRET` is set in `.env`

### Media Upload Issues

If images/videos/audio don't upload:
-   Check file size (images/videos under 10MB, audio under 20MB)
-   Check file format (images: jpg, png, webp, gif / videos: mp4, webm / audio: mp3, wav, ogg, flac, m4a)
-   Check server logs for errors related to `sharp` or S3 configuration.

## API Endpoints

### Authentication
-   `POST /api/auth/register` - Register new user
-   `POST /api/auth/login` - Login
-   `POST /api/auth/logout` - Logout
-   `GET /api/auth/me` - Get current user

### Posts
-   `GET /api/posts` - Get all posts (feed)
-   `GET /api/posts/media` - Get posts with media only
-   `GET /api/posts/:id` - Get single post
-   `GET /api/posts/:id/media` - Get media URL for a specific post (deprecated, media_url is included in main post query)
-   `POST /api/posts` - Create post
-   `PUT /api/posts/:id` - Update post
-   `DELETE /api/posts/:id` - Delete post
-   `POST /api/posts/:id/react` - React to post
-   `DELETE /api/posts/:id/react/:type` - Remove reaction

### Profiles
-   `GET /api/profiles/:username` - Get user profile
-   `PUT /api/profiles/me` - Update own profile

### Chatrooms
-   `GET /api/chatrooms` - Get all chatrooms
-   `GET /api/chatrooms/:id/messages` - Get messages
-   `POST /api/chatrooms` - Create chatroom
-   `DELETE /api/chatrooms/:id` - Delete chatroom
-   `DELETE /api/chatrooms/:id/messages/:messageId` - Delete message

### Friendships
-   `GET /api/friends` - Get user's friends
-   `GET /api/friends/requests` - Get incoming friend requests
-   `GET /api/friends/sent` - Get sent friend requests
-   `GET /api/friends/status/:userId` - Get friendship status with another user
-   `POST /api/friends/request` - Send friend request
-   `PUT /api/friends/accept/:friendshipId` - Accept friend request
-   `PUT /api/friends/reject/:friendshipId` - Reject friend request
-   `DELETE /api/friends/:friendshipId` - Remove friend or cancel request

### E2EE Keys
-   `POST /api/keys` - Store public key and encrypted private key (one-time setup)
-   `GET /api/keys/me` - Fetch own encrypted private key blob
-   `GET /api/keys/user/:userId` - Fetch another user's public key
-   `PUT /api/keys/re-encrypt` - Update encrypted private key (e.g., after password change)

### Direct Messages (DMs)
-   `GET /api/dms/conversations` - List user's DM conversations
-   `POST /api/dms/conversations` - Create a new DM conversation with a friend
-   `GET /api/dms/conversation-with/:userId` - Check if DM conversation exists with a user
-   `GET /api/dms/conversations/:id/messages` - Fetch encrypted DM messages
-   `POST /api/dms/conversations/:id/messages` - Send an encrypted DM message

### Discovery
-   `GET /api/discovery/trending-posters` - Get users with most reactions recently
-   `GET /api/discovery/link-preview?url=` - Get OpenGraph link preview data for a URL
-   `GET /api/discovery/search?q=&type=all|users|posts` - Search for users or posts

### Moderation (Admin Only)
-   `GET /api/moderation/stats` - Get moderation statistics
-   `GET /api/moderation/reports` - Get content reports
-   `PUT /api/moderation/reports/:id/status` - Update report status
-   `POST /api/moderation/users/:userId/ban` - Ban user and delete content
-   `POST /api/moderation/users/:userId/unban` - Unban user
-   `DELETE /api/moderation/posts/:postId` - Delete post by ID
-   `DELETE /api/moderation/messages/:messageId` - Delete chat message by ID
-   `GET /api/moderation/users` - List all users with ban status
-   `GET /api/moderation/bot/list` - Get list of bot users and their config
-   `POST /api/moderation/bot/:username/picture` - Update a bot's profile picture
-   `POST /api/moderation/bot/trigger` - Force a bot to make a post
-   `POST /api/moderation/bot/burst` - Schedule a burst of bot posts

### User Data
-   `GET /api/users/export-data` - Export all user data (profile, posts, messages)

### Socket.io Events

**Client → Server (Chatrooms):**
-   `join_chatroom` - Join a public or user-created chatroom
-   `leave_chatroom` - Leave a chatroom
-   `send_message` - Send message to current chatroom
-   `delete_message` - Delete own chatroom message
-   `typing` - User is typing in chatroom
-   `stop_typing` - User stopped typing in chatroom

**Client → Server (Direct Messages):**
-   `join_dm` - Join a DM conversation room
-   `leave_dm` - Leave a DM conversation room
-   `dm_typing` - User is typing in DM conversation
-   `dm_stop_typing` - User stopped typing in DM conversation

**Server → Client (General):**
-   `new_post` - New post created (broadcast to all connected clients)
-   `post_deleted` - Post deleted (broadcast)
-   `post_updated` - Post updated (broadcast)
-   `user_updated` - User profile updated (broadcast)
-   `error` - General error message

**Server → Client (Chatrooms):**
-   `joined_chatroom` - Confirmation of joining a chatroom
-   `new_message` - New chatroom message received
-   `message_deleted` - Chatroom message was deleted
-   `user_typing` - Another user is typing in chatroom
-   `user_stop_typing` - User stopped typing in chatroom

**Server → Client (Direct Messages):**
-   `new_dm` - New encrypted DM message received for a joined conversation
-   `dm_notification` - Notification for new DM, triggers unread badge (sent to recipient's personal room `user_<id>`)
-   `dm_user_typing` - Another user is typing in DM conversation
-   `dm_user_stop_typing` - User stopped typing in DM conversation

## Next Steps

Consider adding:
-   Password reset functionality
-   Email verification
-   User following/followers
-   Notifications

## Support

For issues, questions, or feature requests, create an issue in the GitHub repository.

## License

MIT
