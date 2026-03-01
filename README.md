# 1socialChat

A fullstack social media platform with real-time chatroom functionality.

<img width="1916" height="875" alt="Screenshot 2025-10-21 223928" src="https://github.com/user-attachments/assets/8a68ae15-97c0-46db-8d7e-b9902863b775" />

## Features

- User authentication (username/password)
- Customizable user profiles (bio, profile picture, links)
- Post text, images, and videos (up to 10MB)
- Edit and delete posts
- Real-time global chatroom
- User-created chatrooms
- Post reactions
- Clickable usernames linking to profiles

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Database**: PostgreSQL
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Auth**: bcrypt password hashing, express-session

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example` and configure your database connection.

3. Set up PostgreSQL database:
```bash
psql -U postgres
CREATE DATABASE socialchat;
```
   The database schema will be automatically initialized when the server starts.

4. Start the server:
```bash
npm start
# or for development with auto-reload
npm run dev
```

5. Open http://localhost:3000

## Deployment

Ready for Railway deployment with PostgreSQL plugin.
