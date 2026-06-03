const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { deleteMedia } = require('../media');
const { attachQuotedPosts } = require('./posts');

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
    const viewerId = req.session?.userId || null;

    // Get user's posts (explicit columns, excludes media_data).
    // Only surface posts the viewer is allowed to see: public always, the
    // owner's own posts, and friends-only posts when viewer is an accepted friend.
    const postsResult = await query(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod, p.quoted_post_id,
         u.username, u.profile_picture as user_profile_picture,
         (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count,
         (SELECT EXISTS(SELECT 1 FROM post_reactions WHERE post_id = p.id AND user_id = $2 AND reaction_type = 'like')) as is_liked
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1
         AND p.deleted_by_mod = FALSE
         AND (
           p.visibility = 'public'
           OR p.user_id = $2
           OR (
             p.visibility = 'friends' AND EXISTS (
               SELECT 1 FROM friendships f
               WHERE f.status = 'accepted'
                 AND ((f.requester_id = $2 AND f.receiver_id = p.user_id)
                      OR (f.receiver_id = $2 AND f.requester_id = p.user_id))
             )
           )
         )
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [user.id, viewerId]
    );

    let posts = postsResult.rows.map(p => ({ ...p, tags: [], preview_comments: [] }));

    // Batch fetch tags, preview comments, and media
    if (posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const ph = postIds.map((_, i) => `$${i + 1}`).join(',');

      const tagsResult = await query(
        `SELECT pt.post_id, t.id, t.name FROM post_tags pt
         JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id IN (${ph})`,
        postIds
      );

      const commentsResult = await query(
        `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, c.updated_at, c.deleted_at,
           u.username, u.profile_picture,
           (SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id) as reaction_count
         FROM comments c JOIN users u ON c.user_id = u.id
         WHERE c.post_id IN (${ph}) AND c.deleted_at IS NULL
         ORDER BY c.post_id, c.created_at ASC`,
        postIds
      );

      const mediaResult = await query(
        `SELECT post_id, media_url, position FROM post_media
         WHERE post_id IN (${ph}) ORDER BY post_id, position ASC`,
        postIds
      );

      const tagsByPost = {};
      for (const tag of tagsResult.rows) {
        if (!tagsByPost[tag.post_id]) tagsByPost[tag.post_id] = [];
        tagsByPost[tag.post_id].push({ id: tag.id, name: tag.name });
      }

      const commentsByPost = {};
      for (const c of commentsResult.rows) {
        if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
        if (commentsByPost[c.post_id].length < 3) commentsByPost[c.post_id].push(c);
      }

      const mediaByPost = {};
      for (const row of mediaResult.rows) {
        if (!mediaByPost[row.post_id]) mediaByPost[row.post_id] = [];
        mediaByPost[row.post_id].push(row.media_url);
      }

      posts = posts.map(p => ({
        ...p,
        tags: tagsByPost[p.id] || [],
        preview_comments: commentsByPost[p.id] || [],
        media_urls: mediaByPost[p.id] || []
      }));
    }

    posts = await attachQuotedPosts(posts);

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
