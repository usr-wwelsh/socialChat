-- SQLite Schema for 1socialChat
-- Consolidated from schema.sql + all migrations (for fresh SQLite installs only)
-- Existing db files are left untouched by initDatabase()

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    bio TEXT,
    profile_picture TEXT,
    links TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_admin BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    banned_at TIMESTAMP,
    banned_by INTEGER REFERENCES users(id),
    banned_reason TEXT,
    is_bot BOOLEAN DEFAULT FALSE,
    is_guest BOOLEAN DEFAULT FALSE,
    public_key TEXT,
    encrypted_private_key TEXT,
    key_salt TEXT
);

-- Posts table
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_type VARCHAR(20),
    media_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    visibility VARCHAR(20) DEFAULT 'public',
    audio_duration INTEGER,
    audio_format VARCHAR(10),
    audio_title VARCHAR(255),
    deleted_by_mod BOOLEAN DEFAULT FALSE,
    mod_delete_reason TEXT,
    genre VARCHAR(50),
    is_pinned BOOLEAN DEFAULT FALSE,
    quoted_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL
);

-- Chatrooms table
CREATE TABLE IF NOT EXISTS chatrooms (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_global BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    chatroom_id INTEGER NOT NULL REFERENCES chatrooms(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_by_mod BOOLEAN DEFAULT FALSE,
    guest_name VARCHAR(100),
    guest_id VARCHAR(100)
);

-- Post media table (multiple images per post, up to 10)
CREATE TABLE IF NOT EXISTS post_media (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id, position);

-- Post reactions table
CREATE TABLE IF NOT EXISTS post_reactions (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id, reaction_type)
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    report_type VARCHAR(20) NOT NULL,
    content_id INTEGER,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    display_order INTEGER DEFAULT 0,
    CONSTRAINT ensure_requester_less_than_receiver CHECK (requester_id < receiver_id),
    CONSTRAINT unique_friendship UNIQUE (requester_id, receiver_id)
);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT content_length CHECK (length(content) <= 2000)
);

-- Comment reactions table
CREATE TABLE IF NOT EXISTS comment_reactions (
    id INTEGER PRIMARY KEY,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comment_id, user_id, reaction_type)
);

-- Collections table
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    visibility VARCHAR(20) DEFAULT 'public',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Collection posts table
CREATE TABLE IF NOT EXISTS collection_posts (
    id INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    position INTEGER DEFAULT 0,
    UNIQUE(collection_id, post_id)
);

-- Saved posts table
CREATE TABLE IF NOT EXISTS saved_posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id)
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    use_count INTEGER DEFAULT 0
);

-- Post tags junction table
CREATE TABLE IF NOT EXISTS post_tags (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, tag_id)
);

-- Bot state table
CREATE TABLE IF NOT EXISTS bot_state (
    id INTEGER PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bot topics table
CREATE TABLE IF NOT EXISTS bot_topics (
    id INTEGER PRIMARY KEY,
    bot_username VARCHAR(50) NOT NULL,
    topic_keywords TEXT NOT NULL,
    post_content TEXT NOT NULL,
    link_category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bot configs table (DB-editable bot personalities)
CREATE TABLE IF NOT EXISTS bot_configs (
    id INTEGER PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    bio TEXT,
    personality TEXT NOT NULL,
    style VARCHAR(50) NOT NULL,
    topic_limit INTEGER DEFAULT 5,
    link_categories TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DM conversations table
CREATE TABLE IF NOT EXISTS dm_conversations (
    id INTEGER PRIMARY KEY,
    user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ensure_user1_less CHECK (user1_id < user2_id),
    CONSTRAINT unique_dm_pair UNIQUE (user1_id, user2_id)
);

-- DM messages table
CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Visitor logs table
CREATE TABLE IF NOT EXISTS visitor_logs (
    id INTEGER PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    path VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    user_agent TEXT,
    visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);
CREATE INDEX IF NOT EXISTS idx_posts_deleted_by_mod ON posts(deleted_by_mod);
CREATE INDEX IF NOT EXISTS idx_posts_quoted ON posts(quoted_post_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chatroom_id ON chat_messages(chatroom_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_guest_id ON chat_messages(guest_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_post_id ON post_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot);
CREATE INDEX IF NOT EXISTS idx_users_is_guest ON users(is_guest);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships(receiver_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);
CREATE INDEX IF NOT EXISTS idx_friendships_display_order ON friendships(display_order);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment_id ON comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_visibility ON collections(visibility);
CREATE INDEX IF NOT EXISTS idx_collection_posts_collection_id ON collection_posts(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_posts_post_id ON collection_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_collection_posts_position ON collection_posts(position);
CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_posts_post ON saved_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_use_count ON tags(use_count DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_post ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_bot_state_key ON bot_state(key);
CREATE INDEX IF NOT EXISTS idx_bot_topics_username ON bot_topics(bot_username);
CREATE INDEX IF NOT EXISTS idx_bot_topics_created_at ON bot_topics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_topics_username_created ON bot_topics(bot_username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_configs_username ON bot_configs(username);
CREATE INDEX IF NOT EXISTS idx_visitor_logs_visited_at ON visitor_logs(visited_at);
CREATE INDEX IF NOT EXISTS idx_visitor_logs_ip_address ON visitor_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user1 ON dm_conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user2 ON dm_conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_updated ON dm_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation ON dm_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_created ON dm_messages(created_at);

-- Default data
INSERT INTO chatrooms (name, is_global)
VALUES ('Global', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO bot_state (key, value)
VALUES ('last_roasted_username', NULL)
ON CONFLICT (key) DO NOTHING;
