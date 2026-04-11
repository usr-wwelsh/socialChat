const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { deleteMedia } = require('../media');

const router = express.Router();

// Search for users (MUST be before /:username route)
router.get('/search', async (req, res) => {
  const searchQuery = req.query.q;

  if (!searchQuery || searchQuery.trim().length === 0) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const result = await query(
      `SELECT id, username, bio, profile_picture, created_at
       FROM users
       WHERE username LIKE $1 AND is_banned = FALSE
       ORDER BY username
       LIMIT 20`,
      [`%${searchQuery}%`]
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile by username
router.get('/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const result = await query(
      'SELECT id, username, bio, profile_picture, links, created_at FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get user's posts (explicit columns, excludes media_data)
    const postsResult = await query(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod,
         u.username, u.profile_picture as user_profile_picture
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [user.id]
    );

    let posts = postsResult.rows;

    // Batch fetch post_media (multiple images)
    if (posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const ph = postIds.map((_, i) => `$${i + 1}`).join(',');
      const mediaResult = await query(
        `SELECT post_id, media_url, position FROM post_media
         WHERE post_id IN (${ph}) ORDER BY post_id, position ASC`,
        postIds
      );
      const mediaByPost = {};
      for (const row of mediaResult.rows) {
        if (!mediaByPost[row.post_id]) mediaByPost[row.post_id] = [];
        mediaByPost[row.post_id].push(row.media_url);
      }
      posts = posts.map(p => ({ ...p, media_urls: mediaByPost[p.id] || [] }));
    }

    res.json({
      user,
      posts
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update own profile
router.put('/me', requireAuth, uploadMiddleware, async (req, res) => {
  const { bio, links } = req.body;

  try {
    // Get current profile_picture for cleanup if replacing
    let newProfilePicture = undefined;
    if (req.mediaUrl) {
      // New picture uploaded via multipart
      const currentResult = await query(
        'SELECT profile_picture FROM users WHERE id = $1',
        [req.session.userId]
      );
      if (currentResult.rows.length > 0) {
        deleteMedia(currentResult.rows[0].profile_picture);
      }
      newProfilePicture = req.mediaUrl;
    }

    const result = await query(
      `UPDATE users
       SET bio = COALESCE($1, bio),
           profile_picture = COALESCE($2, profile_picture),
           links = COALESCE($3, links)
       WHERE id = $4
       RETURNING id, username, bio, profile_picture, links`,
      [bio || null, newProfilePicture || null, links || null, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    if (req.mediaUrl) deleteMedia(req.mediaUrl);
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
