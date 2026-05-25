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
let botService = null;
router.setSocketIO = (socketIO) => {
  io = socketIO;
};
router.setBotService = (bs) => {
  botService = bs;
};

// Fetch and attach the embedded `quoted_post` object to any post that quotes another.
// A mod-removed, banned-author, or missing quoted post is returned as { redacted: true }
// so the original text never leaks. (quoted_post_id is SET NULL on hard delete.)
async function attachQuotedPosts(posts) {
  const quotedIds = [...new Set(posts.filter(p => p.quoted_post_id).map(p => p.quoted_post_id))];
  if (quotedIds.length === 0) {
    return posts.map(p => ({ ...p, quoted_post: null }));
  }

  const ph = quotedIds.map((_, i) => `$${i + 1}`).join(',');
  const qResult = await query(
    `SELECT p.id, p.content, p.media_type, p.media_url, p.created_at, p.deleted_by_mod,
       u.username, u.is_banned, u.profile_picture as user_profile_picture
     FROM posts p JOIN users u ON p.user_id = u.id
     WHERE p.id IN (${ph})`,
    quotedIds
  );

  const mediaResult = await query(
    `SELECT post_id, media_url FROM post_media WHERE post_id IN (${ph}) ORDER BY post_id, position ASC`,
    quotedIds
  );
  const mediaByPost = {};
  for (const m of mediaResult.rows) {
    if (!mediaByPost[m.post_id]) mediaByPost[m.post_id] = [];
    mediaByPost[m.post_id].push(m.media_url);
  }

  const byId = {};
  for (const q of qResult.rows) {
    const urls = (mediaByPost[q.id] && mediaByPost[q.id].length)
      ? mediaByPost[q.id]
      : (q.media_url ? [q.media_url] : []);
    byId[q.id] = (q.deleted_by_mod || q.is_banned)
      ? { id: q.id, redacted: true }
      : {
          id: q.id,
          content: q.content,
          username: q.username,
          user_profile_picture: q.user_profile_picture,
          created_at: q.created_at,
          media_type: q.media_type,
          media_url: urls[0] || null,
          media_urls: urls,
          redacted: false
        };
  }

  return posts.map(p => ({
    ...p,
    quoted_post: p.quoted_post_id
      ? (byId[p.quoted_post_id] || { id: p.quoted_post_id, redacted: true })
      : null
  }));
}
router.attachQuotedPosts = attachQuotedPosts;

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
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod, p.is_pinned, p.quoted_post_id,
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
       ORDER BY p.is_pinned DESC, p.created_at DESC
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

      // Batch fetch post_media (multiple images)
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

      posts = posts.map(post => ({
        ...post,
        tags: tagsByPost[post.id] || [],
        preview_comments: commentsByPost[post.id] || [],
        media_urls: mediaByPost[post.id] || []
      }));
    }

    posts = await attachQuotedPosts(posts);

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

