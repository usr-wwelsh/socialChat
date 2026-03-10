# 1socialChat Setup Guide

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up PostgreSQL Database

#### Option A: Using psql command line

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE socialchat;

# Exit psql
\q
```

#### Option B: Using PostgreSQL GUI (pgAdmin, etc.)

Create a new database named `socialchat`

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update with your database credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgresql://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/socialchat
PORT=3000
SESSION_SECRET=your-random-secret-key-here
NODE_ENV=development
```

**Important:** Change `SESSION_SECRET` to a random string for security!

### 4. Initialize Database Schema

The database schema will be automatically initialized when you first run the server. The schema includes:

- Users table with authentication
- Posts table with media support
- Chatrooms table
- Chat messages table
- Post reactions table

### 5. Start the Development Server

```bash
npm start
```

Or with auto-reload:

```bash
npm run dev
```

The server will start at `http://localhost:3000`

### 6. Create Your First Account

1. Navigate to `http://localhost:3000`
2. You'll be redirected to the login page
3. Click "Register here"
4. Create your account with a username and password
5. Start posting and chatting!

## Deployment to Railway

### 1. Prepare for Railway

Railway has great PostgreSQL support and will handle most configuration automatically.

### 2. Create a New Railway Project

1. Go to https://railway.app/
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account and select your repository

### 3. Add PostgreSQL Database

1. In your Railway project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway will create a PostgreSQL instance

### 4. Configure Environment Variables

Railway will automatically set `DATABASE_URL` from the PostgreSQL plugin.

Add these additional variables in Railway dashboard:

```
SESSION_SECRET=your-random-secret-key-here
NODE_ENV=production
```

### 5. Deploy

Railway will automatically:
- Install dependencies
- Run the schema initialization
- Start your server

Your app will be live at a Railway-provided URL!

## Features

### Authentication
- Username/password registration
- Secure password hashing with bcrypt
- Session-based authentication

### User Profiles
- Customizable profile pictures
- Bio and links
- User post history

### Posts
- Text posts with up to 5000 characters
- Image uploads (Base64, 10MB limit)
- Video uploads (Base64, 10MB limit)
- Edit and delete your own posts
- Post reactions (likes)

### Real-time Chat
- Global chatroom (always available)
- Create custom chatrooms
- Real-time messaging with Socket.io
- Typing indicators
- Delete your own messages
- Clickable usernames link to profiles

### UI Features
- Responsive design
- Solaris CDE-inspired dark theme
- Expandable chat window
- Scrollable posts feed
- Real-time updates

## Project Structure

```
1socialChat/
├── server/
│   ├── index.js              # Express server + Socket.io
│   ├── db.js                 # PostgreSQL connection
│   ├── schema.sql            # Database schema
│   ├── middleware/
│   │   └── auth.js           # Authentication middleware
│   ├── routes/
│   │   ├── auth.js           # Auth endpoints
│   │   ├── posts.js          # Posts CRUD
│   │   ├── profiles.js       # User profiles
│   │   └── chatrooms.js      # Chatroom management
│   └── socketHandlers/
│       └── chat.js           # Real-time chat logic
├── public/
│   ├── index.html            # Main feed page
│   ├── login.html            # Login page
│   ├── register.html         # Registration page
│   ├── profile.html          # User profile page
│   ├── css/
│   │   └── style.css         # Application styles
│   └── js/
│       ├── app.js            # Main app logic
│       ├── auth.js           # Authentication handling
│       ├── posts.js          # Posts feed functionality
│       ├── chat.js           # Real-time chat
│       └── profile.js        # Profile page logic
├── package.json
├── .env                      # Environment variables (not in git)
└── README.md
```

## Troubleshooting

### Database Connection Issues

If you see "database does not exist":
```bash
createdb socialchat
```

If you see authentication errors:
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

If images/videos don't upload:
- Check file size (must be under 10MB)
- Check file format (images: jpg, png, gif, etc. / videos: mp4, webm, etc.)

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Posts
- `GET /api/posts` - Get all posts
- `GET /api/posts/:id` - Get single post
- `POST /api/posts` - Create post
- `PUT /api/posts/:id` - Update post
- `DELETE /api/posts/:id` - Delete post
- `POST /api/posts/:id/react` - React to post
- `DELETE /api/posts/:id/react/:type` - Remove reaction

### Profiles
- `GET /api/profiles/:username` - Get user profile
- `PUT /api/profiles/me` - Update own profile

### Chatrooms
- `GET /api/chatrooms` - Get all chatrooms
- `GET /api/chatrooms/:id/messages` - Get messages
- `POST /api/chatrooms` - Create chatroom
- `DELETE /api/chatrooms/:id` - Delete chatroom
- `DELETE /api/chatrooms/:id/messages/:messageId` - Delete message

### Socket.io Events

**Client → Server:**
- `join_chatroom` - Join a chatroom
- `leave_chatroom` - Leave a chatroom
- `send_message` - Send message
- `delete_message` - Delete message
- `typing` - User is typing
- `stop_typing` - User stopped typing

**Server → Client:**
- `joined_chatroom` - Confirmation of join
- `new_message` - New message received
- `message_deleted` - Message was deleted
- `user_typing` - Another user is typing
- `user_stop_typing` - User stopped typing
- `error` - Error message

## Next Steps

Consider adding:
- Password reset functionality
- Email verification
- Direct messages between users
- Post comments
- Image/video optimization
- Cloud storage for media (S3, Cloudinary)
- Rate limiting
- Content moderation
- Search functionality
- Hashtags
- User following/followers
- Notifications

## Support

For issues, questions, or feature requests, create an issue in the GitHub repository.

## License

MIT