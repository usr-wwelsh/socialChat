const { query } = require('../db');

// Helper function to broadcast user count for a chatroom
const broadcastUserCount = (io, chatroomId) => {
  const room = io.sockets.adapter.rooms.get(`chatroom_${chatroomId}`);
  const userCount = room ? room.size : 0;
  io.to(`chatroom_${chatroomId}`).emit('user_count_update', { userCount });
};

// Socket message throttling - Track last message time per socket
const messageThrottleMap = new Map();
const MESSAGE_COOLDOWN_MS = 1000; // 1 second between messages
const MAX_MESSAGES_PER_MINUTE = 10;

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Check if user is authenticated or guest
    const session = socket.request.session;
    const userId = session.userId;
    const username = session.username;
    const isGuest = session.isGuest;
    const guestId = session.guestId;
    const guestName = session.guestName;

    // Allow both authenticated users and guests
    const displayName = isGuest ? guestName : username;
    const userIdentifier = isGuest ? guestId : userId;

    if (!userIdentifier) {
      console.log('No user identifier found');
      socket.disconnect();
      return;
    }

    console.log(`${isGuest ? 'Guest' : 'User'} connected: ${displayName}`);

    // Initialize message tracking for this socket
    messageThrottleMap.set(socket.id, {
      lastMessageTime: 0,
      messageCount: 0,
      countResetTime: Date.now()
    });

    // Track current chatroom
    let currentChatroomId = null;

    // Join personal room for DM notifications (authenticated users only)
    if (userId) {
      socket.join(`user_${userId}`);
    }

    // Join a chatroom
    socket.on('join_chatroom', async (chatroomId) => {
      currentChatroomId = chatroomId;
      try {
        // Verify chatroom exists
        const result = await query(
          'SELECT id, name FROM chatrooms WHERE id = $1',
          [chatroomId]
        );

        if (result.rows.length === 0) {
          socket.emit('error', { message: 'Chatroom not found' });
          return;
        }

        const chatroom = result.rows[0];
        socket.join(`chatroom_${chatroomId}`);
        console.log(`${displayName} joined chatroom: ${chatroom.name}`);

        socket.emit('joined_chatroom', {
          chatroomId,
          chatroomName: chatroom.name
        });

        // Broadcast updated user count
        broadcastUserCount(io, chatroomId);
      } catch (error) {
        console.error('Join chatroom error:', error);
        socket.emit('error', { message: 'Failed to join chatroom' });
      }
    });

    // Leave a chatroom
    socket.on('leave_chatroom', (chatroomId) => {
      socket.leave(`chatroom_${chatroomId}`);
      console.log(`${displayName} left chatroom ${chatroomId}`);

      // Broadcast updated user count
      broadcastUserCount(io, chatroomId);
    });

    // Send message to chatroom
    socket.on('send_message', async (data) => {
      const { chatroomId, message } = data;

      if (!message || message.trim().length === 0) {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }

      if (message.length > 2000) {
        socket.emit('error', { message: 'Message exceeds 2000 characters' });
        return;
      }

      // Throttling check
      const throttleData = messageThrottleMap.get(socket.id);
      if (throttleData) {
        const now = Date.now();

        // Check cooldown between messages (1 second)
        if (now - throttleData.lastMessageTime < MESSAGE_COOLDOWN_MS) {
          socket.emit('error', { message: 'Please wait a moment before sending another message' });
          return;
        }

        // Reset message count every minute
        if (now - throttleData.countResetTime > 60000) {
          throttleData.messageCount = 0;
          throttleData.countResetTime = now;
        }

        // Check messages per minute limit
        if (throttleData.messageCount >= MAX_MESSAGES_PER_MINUTE) {
          socket.emit('error', { message: 'Too many messages. Please slow down.' });
          return;
        }

        // Update throttle data
        throttleData.lastMessageTime = now;
        throttleData.messageCount++;
      }

      try {
        let messageData;

        if (isGuest) {
          // Insert guest message
          const result = await query(
            `INSERT INTO chat_messages (chatroom_id, message, guest_name, guest_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id, chatroom_id, message, guest_name, guest_id, created_at`,
            [chatroomId, message, guestName, guestId]
          );

          messageData = {
            ...result.rows[0],
            username: guestName,
            profile_picture: null,
            is_guest: true
          };
        } else {
          // Insert authenticated user message
          const result = await query(
            `INSERT INTO chat_messages (user_id, chatroom_id, message)
             VALUES ($1, $2, $3)
             RETURNING id, user_id, chatroom_id, message, created_at`,
            [userId, chatroomId, message]
          );

          const newMessage = result.rows[0];

          // Get user info
          const userResult = await query(
            'SELECT username, profile_picture FROM users WHERE id = $1',
            [userId]
          );

          messageData = {
            ...newMessage,
            username: userResult.rows[0].username,
            profile_picture: userResult.rows[0].profile_picture,
            is_guest: false
          };
        }

        // Broadcast message to all users in the chatroom
        io.to(`chatroom_${chatroomId}`).emit('new_message', messageData);

        console.log(`Message sent by ${displayName} in chatroom ${chatroomId}`);
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { chatroomId } = data;
      socket.to(`chatroom_${chatroomId}`).emit('user_typing', {
        username: displayName,
        userId: userIdentifier,
        isGuest: isGuest
      });
    });

    socket.on('stop_typing', (data) => {
      const { chatroomId } = data;
      socket.to(`chatroom_${chatroomId}`).emit('user_stop_typing', {
        username: displayName,
        userId: userIdentifier,
        isGuest: isGuest
      });
    });

    // DM socket events (authenticated users only)
    if (userId) {
      socket.on('join_dm', async (conversationId) => {
        try {
          const result = await query(
            'SELECT id FROM dm_conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
            [conversationId, userId]
          );
          if (result.rows.length === 0) {
            socket.emit('error', { message: 'DM conversation not found or unauthorized' });
            return;
          }
          socket.join(`dm_${conversationId}`);
        } catch (err) {
          console.error('join_dm error:', err);
        }
      });

      socket.on('leave_dm', (conversationId) => {
        socket.leave(`dm_${conversationId}`);
      });

      socket.on('dm_typing', (conversationId) => {
        socket.to(`dm_${conversationId}`).emit('dm_user_typing', { userId, username: displayName });
      });

      socket.on('dm_stop_typing', (conversationId) => {
        socket.to(`dm_${conversationId}`).emit('dm_user_stop_typing', { userId });
      });
    }

    // Handle message deletion via socket
    socket.on('delete_message', async (data) => {
      const { messageId, chatroomId } = data;

      try {
        // Check if message exists
        const checkResult = await query(
          'SELECT user_id FROM chat_messages WHERE id = $1 AND chatroom_id = $2',
          [messageId, chatroomId]
        );

        if (checkResult.rows.length === 0) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        // Check if user is admin
        let isAdmin = false;
        if (userId) {
          const userResult = await query(
            'SELECT is_admin FROM users WHERE id = $1',
            [userId]
          );
          isAdmin = userResult.rows[0]?.is_admin || false;
        }

        const isOwner = checkResult.rows[0].user_id === userId;

        // Allow deletion if admin OR owner
        if (!isAdmin && !isOwner) {
          socket.emit('error', { message: 'Unauthorized to delete this message' });
          return;
        }

        await query('DELETE FROM chat_messages WHERE id = $1', [messageId]);

        // Notify all users in chatroom
        io.to(`chatroom_${chatroomId}`).emit('message_deleted', {
          messageId,
          chatroomId
        });

        console.log(`Message ${messageId} deleted by ${username}${isAdmin && !isOwner ? ' (admin)' : ''}`);
      } catch (error) {
        console.error('Delete message error:', error);
        socket.emit('error', { message: 'Failed to delete message' });
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', displayName);

      // Clean up throttle tracking
      messageThrottleMap.delete(socket.id);

      // Broadcast updated user count for the chatroom they were in
      if (currentChatroomId) {
        broadcastUserCount(io, currentChatroomId);
      }
    });
  });
};
