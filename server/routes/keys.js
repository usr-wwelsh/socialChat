const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/keys — store public key + encrypted private key (one-time setup)
router.post('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { publicKey, encryptedPrivateKey, keyIv, keySalt } = req.body;

  if (!publicKey || !encryptedPrivateKey || !keyIv || !keySalt) {
    return res.status(400).json({ error: 'Missing key fields' });
  }

  try {
    await query(
      `UPDATE users SET public_key = $1, encrypted_private_key = $2, key_salt = $3 WHERE id = $4`,
      [publicKey, JSON.stringify({ encryptedData: encryptedPrivateKey, iv: keyIv, salt: keySalt }), keySalt, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Store keys error:', err);
    res.status(500).json({ error: 'Failed to store keys' });
  }
});

// GET /api/keys/me — fetch own encrypted private key blob
router.get('/me', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    const result = await query(
      'SELECT encrypted_private_key, key_salt FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const row = result.rows[0];
    if (!row.encrypted_private_key) {
      return res.json({ encryptedPrivateKey: null });
    }

    let blob;
    try {
      blob = JSON.parse(row.encrypted_private_key);
    } catch {
      return res.json({ encryptedPrivateKey: null });
    }

    res.json({
      encryptedPrivateKey: blob.encryptedData,
      keyIv: blob.iv,
      keySalt: blob.salt
    });
  } catch (err) {
    console.error('Fetch own key error:', err);
    res.status(500).json({ error: 'Failed to fetch key' });
  }
});

// GET /api/keys/user/:userId — fetch another user's public key
router.get('/user/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await query(
      'SELECT public_key FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].public_key) {
      return res.status(404).json({ error: 'Public key not found' });
    }

    res.json({ publicKey: result.rows[0].public_key });
  } catch (err) {
    console.error('Fetch public key error:', err);
    res.status(500).json({ error: 'Failed to fetch public key' });
  }
});

// PUT /api/keys/re-encrypt — update encrypted private key (password change)
router.put('/re-encrypt', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { encryptedPrivateKey, keyIv, keySalt } = req.body;

  if (!encryptedPrivateKey || !keyIv || !keySalt) {
    return res.status(400).json({ error: 'Missing key fields' });
  }

  try {
    await query(
      'UPDATE users SET encrypted_private_key = $1, key_salt = $2 WHERE id = $3',
      [JSON.stringify({ encryptedData: encryptedPrivateKey, iv: keyIv, salt: keySalt }), keySalt, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Re-encrypt key error:', err);
    res.status(500).json({ error: 'Failed to update key' });
  }
});

module.exports = router;
