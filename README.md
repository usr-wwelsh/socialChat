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

- **Runtime**: Bun
- **Backend**: Express, Socket.io
- **Database**: SQLite (default) · PostgreSQL (optional, set `DATABASE_URL=postgresql://...`)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Auth**: bcryptjs password hashing, express-session

## Setup

1. Install dependencies:
```bash
bun install
```

2. Start the server:
```bash
bun start
# or for development with auto-reload
bun dev
```

3. Open http://localhost:3000

The SQLite database file is created automatically at `./db` on first run. To use a custom path:
```bash
SQLITE_PATH=/path/to/db bun start
```

### PostgreSQL (optional)

Set `DATABASE_URL=postgresql://...` and the app switches to PostgreSQL automatically.

## Deployment (Railway)

1. Push this repo to Railway
2. Add a **Volume** service, mount path `/data`
3. Set env var: `SQLITE_PATH=/data/db`
4. Upload your existing `db` file to the volume at `/data/db`
