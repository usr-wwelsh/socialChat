const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Export user data (GDPR-style data download)
router.get('/export-data', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId; // CRITICAL: Only use session userId, never trust client input!

    // Get user profile
    const userResult = await query(
      'SELECT id, username, bio, profile_picture, links, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get user's posts (only their posts, never others)
    const postsResult = await query(
      'SELECT id, content, media_type, media_url, visibility, audio_duration, audio_format, audio_title, genre, created_at FROM posts WHERE user_id = $1 AND deleted_by_mod = FALSE ORDER BY created_at DESC',
      [userId]
    );

    // Get user's messages (only messages THEY sent, not received)
    const messagesResult = await query(
      'SELECT id, chatroom_id, message, created_at FROM chat_messages WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    // Get user's friendships
    const friendshipsResult = await query(
      `SELECT
        f.id,
        f.status,
        f.created_at,
        CASE
          WHEN f.requester_id = $1 THEN u2.username
          ELSE u1.username
        END as friend_username,
        CASE
          WHEN f.requester_id = $1 THEN 'sent'
          ELSE 'received'
        END as request_direction
      FROM friendships f
      LEFT JOIN users u1 ON f.requester_id = u1.id
      LEFT JOIN users u2 ON f.receiver_id = u2.id
      WHERE f.requester_id = $1 OR f.receiver_id = $1
      ORDER BY f.created_at DESC`,
      [userId]
    );

    // Get user's reactions
    const reactionsResult = await query(
      'SELECT pr.post_id, pr.created_at FROM post_reactions pr WHERE pr.user_id = $1 ORDER BY pr.created_at DESC',
      [userId]
    );

    // Get user's comments
    const commentsResult = await query(
      'SELECT id, post_id, content, created_at FROM comments WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [userId]
    );

    // Assemble complete data export
    const exportData = {
      exportDate: new Date().toISOString(),
      exportedBy: user.username,
      profile: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        profilePicture: user.profile_picture,
        links: user.links,
        accountCreated: user.created_at
      },
      posts: postsResult.rows.map(post => ({
        id: post.id,
        content: post.content,
        mediaType: post.media_type,
        mediaUrl: post.media_url || null,
        visibility: post.visibility,
        audioDuration: post.audio_duration,
        audioFormat: post.audio_format,
        audioTitle: post.audio_title,
        genre: post.genre,
        createdAt: post.created_at
      })),
      messages: messagesResult.rows.map(msg => ({
        id: msg.id,
        chatroomId: msg.chatroom_id,
        message: msg.message,
        sentAt: msg.created_at
      })),
      friendships: friendshipsResult.rows.map(f => ({
        id: f.id,
        friendUsername: f.friend_username,
        status: f.status,
        direction: f.request_direction,
        createdAt: f.created_at
      })),
      reactions: reactionsResult.rows.map(r => ({
        postId: r.post_id,
        reactedAt: r.created_at
      })),
      comments: commentsResult.rows.map(c => ({
        id: c.id,
        postId: c.post_id,
        content: c.content,
        createdAt: c.created_at
      })),
      summary: {
        totalPosts: postsResult.rows.length,
        totalMessages: messagesResult.rows.length,
        totalFriends: friendshipsResult.rows.filter(f => f.status === 'accepted').length,
        totalReactions: reactionsResult.rows.length,
        totalComments: commentsResult.rows.length
      }
    };

    res.json(exportData);
  } catch (error) {
    console.error('Export data error:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ error: 'Failed to export data', details: error.message });
  }
});

module.exports = router;
