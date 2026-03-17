#!/usr/bin/env bun
// One-time migration: compress existing JPEG/PNG images to WebP
// Run with: bun server/scripts/compress-existing-images.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { Database } = require('bun:sqlite');
const { unlinkSync, existsSync } = require('fs');
const sharp = require('sharp');

const MEDIA_DIR = process.env.MEDIA_PATH || path.join(__dirname, '../../media');
const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../db');

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');

const CONVERTIBLE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

async function convertToWebp(oldUrl) {
  const filename = path.basename(oldUrl);
  const ext = path.extname(filename).toLowerCase();

  if (!CONVERTIBLE_EXTS.has(ext)) return null;

  const oldPath = path.join(MEDIA_DIR, filename);
  if (!existsSync(oldPath)) {
    console.warn(`  File not found, skipping: ${filename}`);
    return null;
  }

  const newFilename = filename.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  const newPath = path.join(MEDIA_DIR, newFilename);
  const newUrl = `/media/${newFilename}`;

  await sharp(oldPath).webp({ quality: 82 }).toFile(newPath);
  unlinkSync(oldPath);

  return newUrl;
}

// Migrate post images
const posts = db.prepare(
  "SELECT id, media_url FROM posts WHERE media_url IS NOT NULL AND (media_url LIKE '%.jpg' OR media_url LIKE '%.jpeg' OR media_url LIKE '%.png')"
).all();

console.log(`Found ${posts.length} post images to convert...`);
let postSuccess = 0, postError = 0;

for (const post of posts) {
  try {
    const newUrl = await convertToWebp(post.media_url);
    if (newUrl) {
      db.prepare('UPDATE posts SET media_url = ? WHERE id = ?').run(newUrl, post.id);
      postSuccess++;
      if (postSuccess % 10 === 0) console.log(`  Posts: ${postSuccess}/${posts.length}`);
    }
  } catch (err) {
    console.error(`  Failed post ${post.id} (${post.media_url}):`, err.message);
    postError++;
  }
}

console.log(`Posts done: ${postSuccess} converted, ${postError} errors`);

// Migrate profile pictures
const users = db.prepare(
  "SELECT id, profile_picture FROM users WHERE profile_picture IS NOT NULL AND (profile_picture LIKE '%.jpg' OR profile_picture LIKE '%.jpeg' OR profile_picture LIKE '%.png')"
).all();

console.log(`Found ${users.length} profile pictures to convert...`);
let userSuccess = 0, userError = 0;

for (const user of users) {
  try {
    const newUrl = await convertToWebp(user.profile_picture);
    if (newUrl) {
      db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?').run(newUrl, user.id);
      userSuccess++;
    }
  } catch (err) {
    console.error(`  Failed user ${user.id} (${user.profile_picture}):`, err.message);
    userError++;
  }
}

console.log(`Users done: ${userSuccess} converted, ${userError} errors`);

db.close();
console.log('Done!');
