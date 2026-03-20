#!/usr/bin/env bun
// Restore a SQLite backup from S3
// Usage:
//   bun server/scripts/restore-backup.js          <- restores latest backup
//   bun server/scripts/restore-backup.js list     <- lists available backups
//   bun server/scripts/restore-backup.js db-2026-03-16.sqlite  <- restores specific backup

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

const BACKUP_PREFIX = 'backups/';
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../../db');

const S3_BUCKET = process.env.S3_BUCKET;
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL;

if (!S3_BUCKET || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
  console.error('Error: S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY must all be set.');
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

async function listBackups() {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: BACKUP_PREFIX }));
  return (res.Contents || [])
    .map(o => ({ key: o.Key, size: o.Size, date: o.LastModified }))
    .sort((a, b) => b.key.localeCompare(a.key)); // newest first
}

async function restoreBackup(key) {
  console.log(`Downloading ${key}...`);
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  // Write to a temp file first, then atomically replace
  const tmp = DB_PATH + '.restore-tmp';
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, DB_PATH);

  console.log(`Restored ${(buffer.length / 1024).toFixed(1)} kB from ${key} to ${DB_PATH}`);
  console.log('Restart the app to pick up the restored database.');
}

const arg = process.argv[2];

const backups = await listBackups();

if (backups.length === 0) {
  console.log('No backups found.');
  process.exit(0);
}

if (arg === 'list' || !arg) {
  console.log('Available backups (newest first):');
  for (const b of backups) {
    const kb = (b.size / 1024).toFixed(1);
    console.log(`  ${path.basename(b.key)}  (${kb} kB, ${b.date.toISOString().slice(0, 10)})`);
  }

  if (!arg) {
    // No arg = restore latest
    console.log(`\nRestoring latest: ${backups[0].key}`);
    await restoreBackup(backups[0].key);
  }
} else {
  // Specific filename given
  const key = `${BACKUP_PREFIX}${arg}`;
  const found = backups.find(b => b.key === key);
  if (!found) {
    console.error(`Backup not found: ${key}`);
    console.log('Run with "list" to see available backups.');
    process.exit(1);
  }
  await restoreBackup(key);
}
