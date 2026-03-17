const path = require('path');
const { mkdirSync, unlinkSync } = require('fs');
const crypto = require('crypto');

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

function ensureMediaDir() {
  mkdirSync(MEDIA_DIR, { recursive: true });
}

async function saveMediaFromBuffer(buffer, mimeType, prefix) {
  const ext = MIME_TO_EXT[mimeType] || '.bin';
  const filename = `${prefix}-${crypto.randomUUID()}${ext}`;
  const filePath = path.join(MEDIA_DIR, filename);
  await Bun.write(filePath, buffer);
  return `/media/${filename}`;
}

async function saveMediaFromBase64(dataUri, prefix) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error('Invalid data URI');
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return saveMediaFromBuffer(buffer, mimeType, prefix);
}

function deleteMedia(urlPath) {
  if (!urlPath || !urlPath.startsWith('/media/')) return;
  try {
    const filename = path.basename(urlPath);
    const filePath = path.join(MEDIA_DIR, filename);
    unlinkSync(filePath);
  } catch (err) {
    // swallow errors — file may not exist
  }
}

module.exports = { MEDIA_DIR, ensureMediaDir, saveMediaFromBuffer, saveMediaFromBase64, deleteMedia, MIME_TO_EXT };
