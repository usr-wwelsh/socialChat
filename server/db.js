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

module.exports = { query, pool, initDatabase };
