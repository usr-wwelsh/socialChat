const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Will be set by index.js
let io = null;
router.setSocketIO = (socketIO) => {
  io = socketIO;
};

// Rate limiting for post creation
const postCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit each IP to 20 posts per hour
  handler: (req, res) => {
    const resetTime = Math.floor(Date.now() / 1000) + Math.floor((req.rateLimit.resetTime - Date.now()) / 1000);
    res.redirect(`/429.html?reset=${resetTime}`);
  },
});

// Get all posts (feed)
router.get('/', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const userId = req.session?.userId;

  try {
    // Get posts with tags AND comments in a single optimized query
    const result = await query(
      `WITH post_data AS (
         SELECT p.*, u.username, u.profile_picture as user_profile_picture,
           (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count,
           COALESCE(
             (SELECT json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name))
              FROM post_tags pt
              JOIN tags t ON pt.tag_id = t.id
              WHERE pt.post_id = p.id),
             '[]'
           ) as tags
         FROM posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.deleted_by_mod = FALSE
           AND u.is_banned = FALSE
           AND (
             p.visibility = 'public'
             OR p.user_id = $3
             OR (
               p.visibility = 'friends' AND EXISTS (
                 SELECT 1 FROM friendships f
                 WHERE f.status = 'accepted'
                   AND ((f.requester_id = $3 AND f.receiver_id = p.user_id)
                        OR (f.receiver_id = $3 AND f.requester_id = p.user_id))
               )
             )
           )
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2
       )
       SELECT pd.*,
         COALESCE(
           (SELECT json_agg(comment_data ORDER BY comment_data.created_at ASC)
            FROM (
              SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, c.updated_at, c.deleted_at,
                u.username, u.profile_picture,
                (SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id) as reaction_count
              FROM comments c
              JOIN users u ON c.user_id = u.id
              WHERE c.post_id = pd.id AND c.deleted_at IS NULL
              ORDER BY c.created_at ASC
              LIMIT 3
            ) comment_data),
           '[]'
         ) as preview_comments
       FROM post_data pd`,
      [limit, offset, userId || null]
    );

    // Parse the JSON fields
    const posts = result.rows.map(post => ({
      ...post,
      tags: typeof post.tags === 'string' ? JSON.parse(post.tags) : post.tags,
      preview_comments: typeof post.preview_comments === 'string' ? JSON.parse(post.preview_comments) : post.preview_comments
    }));

    res.json({ posts: posts });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single post by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT p.*, u.username, u.profile_picture as user_profile_picture,
       (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ post: result.rows[0] });
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to parse hashtags from content
const parseHashtags = (content) => {
  const hashtagRegex = /#(\w+)/g;
  const matches = content.match(hashtagRegex);
  if (!matches) return [];
  return [...new Set(matches.map(tag => tag.substring(1).toLowerCase()))];
};

// Create new post
router.post('/', postCreationLimiter, requireAuth, async (req, res) => {
  const { content, media_type, media_data, visibility, audio_duration, audio_format } = req.body;

  // Validation
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (content.length > 5000) {
    return res.status(400).json({ error: 'Content exceeds 5000 characters' });
  }

  // Validate media size (20MB limit for audio, 10MB for image/video)
  const maxSize = media_type === 'audio' ? 20 * 1024 * 1024 : 10 * 1024 * 1024;
  if (media_data && media_data.length > maxSize) {
    return res.status(400).json({ error: `Media exceeds ${maxSize / (1024 * 1024)}MB limit` });
  }

  // Validate media type
  if (media_type && !['image', 'video', 'audio'].includes(media_type)) {
    return res.status(400).json({ error: 'Invalid media type. Must be "image", "video", or "audio"' });
  }

  // Validate visibility
  const validVisibility = ['public', 'friends', 'private'];
  const postVisibility = visibility && validVisibility.includes(visibility) ? visibility : 'public';

  try {
    // Insert post
    const result = await query(
      `INSERT INTO posts (user_id, content, media_type, media_data, visibility, audio_duration, audio_format)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, content, media_type, media_data, visibility, audio_duration, audio_format, created_at, updated_at`,
      [req.session.userId, content, media_type || null, media_data || null, postVisibility, audio_duration || null, audio_format || null]
    );

    const post = result.rows[0];

    // Parse and insert hashtags
    const hashtags = parseHashtags(content);
    if (hashtags.length > 0) {
      for (const tagName of hashtags) {
        // Insert or get tag
        const tagResult = await query(
          `INSERT INTO tags (name, use_count)
           VALUES ($1, 1)
           ON CONFLICT (name) DO UPDATE SET use_count = tags.use_count + 1
           RETURNING id`,
          [tagName]
        );

        // Link tag to post
        await query(
          `INSERT INTO post_tags (post_id, tag_id)
           VALUES ($1, $2)
           ON CONFLICT (post_id, tag_id) DO NOTHING`,
          [post.id, tagResult.rows[0].id]
        );
      }
    }

    // Get user info for the response
    const userResult = await query(
      'SELECT username, profile_picture FROM users WHERE id = $1',
      [req.session.userId]
    );

    // Get tags for response
    const tagsResult = await query(
      `SELECT t.id, t.name FROM tags t
       INNER JOIN post_tags pt ON t.id = pt.tag_id
       WHERE pt.post_id = $1`,
      [post.id]
    );

    const postData = {
      ...post,
      username: userResult.rows[0].username,
      user_profile_picture: userResult.rows[0].profile_picture,
      reaction_count: 0,
      tags: tagsResult.rows
    };

    // Broadcast new post to all connected clients
    if (io && postVisibility === 'public') {
      io.emit('new_post', postData);
    }

    res.status(201).json({
      message: 'Post created successfully',
      post: postData
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit post
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { content, media_type, media_data } = req.body;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (content.length > 5000) {
    return res.status(400).json({ error: 'Content exceeds 5000 characters' });
  }

  if (media_data && media_data.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Media exceeds 10MB limit' });
  }

  try {
    // Check if post belongs to user
    const checkResult = await query(
      'SELECT user_id FROM posts WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (checkResult.rows[0].user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized to edit this post' });
    }

    // Update post
    const result = await query(
      `UPDATE posts
       SET content = $1, media_type = $2, media_data = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, user_id, content, media_type, media_data, created_at, updated_at`,
      [content, media_type || null, media_data || null, id]
    );

    res.json({
      message: 'Post updated successfully',
      post: result.rows[0]
    });
  } catch (error) {
    console.error('Edit post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete post
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if post exists
    const checkResult = await query(
      'SELECT user_id FROM posts WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is admin
    const userResult = await query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );

    const isAdmin = userResult.rows[0]?.is_admin;
    const isOwner = checkResult.rows[0].user_id === req.session.userId;

    // Allow deletion if admin OR owner
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Unauthorized to delete this post' });
    }

    // Delete post (reactions will cascade)
    await query('DELETE FROM posts WHERE id = $1', [id]);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// React to post
router.post('/:id/react', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { reaction_type } = req.body;

  if (!reaction_type) {
    return res.status(400).json({ error: 'Reaction type is required' });
  }

  const validReactions = ['like', 'love', 'laugh', 'wow', 'sad', 'angry'];
  if (!validReactions.includes(reaction_type)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  try {
    // Check if post exists
    const postCheck = await query('SELECT id FROM posts WHERE id = $1', [id]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Insert or update reaction
    await query(
      `INSERT INTO post_reactions (post_id, user_id, reaction_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_id, user_id, reaction_type) DO NOTHING`,
      [id, req.session.userId, reaction_type]
    );

    res.json({ message: 'Reaction added successfully' });
  } catch (error) {
    console.error('React to post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove reaction from post
router.delete('/:id/react/:reaction_type', requireAuth, async (req, res) => {
  const { id, reaction_type } = req.params;

  try {
    await query(
      'DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND reaction_type = $3',
      [id, req.session.userId, reaction_type]
    );

    res.json({ message: 'Reaction removed successfully' });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
