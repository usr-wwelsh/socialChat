const path = require('path');
const { mkdirSync, unlinkSync } = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const IMAGE_MIME_TYPES_TO_COMPRESS = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const MEDIA_DIR = process.env.MEDIA_PATH || path.join(__dirname, '..', 'media');

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
  'audio/x-m4a': '.m4a',
  'audio/mp4': '.m4a',
};

const S3_BUCKET = process.env.S3_BUCKET || null;
const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');

const s3Client = S3_BUCKET
  ? new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    })
  : null;

function ensureMediaDir() {
  mkdirSync(MEDIA_DIR, { recursive: true });
}

async function saveMediaFromBuffer(buffer, mimeType, prefix) {
  let saveBuffer = buffer;
  let ext = MIME_TO_EXT[mimeType] || '.bin';
  let contentType = mimeType;

  if (IMAGE_MIME_TYPES_TO_COMPRESS.has(mimeType)) {
    saveBuffer = await sharp(buffer).webp({ quality: 82 }).toBuffer();
    ext = '.webp';
    contentType = 'image/webp';
  }

  const filename = `${prefix}-${crypto.randomUUID()}${ext}`;

  if (s3Client) {
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: filename,
      Body: saveBuffer,
      ContentType: contentType,
    }));
    return `${S3_PUBLIC_URL}/${filename}`;
  }

  const filePath = path.join(MEDIA_DIR, filename);
  await Bun.write(filePath, saveBuffer);
  return `/media/${filename}`;
}

async function saveMediaFromBase64(dataUri, prefix) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error('Invalid data URI');
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return saveMediaFromBuffer(buffer, mimeType, prefix);
}

async function deleteMedia(urlPath) {
  if (!urlPath) return;
  if (urlPath.startsWith('http') && s3Client) {
    try {
      const key = urlPath.replace(`${S3_PUBLIC_URL}/`, '');
      await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    } catch (err) {
      // swallow errors
    }
  } else if (urlPath.startsWith('/media/')) {
    try {
      const filename = path.basename(urlPath);
      const filePath = path.join(MEDIA_DIR, filename);
      unlinkSync(filePath);
    } catch (err) {
      // swallow errors — file may not exist
    }
  }
}

module.exports = { MEDIA_DIR, S3_BUCKET, S3_PUBLIC_URL, s3Client, ensureMediaDir, saveMediaFromBuffer, saveMediaFromBase64, deleteMedia, MIME_TO_EXT };
