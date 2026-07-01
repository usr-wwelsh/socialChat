const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isPostgres = process.env.DATABASE_URL?.startsWith('postgres');

let query;
let pool = null;
let sqliteDb = null;

if (isPostgres) {
  const { Pool } = require('pg');
  const poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };

  pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
  });

  query = async (text, params) => {
    const start = Date.now();
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 100) {
        console.log('Slow query detected', { text, duration, rows: res.rowCount });
      }
      return res;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  };
} else {
  const { Database } = require('bun:sqlite');
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'db');
  sqliteDb = new Database(dbPath, { create: true });
  sqliteDb.run('PRAGMA journal_mode = WAL');
  sqliteDb.run('PRAGMA foreign_keys = ON');

  query = async (text, params = []) => {
    // Convert PostgreSQL $1,$2,... placeholders to SQLite ?
    // Expand params to handle repeated $N references (e.g. $3 used twice → two ? values)
    const expandedParams = [];
    const sql = text.replace(/\$(\d+)/g, (_, n) => {
      expandedParams.push((params || [])[parseInt(n) - 1]);
      return '?';
    });
    const stmt = sqliteDb.prepare(sql);
    const isRead = /^\s*(SELECT|WITH)/i.test(text) || /RETURNING/i.test(text);
    if (isRead) {
      const rows = stmt.all(...expandedParams);
      return { rows, rowCount: rows.length };
    } else {
      const result = stmt.run(...expandedParams);
      return { rows: [], rowCount: result.changes };
    }
  };
}

// Run additive SQLite migrations for existing databases
function runSqliteMigrations() {
  // Add is_pinned to posts if missing
  const postCols = sqliteDb.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
  if (!postCols.includes('is_pinned')) {
    sqliteDb.run('ALTER TABLE posts ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE');
  }
  if (!postCols.includes('quoted_post_id')) {
    sqliteDb.run('ALTER TABLE posts ADD COLUMN quoted_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL');
    sqliteDb.run('CREATE INDEX IF NOT EXISTS idx_posts_quoted ON posts(quoted_post_id)');
  }

  // Add crypto columns to users if missing
  const userCols = sqliteDb.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('public_key')) {
    sqliteDb.run('ALTER TABLE users ADD COLUMN public_key TEXT');
  }
  if (!userCols.includes('encrypted_private_key')) {
    sqliteDb.run('ALTER TABLE users ADD COLUMN encrypted_private_key TEXT');
  }
  if (!userCols.includes('key_salt')) {
    sqliteDb.run('ALTER TABLE users ADD COLUMN key_salt TEXT');
  }

  // Create post_media table if missing
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS post_media (
      id INTEGER PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      media_url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id, position);
  `);

  // Create bot_configs table if missing (DB-editable bot personalities)
  sqliteDb.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_bot_configs_username ON bot_configs(username);
  `);

  // Create DM tables if missing
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS dm_conversations (
      id INTEGER PRIMARY KEY,
      user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT ensure_user1_less CHECK (user1_id < user2_id),
      CONSTRAINT unique_dm_pair UNIQUE (user1_id, user2_id)
    );
    CREATE TABLE IF NOT EXISTS dm_messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dm_conversations_user1 ON dm_conversations(user1_id);
    CREATE INDEX IF NOT EXISTS idx_dm_conversations_user2 ON dm_conversations(user2_id);
    CREATE INDEX IF NOT EXISTS idx_dm_conversations_updated ON dm_conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation ON dm_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_dm_messages_created ON dm_messages(created_at);
  `);
  console.log('SQLite DM migrations applied');
}

const initDatabase = async () => {
  const fs = require('fs');
  const { ensureMediaDir } = require('./media');
  ensureMediaDir();

  if (!isPostgres) {
    // SQLite: skip init if tables already exist (data preserved)
    const tableCount = sqliteDb.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table'"
    ).get();
    if (tableCount.count > 0) {
      console.log('SQLite database already initialized, skipping schema setup');
      // Run additive SQLite migrations for existing databases
      runSqliteMigrations();
      return;
    }
    const schemaPath = path.join(__dirname, 'schema.sqlite.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    sqliteDb.exec(schema);
    console.log('SQLite database schema initialized successfully');
    return;
  }

  // PostgreSQL: run schema + all migrations
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('Database schema initialized successfully');

    const migrations = [
      ['migrations/add_moderation.sql', 'Moderation features migrated successfully'],
      ['migrations/add_phase0_features.sql', 'Phase 0 features migrated successfully (visibility, audio, tags)'],
      ['migrations/phase1_migration.sql', 'Phase 1 features migrated successfully (friends, comments, collections, guests)'],
      ['migrations/add_friend_display_order.sql', 'Friend display order migrated successfully (MySpace-style top friends)'],
      ['migrations/add_bot_features.sql', 'Bot features migrated successfully'],
      ['migrations/add_bot_state.sql', 'Bot state storage migrated successfully'],
      ['migrations/add_bot_topics.sql', 'Bot topics tracking migrated successfully'],
      ['migrations/backfill_bot_hashtags.sql', 'Bot hashtags backfilled successfully'],
      ['migrations/add_visitor_analytics.sql', 'Visitor analytics tracking migrated successfully'],
      ['migrations/add_encrypted_dms.sql', 'Encrypted DMs migrated successfully'],
      ['migrations/add_pinned_posts.sql', 'Pinned posts migrated successfully'],
      ['migrations/add_post_media.sql', 'Post media table migrated successfully'],
      ['migrations/add_quote_posts.sql', 'Quote posts migrated successfully'],
      ['migrations/add_bot_configs.sql', 'Bot configs table migrated successfully'],
    ];

    for (const [relPath, successMsg] of migrations) {
      const migPath = path.join(__dirname, relPath);
      if (fs.existsSync(migPath)) {
        const migration = fs.readFileSync(migPath, 'utf8');
        await pool.query(migration);
        console.log(successMsg);
      }
    }
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

module.exports = { query, pool, sqliteDb: isPostgres ? null : sqliteDb, initDatabase };
