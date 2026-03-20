const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const KEEP_BACKUPS = 4;
const BACKUP_PREFIX = 'backups/';
const TMP_PATH = '/tmp/db-backup.sqlite';

function getS3Client() {
  if (!process.env.S3_BUCKET || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    return null;
  }
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
}

async function runBackup(sqliteDb) {
  const s3 = getS3Client();
  if (!s3) {
    console.log('[backup] S3 not configured, skipping backup');
    return;
  }

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const token = require('crypto').randomBytes(4).toString('hex'); // 8 char random suffix
  const key = `${BACKUP_PREFIX}db-${date}-${token}.sqlite`;

  console.log(`[backup] Starting DB backup → ${key}`);

  try {
    // VACUUM INTO creates a clean, consistent snapshot even with WAL mode
    if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);
    sqliteDb.exec(`VACUUM INTO '${TMP_PATH}'`);

    const buffer = fs.readFileSync(TMP_PATH);
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'application/x-sqlite3',
    }));
    console.log(`[backup] Uploaded ${(buffer.length / 1024).toFixed(1)} kB to ${key}`);

    // Prune old backups, keep most recent KEEP_BACKUPS
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET,
      Prefix: BACKUP_PREFIX,
    }));

    const backups = (list.Contents || [])
      .filter(o => o.Key !== key)
      .sort((a, b) => a.Key.localeCompare(b.Key)); // oldest first

    const toDelete = backups.slice(0, Math.max(0, backups.length - (KEEP_BACKUPS - 1)));
    for (const obj of toDelete) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: obj.Key }));
      console.log(`[backup] Deleted old backup: ${obj.Key}`);
    }
  } catch (err) {
    console.error('[backup] Backup failed:', err.message);
  } finally {
    if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);
  }
}

function startBackupScheduler(sqliteDb) {
  // Check once an hour — run backup on Sunday at midnight UTC
  setInterval(() => {
    const now = new Date();
    if (now.getUTCDay() === 0 && now.getUTCHours() === 0) {
      runBackup(sqliteDb);
    }
  }, 60 * 60 * 1000);

  console.log('[backup] Weekly backup scheduler started (Sundays 00:00 UTC)');
}

module.exports = { startBackupScheduler, runBackup };
