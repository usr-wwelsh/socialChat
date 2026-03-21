const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const botService = require('../services/botService');

const router = express.Router();

// ===== REPORTING =====

// Submit a report (any user)
router.post('/report', requireAuth, async (req, res) => {
  const { report_type, reported_user_id, content_id, reason } = req.body;

  if (!report_type || !reason) {
    return res.status(400).json({ error: 'Report type and reason are required' });
  }

  if (!['post', 'message', 'user'].includes(report_type)) {
    return res.status(400).json({ error: 'Invalid report type' });
  }

  try {
    await query(
      `INSERT INTO reports (reporter_id, reported_user_id, report_type, content_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.session.userId, reported_user_id, report_type, content_id, reason]
    );

    res.json({ message: 'Report submitted successfully' });
  } catch (error) {
    console.error('Submit report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== ADMIN ONLY ROUTES =====

// Get all reports
router.get('/reports', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';

  try {
    const result = await query(
      `SELECT r.*,
       reporter.username as reporter_username,
       reported.username as reported_username,
       reviewer.username as reviewer_username
       FROM reports r
       LEFT JOIN users reporter ON r.reporter_id = reporter.id
       LEFT JOIN users reported ON r.reported_user_id = reported.id
       LEFT JOIN users reviewer ON r.reviewed_by = reviewer.id
       WHERE r.status = $1
       ORDER BY r.created_at DESC`,
      [status]
    );

    res.json({ reports: result.rows });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark report as reviewed/resolved
router.put('/reports/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['pending', 'reviewed', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    await query(
      `UPDATE reports
       SET status = $1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [status, req.session.userId, id]
    );

    res.json({ message: 'Report updated successfully' });
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== BAN/UNBAN USER =====

// Ban a user
router.post('/ban/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    // Ban the user
    await query(
      `UPDATE users
       SET is_banned = TRUE, banned_at = CURRENT_TIMESTAMP, banned_by = $1
       WHERE id = $2`,
      [req.session.userId, userId]
    );

    // Mark all their posts as deleted by mod
    await query(
      'UPDATE posts SET deleted_by_mod = TRUE WHERE user_id = $1',
      [userId]
    );

    // Mark all their messages as deleted by mod
    await query(
      'UPDATE chat_messages SET deleted_by_mod = TRUE WHERE user_id = $1',
      [userId]
    );

    res.json({ message: 'User banned and all content removed' });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unban a user
router.post('/unban/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    await query(
      'UPDATE users SET is_banned = FALSE, banned_at = NULL, banned_by = NULL WHERE id = $1',
      [userId]
    );

    res.json({ message: 'User unbanned successfully' });
  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== DELETE SPECIFIC CONTENT =====

// Delete a specific post
router.delete('/posts/:postId', requireAdmin, async (req, res) => {
  const { postId } = req.params;

  try {
    await query(
      'UPDATE posts SET deleted_by_mod = TRUE WHERE id = $1',
      [postId]
    );

    res.json({ message: 'Post removed' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a specific message
router.delete('/messages/:messageId', requireAdmin, async (req, res) => {
  const { messageId } = req.params;

  try {
    await query(
      'UPDATE chat_messages SET deleted_by_mod = TRUE WHERE id = $1',
      [messageId]
    );

    res.json({ message: 'Message removed' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== DASHBOARD STATS =====

// Get moderation dashboard stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const pendingReports = await query(
      'SELECT COUNT(*) as count FROM reports WHERE status = $1',
      ['pending']
    );

    const bannedUsers = await query(
      'SELECT COUNT(*) as count FROM users WHERE is_banned = TRUE'
    );

    const totalUsers = await query('SELECT COUNT(*) as count FROM users');

    const totalPosts = await query('SELECT COUNT(*) as count FROM posts WHERE deleted_by_mod = FALSE');

    const removedPosts = await query('SELECT COUNT(*) as count FROM posts WHERE deleted_by_mod = TRUE');

    res.json({
      pendingReports: parseInt(pendingReports.rows[0].count),
      bannedUsers: parseInt(bannedUsers.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count),
      totalPosts: parseInt(totalPosts.rows[0].count),
      removedPosts: parseInt(removedPosts.rows[0].count)
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (for admin management)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, is_banned, banned_at, created_at,
       (SELECT COUNT(*) FROM posts WHERE user_id = users.id AND deleted_by_mod = FALSE) as post_count,
       (SELECT COUNT(*) FROM reports WHERE reported_user_id = users.id) as report_count
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== BOT CONTROLS =====

// Get list of bot usernames (admin only)
router.get('/bot/list', requireAuth, requireAdmin, (req, res) => {
  const bots = botService.getBotConfigs().map(b => ({ username: b.username, style: b.style }));
  res.json({ bots });
});

// Force an immediate bot post (admin only)
router.post('/bot/trigger', requireAuth, requireAdmin, async (req, res) => {
  if (!botService.enabled) {
    return res.status(400).json({ error: 'Bot service is not enabled' });
  }

  const { username } = req.body;

  // If a specific bot was requested, temporarily override selection
  if (username) {
    const botIndex = botService.botUsers.findIndex(b => b.username === username);
    if (botIndex === -1) {
      return res.status(400).json({ error: `Bot "${username}" not found` });
    }
    // Monkey-patch selectNextBot just for this call
    const origSelect = botService.selectNextBot.bind(botService);
    botService.selectNextBot = () => { botService.selectNextBot = origSelect; return botIndex; };
  }

  // Reset cooldown so the post fires immediately
  botService.lastPostTime = 0;

  try {
    await botService.createBotPost();
    res.json({ message: 'Bot post triggered' });
  } catch (error) {
    console.error('Bot trigger error:', error);
    res.status(500).json({ error: 'Failed to trigger bot post' });
  }
});

// Schedule a burst of bot posts staggered over 24 hours (admin only)
router.post('/bot/burst', requireAuth, requireAdmin, async (req, res) => {
  if (!botService.enabled) {
    return res.status(400).json({ error: 'Bot service is not enabled' });
  }

  const count = Math.min(parseInt(req.body.count || '10'), 20); // cap at 20

  try {
    const scheduled = await botService.scheduleBurstPosts(count);
    res.json({ message: `${scheduled.length} posts scheduled over 24 hours`, scheduled });
  } catch (error) {
    console.error('Bot burst error:', error);
    res.status(500).json({ error: error.message || 'Failed to schedule burst' });
  }
});

module.exports = router;
