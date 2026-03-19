#!/usr/bin/env bun
// One-time migration: upload local filesystem media to S3-compatible storage
// Run with: bun server/scripts/migrate-media-to-s3.js [--delete-local]

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { readFileSync } = require('fs');
const { unlinkSync } = require('fs');

const { MEDIA_DIR, MIME_TO_EXT } = require('../media');

const DELETE_LOCAL = process.argv.includes('--delete-local');

// Validate required S3 env vars
const S3_BUCKET = process.env.S3_BUCKET;
const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');

if (!S3_BUCKET || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY || !S3_PUBLIC_URL) {
  console.error('Error: S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_PUBLIC_URL must all be set.');
  process.exit(1);
}

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

// Build reverse map: ext → mime
const EXT_TO_MIME = {};
for (const [mime, ext] of Object.entries(MIME_TO_EXT)) {
  if (!EXT_TO_MIME[ext]) EXT_TO_MIME[ext] = mime;
}

function mimeForFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

async function uploadFile(filename) {
  const filePath = path.join(MEDIA_DIR, filename);
  const buffer = readFileSync(filePath);
  const contentType = mimeForFilename(filename);
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: filename,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${S3_PUBLIC_URL}/${filename}`;
}

// Open DB — prefer PostgreSQL if DATABASE_URL is set, else SQLite
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

// Migrate posts
const posts = await queryAll("SELECT id, media_url FROM posts WHERE media_url LIKE '/media/%'");
console.log(`Found ${posts.length} posts with local media URLs`);

let postSuccess = 0;
let postError = 0;

for (const post of posts) {
  try {
    const filename = path.basename(post.media_url);
    const newUrl = await uploadFile(filename);
    if (usePostgres) {
      await runUpdate('UPDATE posts SET media_url = $1 WHERE id = $2', [newUrl, post.id]);
    } else {
      await runUpdate('UPDATE posts SET media_url = ? WHERE id = ?', [newUrl, post.id]);
    }
    if (DELETE_LOCAL) {
      try { unlinkSync(path.join(MEDIA_DIR, filename)); } catch {}
    }
    postSuccess++;
    if (postSuccess % 10 === 0) console.log(`  Posts: ${postSuccess}/${posts.length} migrated`);
  } catch (err) {
    console.error(`  Failed to migrate post ${post.id}:`, err.message);
    postError++;
  }
}

console.log(`Posts done: ${postSuccess} migrated, ${postError} errors`);

// Migrate user profile pictures
const users = await queryAll("SELECT id, profile_picture FROM users WHERE profile_picture LIKE '/media/%'");
console.log(`Found ${users.length} users with local profile pictures`);

let userSuccess = 0;
let userError = 0;

for (const user of users) {
  try {
    const filename = path.basename(user.profile_picture);
    const newUrl = await uploadFile(filename);
    if (usePostgres) {
      await runUpdate('UPDATE users SET profile_picture = $1 WHERE id = $2', [newUrl, user.id]);
    } else {
      await runUpdate('UPDATE users SET profile_picture = ? WHERE id = ?', [newUrl, user.id]);
    }
    if (DELETE_LOCAL) {
      try { unlinkSync(path.join(MEDIA_DIR, filename)); } catch {}
    }
    userSuccess++;
  } catch (err) {
    console.error(`  Failed to migrate user ${user.id} profile picture:`, err.message);
    userError++;
  }
}

console.log(`Users done: ${userSuccess} migrated, ${userError} errors`);

if (usePostgres) {
  await db.end();
} else {
  db.close();
}

console.log('Migration complete!');
if (DELETE_LOCAL) console.log('Local files deleted.');
else console.log('Local files kept. Re-run with --delete-local to remove them.');
