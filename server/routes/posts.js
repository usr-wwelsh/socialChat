const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { deleteMedia } = require('../media');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Simple in-memory cache for posts feed (TTL: 10 seconds)
const feedCache = new Map();
const CACHE_TTL = 10000; // 10 seconds

function getCachedFeed(key) {
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  feedCache.delete(key);
  return null;
}

function setCachedFeed(key, data) {
  feedCache.set(key, { data, timestamp: Date.now() });
  // Clean up old cache entries periodically
  if (feedCache.size > 100) {
    const oldestKey = feedCache.keys().next().value;
    feedCache.delete(oldestKey);
  }
}

// Clear cache when new posts are created or modified
function clearFeedCache() {
  feedCache.clear();
}

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
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  const userId = req.session?.userId;

  // Check cache (only for first page)
  if (offset === 0) {
    const cacheKey = `feed:${userId || 'public'}:${limit}`;
    const cached = getCachedFeed(cacheKey);
    if (cached) {
      return res.json({ posts: cached });
    }
  }

  try {
    const result = await query(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod,
         u.username, u.profile_picture as user_profile_picture,
         (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count,
         (SELECT EXISTS(SELECT 1 FROM post_reactions WHERE post_id = p.id AND user_id = $3 AND reaction_type = 'like')) as is_liked
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
       LIMIT $1 OFFSET $2`,
      [limit, offset, userId || null]
    );

    let posts = result.rows.map(post => ({ ...post, tags: [], preview_comments: [] }));

    if (posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const ph = postIds.map((_, i) => `$${i + 1}`).join(',');

      // Batch fetch tags
      const tagsResult = await query(
        `SELECT pt.post_id, t.id, t.name FROM post_tags pt
         JOIN tags t ON pt.tag_id = t.id
         WHERE pt.post_id IN (${ph})`,
        postIds
      );

      // Batch fetch preview comments
      const commentsResult = await query(
        `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, c.updated_at, c.deleted_at,
           u.username, u.profile_picture,
           (SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id) as reaction_count
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id IN (${ph}) AND c.deleted_at IS NULL
         ORDER BY c.post_id, c.created_at ASC`,
        postIds
      );

      const tagsByPost = {};
      for (const tag of tagsResult.rows) {
        if (!tagsByPost[tag.post_id]) tagsByPost[tag.post_id] = [];
        tagsByPost[tag.post_id].push({ id: tag.id, name: tag.name });
      }

      const commentsByPost = {};
      for (const comment of commentsResult.rows) {
        if (!commentsByPost[comment.post_id]) commentsByPost[comment.post_id] = [];
        if (commentsByPost[comment.post_id].length < 3) {
          commentsByPost[comment.post_id].push(comment);
        }
      }

      posts = posts.map(post => ({
        ...post,
        tags: tagsByPost[post.id] || [],
        preview_comments: commentsByPost[post.id] || []
      }));
    }

    // Cache first page results
    if (offset === 0) {
      const cacheKey = `feed:${userId || 'public'}:${limit}`;
      setCachedFeed(cacheKey, posts);
    }

    res.json({ posts: posts });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get media for a specific post (kept for backward compatibility)
router.get('/:id/media', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      'SELECT media_url, media_type FROM posts WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0 || !result.rows[0].media_url) {
      return res.status(404).json({ error: 'Media not found' });
    }

    res.json({
      media_url: result.rows[0].media_url,
      media_type: result.rows[0].media_type
    });
  } catch (error) {
    console.error('Get media error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single post by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod,
         u.username, u.profile_picture as user_profile_picture,
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
router.post('/', postCreationLimiter, requireAuth, uploadMiddleware, async (req, res) => {
  const content = req.body.content || '';
  const media_type = req.body.media_type || null;
  const media_url = req.mediaUrl || null;
  const visibility = req.body.visibility || 'public';
  const audio_duration = req.body.audio_duration ? parseInt(req.body.audio_duration) : null;
  const audio_format = req.body.audio_format || null;

  // Validation
  if (!content || content.trim().length === 0) {
    if (media_url) deleteMedia(media_url);
    return res.status(400).json({ error: 'Content is required' });
  }

  if (content.length > 5000) {
    if (media_url) deleteMedia(media_url);
    return res.status(400).json({ error: 'Content exceeds 5000 characters' });
  }

  // Validate media type
  if (media_type && !['image', 'video', 'audio'].includes(media_type)) {
    if (media_url) deleteMedia(media_url);
    return res.status(400).json({ error: 'Invalid media type. Must be "image", "video", or "audio"' });
  }

  // Validate visibility
  const validVisibility = ['public', 'friends', 'private'];
  const postVisibility = visibility && validVisibility.includes(visibility) ? visibility : 'public';

  try {
    // Insert post
    const result = await query(
      `INSERT INTO posts (user_id, content, media_type, media_url, visibility, audio_duration, audio_format)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, content, media_type, media_url, visibility, audio_duration, audio_format, created_at, updated_at`,
      [req.session.userId, content.trim(), media_type || null, media_url, postVisibility, audio_duration, audio_format]
    );

    const post = result.rows[0];

    // Parse and insert hashtags
    const hashtags = parseHashtags(content);
    if (hashtags.length > 0) {
      for (const tagName of hashtags) {
        const tagResult = await query(
          `INSERT INTO tags (name, use_count)
           VALUES ($1, 1)
           ON CONFLICT (name) DO UPDATE SET use_count = tags.use_count + 1
           RETURNING id`,
          [tagName]
        );

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

    // Clear feed cache since we have a new post
    clearFeedCache();

    // Broadcast new post to all connected clients
    if (io && postVisibility === 'public') {
      io.emit('new_post', postData);
    }

    res.status(201).json({
      message: 'Post created successfully',
      post: postData
    });
  } catch (error) {
    if (media_url) deleteMedia(media_url);
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit post
router.put('/:id', requireAuth, uploadMiddleware, async (req, res) => {
  const { id } = req.params;
  const content = req.body.content || '';

  if (!content || content.trim().length === 0) {
    if (req.mediaUrl) deleteMedia(req.mediaUrl);
    return res.status(400).json({ error: 'Content is required' });
  }

  if (content.length > 5000) {
    if (req.mediaUrl) deleteMedia(req.mediaUrl);
    return res.status(400).json({ error: 'Content exceeds 5000 characters' });
  }

  try {
    // Check if post belongs to user
    const checkResult = await query(
      'SELECT user_id, media_url FROM posts WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      if (req.mediaUrl) deleteMedia(req.mediaUrl);
      return res.status(404).json({ error: 'Post not found' });
    }

    if (checkResult.rows[0].user_id !== req.session.userId) {
      if (req.mediaUrl) deleteMedia(req.mediaUrl);
      return res.status(403).json({ error: 'Unauthorized to edit this post' });
    }

    let result;
    if (req.mediaUrl) {
      // New media uploaded — delete old file and use new URL
      deleteMedia(checkResult.rows[0].media_url);
      result = await query(
        `UPDATE posts
         SET content = $1, media_type = $2, media_url = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING id, user_id, content, media_type, media_url, created_at, updated_at`,
        [content.trim(), req.body.media_type || null, req.mediaUrl, id]
      );
    } else {
      // No new media — just update content, preserve existing media
      result = await query(
        `UPDATE posts
         SET content = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, user_id, content, media_type, media_url, created_at, updated_at`,
        [content.trim(), id]
      );
    }

    // Clear feed cache since post was updated
    clearFeedCache();

    res.json({
      message: 'Post updated successfully',
      post: result.rows[0]
    });
  } catch (error) {
    if (req.mediaUrl) deleteMedia(req.mediaUrl);
    console.error('Edit post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete post
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if post exists and get media_url for cleanup
    const checkResult = await query(
      'SELECT user_id, media_url FROM posts WHERE id = $1',
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

    const mediaUrl = checkResult.rows[0].media_url;

    // Delete post (reactions will cascade)
    await query('DELETE FROM posts WHERE id = $1', [id]);

    // Delete media file after DB deletion succeeds
    deleteMedia(mediaUrl);

    // Clear feed cache since post was deleted
    clearFeedCache();

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
