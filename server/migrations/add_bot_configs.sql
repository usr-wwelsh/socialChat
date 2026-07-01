-- Migration: Add bot_configs table so bot personalities are DB-editable
-- instead of hardcoded, and can be managed from the moderation panel.

CREATE TABLE IF NOT EXISTS bot_configs (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  bio TEXT,
  personality TEXT NOT NULL,
  style VARCHAR(50) NOT NULL,
  topic_limit INTEGER DEFAULT 5,
  link_categories TEXT, -- JSON array, only used by link_spam-style bots
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bot_configs_username ON bot_configs(username);
