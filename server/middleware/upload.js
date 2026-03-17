const busboy = require('busboy');
const { saveMediaFromBuffer } = require('../media');

function uploadMiddleware(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  let bb;
  try {
    bb = busboy({ headers: req.headers, limits: { fileSize: 20 * 1024 * 1024 } });
  } catch (err) {
    return next();
  }

  const fields = {};
  let fileBuffer = null;
  let fileMimeType = null;
  let fileFieldName = null;
  let limitExceeded = false;

  bb.on('field', (name, val) => {
    fields[name] = val;
  });

  bb.on('file', (name, stream, info) => {
    fileFieldName = name;
    fileMimeType = info.mimeType;
    const chunks = [];

    stream.on('data', (chunk) => chunks.push(chunk));

    stream.on('limit', () => {
      limitExceeded = true;
      stream.resume(); // drain stream
    });

    stream.on('end', () => {
      if (!limitExceeded) {
        fileBuffer = Buffer.concat(chunks);
      }
    });
  });

  bb.on('finish', async () => {
    if (limitExceeded) {
      return res.status(413).json({ error: 'File too large' });
    }

    req.body = fields;

    if (fileBuffer && fileMimeType) {
      try {
        const prefix = fileFieldName || 'media';
        req.mediaUrl = await saveMediaFromBuffer(fileBuffer, fileMimeType, prefix);
        req.mediaMimeType = fileMimeType;
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
