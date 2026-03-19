const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

let io = null;
router.setSocketIO = (socketIO) => {
  io = socketIO;
};

// Helper: check that userId is a participant in conversationId
async function isParticipant(conversationId, userId) {
  const result = await query(
    'SELECT id FROM dm_conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
    [conversationId, userId]
  );
  return result.rows.length > 0;
}

// Helper: check accepted friendship between two users
async function areFriends(userA, userB) {
  const [u1, u2] = userA < userB ? [userA, userB] : [userB, userA];
  const result = await query(
    `SELECT id FROM friendships WHERE requester_id = $1 AND receiver_id = $2 AND status = 'accepted'`,
    [u1, u2]
  );
  return result.rows.length > 0;
}

// GET /api/dms/conversations — list user's conversations with partner info + public key
router.get('/conversations', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    const result = await query(
      `SELECT dc.id, dc.updated_at,
              CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END AS partner_id,
              u.username AS partner_username,
              u.profile_picture AS partner_avatar,
              u.public_key AS partner_public_key,
              (SELECT MAX(id) FROM dm_messages WHERE conversation_id = dc.id) AS last_message_id
       FROM dm_conversations dc
       JOIN users u ON u.id = CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END
       WHERE dc.user1_id = $1 OR dc.user2_id = $1
       ORDER BY dc.updated_at DESC`,
      [userId]
    );

    res.json({ conversations: result.rows });
  } catch (err) {
    console.error('List DM conversations error:', err);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// POST /api/dms/conversations — create conversation (validates accepted friendship)
router.post('/conversations', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { partnerId } = req.body;

  if (!partnerId || partnerId === userId) {
    return res.status(400).json({ error: 'Invalid partner' });
  }

  const partnerIdInt = parseInt(partnerId);
  if (isNaN(partnerIdInt)) {
    return res.status(400).json({ error: 'Invalid partner id' });
  }

  try {
    // Validate friendship
    if (!(await areFriends(userId, partnerIdInt))) {
      return res.status(403).json({ error: 'You can only DM friends' });
    }

    const [u1, u2] = userId < partnerIdInt ? [userId, partnerIdInt] : [partnerIdInt, userId];

    // Upsert conversation
    const existing = await query(
      'SELECT id FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2',
      [u1, u2]
    );

    if (existing.rows.length > 0) {
      return res.json({ conversation: existing.rows[0] });
    }

    const result = await query(
      `INSERT INTO dm_conversations (user1_id, user2_id) VALUES ($1, $2)
       RETURNING id, user1_id, user2_id, created_at, updated_at`,
      [u1, u2]
    );

    res.status(201).json({ conversation: result.rows[0] });
  } catch (err) {
    console.error('Create DM conversation error:', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/dms/conversation-with/:userId — check if conversation exists
router.get('/conversation-with/:userId', requireAuth, async (req, res) => {
  const myId = req.session.userId;
  const otherId = parseInt(req.params.userId);

  if (isNaN(otherId)) return res.status(400).json({ error: 'Invalid user id' });

  try {
    const [u1, u2] = myId < otherId ? [myId, otherId] : [otherId, myId];
    const result = await query(
      'SELECT id FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2',
      [u1, u2]
    );

    if (result.rows.length === 0) {
      return res.json({ conversation: null });
    }

    res.json({ conversation: result.rows[0] });
  } catch (err) {
    console.error('Check DM conversation error:', err);
    res.status(500).json({ error: 'Failed to check conversation' });
  }
});

// GET /api/dms/conversations/:id/messages — fetch encrypted messages
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const conversationId = parseInt(req.params.id);

  if (isNaN(conversationId)) return res.status(400).json({ error: 'Invalid conversation id' });

  try {
    if (!(await isParticipant(conversationId, userId))) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 100, 200);
    const result = await query(
      `SELECT dm.id, dm.conversation_id, dm.sender_id, dm.ciphertext, dm.iv, dm.created_at,
              u.username AS sender_username, u.profile_picture AS sender_avatar
       FROM dm_messages dm
       JOIN users u ON u.id = dm.sender_id
       WHERE dm.conversation_id = $1
       ORDER BY dm.created_at ASC
       LIMIT $2`,
      [conversationId, limit]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error('Fetch DM messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/dms/conversations/:id/messages — store encrypted message + emit socket event
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const conversationId = parseInt(req.params.id);
  const { ciphertext, iv } = req.body;

  if (isNaN(conversationId)) return res.status(400).json({ error: 'Invalid conversation id' });
  if (!ciphertext || !iv) return res.status(400).json({ error: 'Missing ciphertext or iv' });

  try {
    if (!(await isParticipant(conversationId, userId))) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    // Get conversation to find recipient
    const convResult = await query(
      'SELECT user1_id, user2_id FROM dm_conversations WHERE id = $1',
      [conversationId]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conv = convResult.rows[0];
    const recipientId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;

    // Validate friendship still active
    if (!(await areFriends(userId, recipientId))) {
      return res.status(403).json({ error: 'You can only DM friends' });
    }

    // Insert message
    const msgResult = await query(
      `INSERT INTO dm_messages (conversation_id, sender_id, ciphertext, iv)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, sender_id, ciphertext, iv, created_at`,
      [conversationId, userId, ciphertext, iv]
    );

    // Update conversation timestamp and return it
    const convUpdateResult = await query(
      `UPDATE dm_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING updated_at`,
      [conversationId]
    );
    const updatedAt = convUpdateResult.rows[0].updated_at;

    const userRes = await query('SELECT username, profile_picture FROM users WHERE id = $1', [userId]);
    const message = {
      ...msgResult.rows[0],
      sender_username: userRes.rows[0].username,
      sender_avatar: userRes.rows[0].profile_picture
    };

    // Emit to DM room
    if (io) {
      io.to(`dm_${conversationId}`).emit('new_dm', message);
      // Notify recipient for unread badge
      io.to(`user_${recipientId}`).emit('dm_notification', {
        conversationId,
        senderId: userId,
        senderUsername: userRes.rows[0].username
      });
    }

    res.status(201).json({ message, updatedAt, lastMessageId: msgResult.rows[0].id });
  } catch (err) {
    console.error('Send DM error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
