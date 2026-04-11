const busboy = require('busboy');
const { saveMediaFromBuffer } = require('../media');

const MAX_FILES = 10;

function uploadMiddleware(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  let bb;
  try {
    bb = busboy({ headers: req.headers, limits: { fileSize: 20 * 1024 * 1024, files: MAX_FILES } });
  } catch (err) {
    return next();
  }

  const fields = {};
  const fileUploads = [];
  let limitExceeded = false;

  bb.on('field', (name, val) => {
    fields[name] = val;
  });

  bb.on('file', (name, stream, info) => {
    const fileData = { mimeType: info.mimeType, fieldName: name, limitExceeded: false, chunks: [] };
    fileUploads.push(fileData);

    stream.on('data', (chunk) => fileData.chunks.push(chunk));

    stream.on('limit', () => {
      fileData.limitExceeded = true;
      limitExceeded = true;
      stream.resume();
    });

    stream.on('end', () => {
      if (!fileData.limitExceeded) {
        fileData.buffer = Buffer.concat(fileData.chunks);
      }
      delete fileData.chunks;
    });
  });

  bb.on('finish', async () => {
    if (limitExceeded) {
      return res.status(413).json({ error: 'File too large' });
    }

    req.body = fields;

    const validFiles = fileUploads.filter(f => f.buffer && f.mimeType);
    if (validFiles.length > 0) {
      try {
        const urls = await Promise.all(
          validFiles.map(f => saveMediaFromBuffer(f.buffer, f.mimeType, f.fieldName || 'media'))
        );
        // Always set req.mediaUrl to first file for backwards compat
        req.mediaUrl = urls[0];
        req.mediaMimeType = validFiles[0].mimeType;
        // For multiple files, expose the full array
        req.mediaFiles = urls.map((url, i) => ({ url, mimeType: validFiles[i].mimeType }));
      } catch (err) {
        return next(err);
      }
    }

    next();
  });

  bb.on('error', (err) => next(err));

  req.on('data', (chunk) => bb.write(chunk));
  req.on('end', () => bb.end());
  req.on('error', (err) => bb.destroy(err));
}

module.exports = uploadMiddleware;
