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
        'SELECT * FROM tags WHERE name ILIKE $1 ORDER BY use_count DESC LIMIT 50',
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

    // Optimized query - no media_data loading for performance
    const result = await query(`
      WITH post_data AS (
        SELECT
          p.id, p.user_id, p.content, p.media_type, p.visibility,
          p.audio_duration, p.audio_format, p.created_at, p.updated_at, p.deleted_by_mod,
          u.username, u.profile_picture as user_profile_picture,
          (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id) as reaction_count,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) as comment_count,
          COALESCE(
            (SELECT json_agg(DISTINCT jsonb_build_object('id', t2.id, 'name', t2.name))
             FROM post_tags pt2
             JOIN tags t2 ON pt2.tag_id = t2.id
             WHERE pt2.post_id = p.id),
            '[]'
          ) as tags
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
        LIMIT $3 OFFSET $4
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
      FROM post_data pd
    `, [tagName, userId || null, limit, offset]);

    // Parse JSON fields
    const posts = result.rows.map(post => ({
      ...post,
      tags: typeof post.tags === 'string' ? JSON.parse(post.tags) : post.tags,
      preview_comments: typeof post.preview_comments === 'string' ? JSON.parse(post.preview_comments) : post.preview_comments
    }));

    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts by tag:', error);
    res.status(500).json({ error: 'Failed to fetch posts by tag' });
  }
});

module.exports = router;
