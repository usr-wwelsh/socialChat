const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Get all tags with optional search
router.get('/', async (req, res) => {
  try {
    const searchQuery = req.query.q;

    let result;
    if (searchQuery) {
      result = await query(
        'SELECT * FROM tags WHERE name LIKE $1 ORDER BY use_count DESC LIMIT 50',
        [`%${searchQuery}%`]
      );
    } else {
      result = await query(
        'SELECT * FROM tags ORDER BY use_count DESC LIMIT 100'
      );
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// Get trending tags (most used)
router.get('/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const result = await query(
      'SELECT * FROM tags ORDER BY use_count DESC LIMIT $1',
      [limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching trending tags:', error);
    res.status(500).json({ error: 'Failed to fetch trending tags' });
  }
});

// Get posts by tag
router.get('/:tagName/posts', async (req, res) => {
  try {
    const { tagName } = req.params;
    const limit = parseInt(req.query.limit) || 20; // Reduced for performance
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.session?.userId;

    // Step 1: Fetch posts for this tag
    const result = await query(
      `SELECT
         p.id, p.user_id, p.content, p.media_type, p.media_url, p.visibility,
         p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod,
         u.username, u.profile_picture as user_profile_picture,
         (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
         (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count
       FROM posts p
       INNER JOIN users u ON p.user_id = u.id
       INNER JOIN post_tags pt ON p.id = pt.post_id
       INNER JOIN tags t ON pt.tag_id = t.id
       WHERE t.name = $1
         AND p.deleted_by_mod = FALSE
         AND u.is_banned = FALSE
         AND (p.visibility = 'public' OR p.user_id = $2)
       GROUP BY p.id, u.id
       ORDER BY p.created_at DESC
       LIMIT $3 OFFSET $4`,
      [tagName, userId || null, limit, offset]
    );

    let posts = result.rows.map(post => ({ ...post, tags: [], preview_comments: [] }));

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

      const tagsByPost = {};
      for (const tag of tagsResult.rows) {
        if (!tagsByPost[tag.post_id]) tagsByPost[tag.post_id] = [];
        tagsByPost[tag.post_id].push({ id: tag.id, name: tag.name });
      }

      const commentsByPost = {};
      for (const comment of commentsResult.rows) {
        if (!commentsByPost[comment.post_id]) commentsByPost[comment.post_id] = [];
        if (commentsByPost[comment.post_id].length < 3) commentsByPost[comment.post_id].push(comment);
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

    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts by tag:', error);
    res.status(500).json({ error: 'Failed to fetch posts by tag' });
  }
});

module.exports = router;
