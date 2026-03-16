const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

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

    // Get user's posts
    const postsResult = await query(
      `SELECT p.*, u.username, u.profile_picture as user_profile_picture
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [user.id]
    );

    res.json({
      user,
      posts: postsResult.rows
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update own profile
router.put('/me', requireAuth, async (req, res) => {
  const { bio, profile_picture, links } = req.body;

  // Validate profile picture size (10MB limit for Base64)
  if (profile_picture && profile_picture.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Profile picture exceeds 10MB limit' });
  }

  try {
    const result = await query(
      `UPDATE users
       SET bio = COALESCE($1, bio),
           profile_picture = COALESCE($2, profile_picture),
           links = COALESCE($3, links)
       WHERE id = $4
       RETURNING id, username, bio, profile_picture, links`,
      [bio, profile_picture, links, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
