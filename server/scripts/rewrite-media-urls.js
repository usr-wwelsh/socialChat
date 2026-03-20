#!/usr/bin/env bun
// One-time migration: rewrite stored media URLs from an old public URL to a new one.
// Use this when changing S3_PUBLIC_URL (e.g. from a dev R2 URL to a custom domain).
//
// Usage (auto-detects old URL from DB, new URL from S3_PUBLIC_URL in .env):
//   bun server/scripts/rewrite-media-urls.js
//   bun server/scripts/rewrite-media-urls.js --execute

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const EXECUTE = process.argv.includes('--execute');

const NEW_URL = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
if (!NEW_URL) {
  console.error('Error: S3_PUBLIC_URL is not set in .env');
  process.exit(1);
}

// Open DB
let db;
let usePostgres = false;

if (process.env.DATABASE_URL) {
  usePostgres = true;
  const { Client } = require('pg');
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.log('Connected to PostgreSQL');
} else {
  const { Database } = require('bun:sqlite');
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../db');
  console.log(`Opening SQLite database: ${dbPath}`);
  db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
}

async function queryOne(sql, params = []) {
  if (usePostgres) {
    const res = await db.query(sql, params);
    return res.rows[0] || null;
  }
  return db.prepare(sql).get(...params) || null;
}

async function queryAll(sql, params = []) {
  if (usePostgres) {
    const res = await db.query(sql, params);
    return res.rows;
  }
  return db.prepare(sql).all(...params);
}

async function runUpdate(sql, params = []) {
  if (usePostgres) {
    await db.query(sql, params);
  } else {
    db.prepare(sql).run(...params);
  }
}

// Auto-detect old URL by sampling a stored URL that doesn't match the new one
function extractBaseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const samplePost = await queryOne(
  usePostgres
    ? "SELECT media_url FROM posts WHERE media_url LIKE 'http%' AND media_url NOT LIKE $1 LIMIT 1"
    : "SELECT media_url FROM posts WHERE media_url LIKE 'http%' AND media_url NOT LIKE ? LIMIT 1",
  [`${NEW_URL}/%`]
);
const sampleUser = await queryOne(
  usePostgres
    ? "SELECT profile_picture FROM users WHERE profile_picture LIKE 'http%' AND profile_picture NOT LIKE $1 LIMIT 1"
    : "SELECT profile_picture FROM users WHERE profile_picture LIKE 'http%' AND profile_picture NOT LIKE ? LIMIT 1",
  [`${NEW_URL}/%`]
);

const OLD_URL = extractBaseUrl(samplePost?.media_url) || extractBaseUrl(sampleUser?.profile_picture);

if (!OLD_URL) {
  console.log('No records found with a different URL — nothing to migrate.');
  if (usePostgres) await db.end(); else db.close();
  process.exit(0);
}

console.log(`Old URL (detected): ${OLD_URL}`);
console.log(`New URL (from env): ${NEW_URL}`);
console.log(EXECUTE ? 'Mode: EXECUTE (will update database)' : 'Mode: DRY RUN (pass --execute to apply changes)');
console.log('');

// --- posts.media_url ---
const oldPostPattern = `${OLD_URL}/%`;
const posts = usePostgres
  ? await queryAll('SELECT id, media_url FROM posts WHERE media_url LIKE $1', [oldPostPattern])
  : await queryAll('SELECT id, media_url FROM posts WHERE media_url LIKE ?', [oldPostPattern]);

console.log(`Found ${posts.length} posts with old media URL`);

if (EXECUTE) {
  for (const post of posts) {
    const newUrl = post.media_url.replace(OLD_URL, NEW_URL);
    if (usePostgres) {
      await runUpdate('UPDATE posts SET media_url = $1 WHERE id = $2', [newUrl, post.id]);
    } else {
      await runUpdate('UPDATE posts SET media_url = ? WHERE id = ?', [newUrl, post.id]);
    }
  }
  console.log(`  Updated ${posts.length} posts`);
} else {
  for (const post of posts.slice(0, 5)) {
    console.log(`  [post ${post.id}] ${post.media_url} → ${post.media_url.replace(OLD_URL, NEW_URL)}`);
  }
  if (posts.length > 5) console.log(`  ... and ${posts.length - 5} more`);
}

// --- users.profile_picture ---
const users = usePostgres
  ? await queryAll('SELECT id, username, profile_picture FROM users WHERE profile_picture LIKE $1', [oldPostPattern])
  : await queryAll('SELECT id, username, profile_picture FROM users WHERE profile_picture LIKE ?', [oldPostPattern]);

console.log(`\nFound ${users.length} users with old profile picture URL`);

if (EXECUTE) {
  for (const user of users) {
    const newUrl = user.profile_picture.replace(OLD_URL, NEW_URL);
    if (usePostgres) {
      await runUpdate('UPDATE users SET profile_picture = $1 WHERE id = $2', [newUrl, user.id]);
    } else {
      await runUpdate('UPDATE users SET profile_picture = ? WHERE id = ?', [newUrl, user.id]);
    }
  }
  console.log(`  Updated ${users.length} users`);
} else {
  for (const user of users.slice(0, 5)) {
    console.log(`  [user ${user.id} @${user.username}] ${user.profile_picture} → ${user.profile_picture.replace(OLD_URL, NEW_URL)}`);
  }
  if (users.length > 5) console.log(`  ... and ${users.length - 5} more`);
}

if (usePostgres) {
  await db.end();
} else {
  db.close();
}

if (!EXECUTE) {
  console.log('\nDry run complete. Re-run with --execute to apply changes.');
} else {
  console.log('\nDone.');
}
