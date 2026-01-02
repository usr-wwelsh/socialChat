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
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.session?.userId;

    const result = await query(`
      SELECT
        p.id, p.content, p.media_type, p.media_data, p.visibility,
        p.audio_duration, p.audio_format,
        p.created_at, p.updated_at,
        u.id as user_id, u.username, u.profile_picture,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'type', pr.reaction_type,
              'count', (SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id AND reaction_type = pr.reaction_type)
            )
          ) FILTER (WHERE pr.reaction_type IS NOT NULL),
          '[]'
        ) as reactions,
        EXISTS(
          SELECT 1 FROM post_reactions
          WHERE post_id = p.id AND user_id = $2
        ) as user_reacted,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('id', t.id, 'name', t.name)
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'
        ) as tags
      FROM posts p
      INNER JOIN users u ON p.user_id = u.id
      INNER JOIN post_tags pt ON p.id = pt.post_id
      INNER JOIN tags t ON pt.tag_id = t.id
      LEFT JOIN post_reactions pr ON p.id = pr.post_id
      WHERE t.name = $1
        AND p.deleted_by_mod = FALSE
        AND u.is_banned = FALSE
        AND (p.visibility = 'public' OR p.user_id = $2)
      GROUP BY p.id, u.id
      ORDER BY p.created_at DESC
      LIMIT $3 OFFSET $4
    `, [tagName, userId || null, limit, offset]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching posts by tag:', error);
    res.status(500).json({ error: 'Failed to fetch posts by tag' });
  }
});

module.exports = router;
