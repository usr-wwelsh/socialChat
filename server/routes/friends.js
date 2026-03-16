const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Helper function to ensure proper ID ordering (requester < receiver)
function orderIds(id1, id2) {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

// GET /api/friends - Get user's friends list
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await query(
      `SELECT
        f.id, f.status, f.created_at, f.display_order, f.requester_id, f.receiver_id,
        rqu.id as rqu_id, rqu.username as rqu_username, rqu.profile_picture as rqu_profile_picture, rqu.bio as rqu_bio,
        ru.id as ru_id, ru.username as ru_username, ru.profile_picture as ru_profile_picture, ru.bio as ru_bio
       FROM friendships f
       JOIN users rqu ON f.requester_id = rqu.id
       JOIN users ru ON f.receiver_id = ru.id
       WHERE (f.requester_id = $1 OR f.receiver_id = $1)
         AND f.status = 'accepted'
       ORDER BY f.display_order DESC, f.created_at DESC`,
      [userId]
    );

    const friends = result.rows.map(row => ({
      id: row.id, status: row.status, created_at: row.created_at,
      display_order: row.display_order, requester_id: row.requester_id, receiver_id: row.receiver_id,
      requester: { id: row.rqu_id, username: row.rqu_username, profile_picture: row.rqu_profile_picture, bio: row.rqu_bio },
      receiver: { id: row.ru_id, username: row.ru_username, profile_picture: row.ru_profile_picture, bio: row.ru_bio }
    }));
    res.json({ friends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/friends/user/:userId - Get friends list for a specific user (public view)
router.get('/user/:userId', async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    console.log('GET /api/friends/user/:userId - Target user ID:', targetUserId);

    if (!targetUserId || isNaN(targetUserId)) {
      console.log('Invalid user ID:', req.params.userId);
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const result = await query(
      `SELECT
        f.id,
        f.display_order,
        CASE
          WHEN f.requester_id = $1 THEN ru.id
          ELSE rqu.id
        END as friend_id,
        CASE
          WHEN f.requester_id = $1 THEN ru.username
          ELSE rqu.username
        END as username,
        CASE
          WHEN f.requester_id = $1 THEN ru.profile_picture
          ELSE rqu.profile_picture
        END as profile_picture,
        CASE
          WHEN f.requester_id = $1 THEN ru.bio
          ELSE rqu.bio
        END as bio
       FROM friendships f
       JOIN users rqu ON f.requester_id = rqu.id
       JOIN users ru ON f.receiver_id = ru.id
       WHERE (f.requester_id = $1 OR f.receiver_id = $1)
         AND f.status = 'accepted'
       ORDER BY f.display_order DESC, f.created_at DESC`,
      [targetUserId]
    );

    console.log('Query returned', result.rows.length, 'friends');
    res.json({ friends: result.rows });
  } catch (error) {
    console.error('Get user friends error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/friends/requests/received - Get received friend requests
router.get('/requests/received', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await query(
      `SELECT
        f.id, f.status, f.created_at, f.requester_id,
        u.id as u_id, u.username, u.profile_picture, u.bio
       FROM friendships f
       JOIN users u ON f.requester_id = u.id
       WHERE f.receiver_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );

    const requests = result.rows.map(row => ({
      id: row.id, status: row.status, created_at: row.created_at, requester_id: row.requester_id,
      requester: { id: row.u_id, username: row.username, profile_picture: row.profile_picture, bio: row.bio }
    }));
    res.json({ requests });
  } catch (error) {
    console.error('Get received requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/friends/requests/sent - Get sent friend requests
router.get('/requests/sent', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const result = await query(
      `SELECT
        f.id, f.status, f.created_at, f.receiver_id,
        u.id as u_id, u.username, u.profile_picture, u.bio
       FROM friendships f
       JOIN users u ON f.receiver_id = u.id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );

    const requests = result.rows.map(row => ({
      id: row.id, status: row.status, created_at: row.created_at, receiver_id: row.receiver_id,
      receiver: { id: row.u_id, username: row.username, profile_picture: row.profile_picture, bio: row.bio }
    }));
    res.json({ requests });
  } catch (error) {
    console.error('Get sent requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/friends/request - Send friend request
router.post('/request', requireAuth, async (req, res) => {
  const targetUserId = parseInt(req.body.receiver_id);
  const currentUserId = req.session.userId;

  if (!targetUserId) {
    return res.status(400).json({ error: 'receiver_id is required' });
  }

  if (targetUserId === currentUserId) {
    return res.status(400).json({ error: 'Cannot send friend request to yourself' });
  }

  try {
    // Check if target user exists
    const userCheck = await query('SELECT id FROM users WHERE id = $1', [targetUserId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Order IDs properly
    const [requesterId, receiverId] = orderIds(currentUserId, targetUserId);

    // Check if friendship already exists
    const existingFriendship = await query(
      'SELECT id, status FROM friendships WHERE requester_id = $1 AND receiver_id = $2',
      [requesterId, receiverId]
    );

    if (existingFriendship.rows.length > 0) {
      const friendship = existingFriendship.rows[0];
      if (friendship.status === 'accepted') {
        return res.status(409).json({ error: 'Already friends' });
      } else if (friendship.status === 'pending') {
        return res.status(409).json({ error: 'Friend request already sent' });
      } else if (friendship.status === 'rejected') {
        // Update rejected to pending
        await query(
          `UPDATE friendships SET status = 'pending', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [friendship.id]
        );
        return res.json({ message: 'Friend request resent successfully' });
      }
    }

    // Create new friendship request
    const result = await query(
      `INSERT INTO friendships (requester_id, receiver_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, requester_id, receiver_id, status, created_at`,
      [requesterId, receiverId]
    );

    res.status(201).json({
      message: 'Friend request sent successfully',
      friendship: result.rows[0]
    });
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/friends/:friendshipId/accept - Accept friend request
router.put('/:friendshipId/accept', requireAuth, async (req, res) => {
  const friendshipId = parseInt(req.params.friendshipId);
  const userId = req.session.userId;

  try {
    // Check if friendship exists and user is the receiver
    const friendship = await query(
      'SELECT * FROM friendships WHERE id = $1',
      [friendshipId]
    );

    if (friendship.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    const friendshipData = friendship.rows[0];

    // User must be the receiver (only the person being requested can accept)
    if (friendshipData.receiver_id !== userId) {
      return res.status(403).json({ error: 'Only the receiver can accept this friend request' });
    }

    if (friendshipData.status !== 'pending') {
      return res.status(400).json({ error: 'Friend request is not pending' });
    }

    // Accept the friendship
    await query(
      `UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [friendshipId]
    );

    res.json({ message: 'Friend request accepted successfully' });
  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/friends/:friendshipId/reject - Reject friend request
router.put('/:friendshipId/reject', requireAuth, async (req, res) => {
  const friendshipId = parseInt(req.params.friendshipId);
  const userId = req.session.userId;

  try {
    const friendship = await query(
      'SELECT * FROM friendships WHERE id = $1',
      [friendshipId]
    );

    if (friendship.rows.length === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    const friendshipData = friendship.rows[0];

    // User must be the receiver
    if (friendshipData.receiver_id !== userId && friendshipData.requester_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to reject this request' });
    }

    if (friendshipData.status !== 'pending') {
      return res.status(400).json({ error: 'Friend request is not pending' });
    }

    // Reject the friendship
    await query(
      `UPDATE friendships SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [friendshipId]
    );

    res.json({ message: 'Friend request rejected successfully' });
  } catch (error) {
    console.error('Reject friend request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/friends/:friendshipId - Unfriend/Cancel request
router.delete('/:friendshipId', requireAuth, async (req, res) => {
  const friendshipId = parseInt(req.params.friendshipId);
  const userId = req.session.userId;

  try {
    const friendship = await query(
      'SELECT * FROM friendships WHERE id = $1',
      [friendshipId]
    );

    if (friendship.rows.length === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    const friendshipData = friendship.rows[0];

    // User must be either requester or receiver
    if (friendshipData.requester_id !== userId && friendshipData.receiver_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this friendship' });
    }

    // Delete the friendship
    await query('DELETE FROM friendships WHERE id = $1', [friendshipId]);

    res.json({ message: 'Friendship removed successfully' });
  } catch (error) {
    console.error('Delete friendship error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/friends/status/:userId - Check friendship status with user
router.get('/status/:userId', requireAuth, async (req, res) => {
  const targetUserId = parseInt(req.params.userId);
  const currentUserId = req.session.userId;

  if (targetUserId === currentUserId) {
    return res.json({ status: 'self' });
  }

  try {
    const [requesterId, receiverId] = orderIds(currentUserId, targetUserId);

    const result = await query(
      `SELECT id, status, requester_id, receiver_id FROM friendships
       WHERE requester_id = $1 AND receiver_id = $2`,
      [requesterId, receiverId]
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'none', friendshipId: null });
    }

    const friendship = result.rows[0];
    const isRequester = friendship.requester_id === currentUserId;

    res.json({
      status: friendship.status,
      friendshipId: friendship.id,
      isRequester: isRequester
    });
  } catch (error) {
    console.error('Check friendship status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/friends/reorder - Update friend display order (MySpace-style top friends)
router.put('/reorder', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { friendOrders } = req.body; // Array of {friendshipId, displayOrder}

  if (!Array.isArray(friendOrders)) {
    return res.status(400).json({ error: 'friendOrders must be an array' });
  }

  try {
    // Verify all friendships belong to the current user
    for (const item of friendOrders) {
      const { friendshipId, displayOrder } = item;

      if (!friendshipId || displayOrder === undefined) {
        return res.status(400).json({ error: 'Each item must have friendshipId and displayOrder' });
      }

      // Verify ownership
      const result = await query(
        'SELECT id FROM friendships WHERE id = $1 AND (requester_id = $2 OR receiver_id = $2) AND status = \'accepted\'',
        [friendshipId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: `Unauthorized to reorder friendship ${friendshipId}` });
      }

      // Update display order
      await query(
        'UPDATE friendships SET display_order = $1 WHERE id = $2',
        [displayOrder, friendshipId]
      );
    }

    res.json({ message: 'Friend order updated successfully' });
  } catch (error) {
    console.error('Reorder friends error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
