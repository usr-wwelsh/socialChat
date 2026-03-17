#!/usr/bin/env bun
// One-time migration: extract Base64 media from SQLite DB → filesystem
// Run with: bun server/scripts/migrate-media.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { Database } = require('bun:sqlite');
const { ensureMediaDir, saveMediaFromBase64 } = require('../media');

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../db');

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');

ensureMediaDir();

// Add media_url column to posts if not exists
try {
  db.run('ALTER TABLE posts ADD COLUMN media_url TEXT');
  console.log('Added media_url column to posts');
} catch (err) {
  if (!err.message.includes('duplicate column')) throw err;
  console.log('media_url column already exists in posts');
}

// Migrate posts
const posts = db.prepare(
  "SELECT id, media_data, media_type FROM posts WHERE media_data IS NOT NULL AND media_data LIKE 'data:%' AND (media_url IS NULL OR media_url = '')"
).all();

console.log(`Migrating ${posts.length} posts with Base64 media...`);

let postSuccess = 0;
let postError = 0;

for (const post of posts) {
  try {
    const url = await saveMediaFromBase64(post.media_data, `post-${post.id}`);
    db.prepare('UPDATE posts SET media_url = ? WHERE id = ?').run(url, post.id);
    postSuccess++;
    if (postSuccess % 10 === 0) {
      console.log(`  Posts: ${postSuccess}/${posts.length} migrated`);
    }
  } catch (err) {
    console.error(`  Failed to migrate post ${post.id}:`, err.message);
    postError++;
  }
}

console.log(`Posts done: ${postSuccess} migrated, ${postError} errors`);

// Migrate users profile_picture
const users = db.prepare(
  "SELECT id, profile_picture FROM users WHERE profile_picture IS NOT NULL AND profile_picture LIKE 'data:%'"
).all();

console.log(`Migrating ${users.length} user profile pictures...`);

let userSuccess = 0;
let userError = 0;

for (const user of users) {
  try {
    const url = await saveMediaFromBase64(user.profile_picture, `profile-${user.id}`);
    db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?').run(url, user.id);
    userSuccess++;
  } catch (err) {
    console.error(`  Failed to migrate user ${user.id} profile picture:`, err.message);
    userError++;
  }
}

console.log(`Users done: ${userSuccess} migrated, ${userError} errors`);

// Clear media_data for migrated posts
const cleared = db.prepare(
  'UPDATE posts SET media_data = NULL WHERE media_url IS NOT NULL AND media_url != \'\''
).run();

console.log(`Cleared media_data from ${cleared.changes} posts`);

// VACUUM to reclaim disk space
console.log('Running VACUUM...');
db.run('VACUUM');
console.log('VACUUM complete');

db.close();
console.log('Migration complete!');
