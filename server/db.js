const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// PostgreSQL connection pool - supports both connection string and individual params
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'socialchat',
      user: process.env.PGUSER || 'postgres',
      password: String(process.env.PGPASSWORD || ''),
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };

const pool = new Pool(poolConfig);

// Test database connection (commented out to reduce log spam from pool connections)
// pool.on('connect', () => {
//   console.log('Connected to PostgreSQL database');
// });

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Helper function to execute queries
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;

    // Only log slow queries (>100ms) to reduce log noise
    if (duration > 100) {
      console.log('Slow query detected', { text, duration, rows: res.rowCount });
    }

    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Initialize database with schema
const initDatabase = async () => {
  const fs = require('fs');
  const path = require('path');

  try {
    // Run main schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('Database schema initialized successfully');

    // Run moderation migration
    const migrationPath = path.join(__dirname, 'migrations', 'add_moderation.sql');
    if (fs.existsSync(migrationPath)) {
      const migration = fs.readFileSync(migrationPath, 'utf8');
      await pool.query(migration);
      console.log('Moderation features migrated successfully');
    }

    // Run Phase 0 features migration (visibility, audio, tags)
    const phase0MigrationPath = path.join(__dirname, 'migrations', 'add_phase0_features.sql');
    if (fs.existsSync(phase0MigrationPath)) {
      const phase0Migration = fs.readFileSync(phase0MigrationPath, 'utf8');
      await pool.query(phase0Migration);
      console.log('Phase 0 features migrated successfully (visibility, audio, tags)');
    }

    // Run Phase 1 migration (friends, comments, collections, guest support)
    const phase1MigrationPath = path.join(__dirname, 'migrations', 'phase1_migration.sql');
    if (fs.existsSync(phase1MigrationPath)) {
      const phase1Migration = fs.readFileSync(phase1MigrationPath, 'utf8');
      await pool.query(phase1Migration);
      console.log('Phase 1 features migrated successfully (friends, comments, collections, guests)');
    }

    // Run friend display order migration (MySpace-style top friends)
    const friendOrderMigrationPath = path.join(__dirname, 'migrations', 'add_friend_display_order.sql');
    if (fs.existsSync(friendOrderMigrationPath)) {
      const friendOrderMigration = fs.readFileSync(friendOrderMigrationPath, 'utf8');
      await pool.query(friendOrderMigration);
      console.log('Friend display order migrated successfully (MySpace-style top friends)');
    }

    // Run bot features migration
    const botMigrationPath = path.join(__dirname, 'migrations', 'add_bot_features.sql');
    if (fs.existsSync(botMigrationPath)) {
      const botMigration = fs.readFileSync(botMigrationPath, 'utf8');
      await pool.query(botMigration);
      console.log('Bot features migrated successfully');
    }

    // Run bot state migration (database-based state storage)
    const botStateMigrationPath = path.join(__dirname, 'migrations', 'add_bot_state.sql');
    if (fs.existsSync(botStateMigrationPath)) {
      const botStateMigration = fs.readFileSync(botStateMigrationPath, 'utf8');
      await pool.query(botStateMigration);
      console.log('Bot state storage migrated successfully');
    }

    // Run bot topics migration (topic diversity tracking)
    const botTopicsMigrationPath = path.join(__dirname, 'migrations', 'add_bot_topics.sql');
    if (fs.existsSync(botTopicsMigrationPath)) {
      const botTopicsMigration = fs.readFileSync(botTopicsMigrationPath, 'utf8');
      await pool.query(botTopicsMigration);
      console.log('Bot topics tracking migrated successfully');
    }

    // Backfill hashtags for existing bot posts
    const backfillHashtagsPath = path.join(__dirname, 'migrations', 'backfill_bot_hashtags.sql');
    if (fs.existsSync(backfillHashtagsPath)) {
      const backfillHashtags = fs.readFileSync(backfillHashtagsPath, 'utf8');
      await pool.query(backfillHashtags);
      console.log('Bot hashtags backfilled successfully');
    }

    // Run visitor analytics migration
    const visitorAnalyticsMigrationPath = path.join(__dirname, 'migrations', 'add_visitor_analytics.sql');
    if (fs.existsSync(visitorAnalyticsMigrationPath)) {
      const visitorAnalyticsMigration = fs.readFileSync(visitorAnalyticsMigrationPath, 'utf8');
      await pool.query(visitorAnalyticsMigration);
      console.log('Visitor analytics tracking migrated successfully');
    }
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

module.exports = {
  query,
  pool,
  initDatabase
};