// Get media-only posts feed (for Explore grid)
router.get('/media', async (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const offset = parseInt(req.query.offset) || 0;
  const userId = req.session?.userId;

  try {
    const result = await query(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.created_at, p.updated_at,
         u.username, u.profile_picture as user_profile_picture,
         (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count,
         (SELECT EXISTS(SELECT 1 FROM post_reactions WHERE post_id = p.id AND user_id = $3 AND reaction_type = 'like')) as is_liked
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.deleted_by_mod = FALSE
         AND u.is_banned = FALSE
         AND p.media_url IS NOT NULL
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

    const posts = result.rows.map(post => ({ ...post, tags: [], preview_comments: [] }));
    const hasMore = posts.length === limit;
    res.json({ posts, has_more: hasMore });
  } catch (error) {
    console.error('Get media feed error:', error);
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

// Get single post by ID (full detail: reactions, comment count, preview comments, tags, media)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.session?.userId;

  try {
    const result = await query(
      `SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod, p.is_pinned, p.quoted_post_id,
         u.username, u.profile_picture as user_profile_picture,
         (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count,
         (SELECT EXISTS(SELECT 1 FROM post_reactions WHERE post_id = p.id AND user_id = $2 AND reaction_type = 'like')) as is_liked
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = $1`,
      [id, userId || null]
    );

    if (result.rows.length === 0 || result.rows[0].deleted_by_mod) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const tagsResult = await query(
      `SELECT t.id, t.name FROM post_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.post_id = $1`,
      [id]
    );
    const commentsResult = await query(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, c.updated_at, c.deleted_at,
         u.username, u.profile_picture,
         (SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id) as reaction_count
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC LIMIT 3`,
      [id]
    );
    const mediaResult = await query(
      `SELECT media_url FROM post_media WHERE post_id = $1 ORDER BY position ASC`,
      [id]
    );

    let post = {
      ...result.rows[0],
      tags: tagsResult.rows,
      preview_comments: commentsResult.rows,
      media_urls: mediaResult.rows.map(r => r.media_url)
    };
    [post] = await attachQuotedPosts([post]);
    res.json({ post });
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
  // For multi-image: req.mediaFiles has all; req.mediaUrl has first
  const media_url = req.mediaUrl || null;
  const visibility = req.body.visibility || 'public';
  const audio_duration = req.body.audio_duration ? parseInt(req.body.audio_duration) : null;
  const audio_format = req.body.audio_format || null;
  const allMediaFiles = req.mediaFiles || (media_url ? [{ url: media_url }] : []);
  let quoted_post_id = parseInt(req.body.quoted_post_id);
  if (isNaN(quoted_post_id)) quoted_post_id = null;

  // Validation — a quote-post may have empty commentary
  if ((!content || content.trim().length === 0) && !quoted_post_id) {
    for (const f of allMediaFiles) deleteMedia(f.url);
    return res.status(400).json({ error: 'Content is required' });
  }

  if (content.length > 5000) {
    for (const f of allMediaFiles) deleteMedia(f.url);
    return res.status(400).json({ error: 'Content exceeds 5000 characters' });
  }

  // Validate media type
  if (media_type && !['image', 'video', 'audio'].includes(media_type)) {
    for (const f of allMediaFiles) deleteMedia(f.url);
    return res.status(400).json({ error: 'Invalid media type. Must be "image", "video", or "audio"' });
  }

  // Validate visibility
  const validVisibility = ['public', 'friends', 'private'];
  const postVisibility = visibility && validVisibility.includes(visibility) ? visibility : 'public';

  try {
    // Validate the quoted post exists and isn't mod-removed; drop the ref otherwise
    if (quoted_post_id) {
      const q = await query('SELECT id, deleted_by_mod FROM posts WHERE id = $1', [quoted_post_id]);
      if (q.rows.length === 0 || q.rows[0].deleted_by_mod) quoted_post_id = null;
    }

    // Insert post (media_url = first image for backwards compat)
    const result = await query(
      `INSERT INTO posts (user_id, content, media_type, media_url, visibility, audio_duration, audio_format, quoted_post_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, content, media_type, media_url, visibility, audio_duration, audio_format, created_at, updated_at, quoted_post_id`,
      [req.session.userId, content.trim(), media_type || null, media_url, postVisibility, audio_duration, audio_format, quoted_post_id]
    );

    const post = result.rows[0];

    // Insert all image files into post_media (enables multi-image slideshow)
    if (media_type === 'image' && allMediaFiles.length > 0) {
      for (let i = 0; i < allMediaFiles.length; i++) {
        await query(
          'INSERT INTO post_media (post_id, media_url, position) VALUES ($1, $2, $3)',
          [post.id, allMediaFiles[i].url, i]
        );
      }
    }

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

    const [postData] = await attachQuotedPosts([{
      ...post,
      username: userResult.rows[0].username,
      user_profile_picture: userResult.rows[0].profile_picture,
      reaction_count: 0,
      tags: tagsResult.rows,
      media_urls: allMediaFiles.map(f => f.url)
    }]);

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

    // Fire botfight asynchronously — doesn't block the response
    if (botService && hashtags.includes('botfight') && postVisibility === 'public') {
      botService.triggerBotFight(post.id, content.trim(), userResult.rows[0].username)
        .catch(err => console.error('[BotFight] Unhandled error:', err));
    }
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
      // New media uploaded — delete old files and use new URL
      const oldMediaRows = await query('SELECT media_url FROM post_media WHERE post_id = $1', [id]);
      if (oldMediaRows.rows.length > 0) {
        for (const row of oldMediaRows.rows) deleteMedia(row.media_url);
        await query('DELETE FROM post_media WHERE post_id = $1', [id]);
      } else {
        deleteMedia(checkResult.rows[0].media_url);
      }
      // Insert new single media into post_media
      if ((req.body.media_type || null) === 'image') {
        await query('INSERT INTO post_media (post_id, media_url, position) VALUES ($1, $2, 0)', [id, req.mediaUrl]);
      }
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

    // Fetch all post_media URLs before cascade-delete
    const postMediaResult = await query(
      'SELECT media_url FROM post_media WHERE post_id = $1',
      [id]
    );

    // Delete post (reactions + post_media will cascade)
    await query('DELETE FROM posts WHERE id = $1', [id]);

    // Delete media files after DB deletion succeeds
    if (postMediaResult.rows.length > 0) {
      for (const row of postMediaResult.rows) deleteMedia(row.media_url);
    } else {
      // Old post: no post_media rows, use media_url directly
      deleteMedia(mediaUrl);
    }

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
