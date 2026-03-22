// Real-time chat functionality with Socket.io

let socket = null;
let currentChatroomId = null;
let typingTimeout = null;

// Track current chat mode (rooms or dms) — also set in dm.js
window._chatMode = 'rooms';

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('chatSection')) {
        initializeChat();
    }
});

function initializeChat() {
    socket = io();

    // Expose socket globally for dm.js
    window.socket = socket;

    // Register DM socket listeners once (not inside 'connect' to avoid stacking on reconnect)
    if (typeof initDmSocketListeners === 'function') {
        initDmSocketListeners(socket);
    }

    socket.on('connect', () => {
        console.log('Connected to chat server');
        loadChatrooms();
        // Refresh unread badge now that we're authenticated and connected
        if (typeof refreshUnreadBadge === 'function') {
            refreshUnreadBadge();
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from chat server');
    });

    socket.on('joined_chatroom', (data) => {
        console.log('Joined chatroom:', data.chatroomName);
        loadMessages(data.chatroomId);
    });

    socket.on('new_message', (message) => {
        if (window._chatMode === 'rooms') {
            displayMessage(message);
        }
    });

    socket.on('message_deleted', (data) => {
        removeMessage(data.messageId);
    });

    socket.on('user_typing', (data) => {
        showTypingIndicator(data.username);
    });

    socket.on('user_stop_typing', () => {
        hideTypingIndicator();
    });

    socket.on('user_count_update', (data) => {
        updateUserCount(data.userCount);
    });

    socket.on('error', (data) => {
        console.error('Socket error:', data.message);
        showToast(data.message, 'error');
    });

    setupChatUI();

    // Start minimized by default
    const chatSection = document.getElementById('chatSection');
    const minimizeBtn = document.getElementById('minimizeChatBtn');
    if (chatSection && !chatSection.classList.contains('minimized')) {
        chatSection.classList.add('minimized');
    }
}

function updateUserCount(count) {
    const userCountElement = document.getElementById('userCount');
    if (userCountElement) {
        userCountElement.textContent = `👤 ${count} online`;
    }
}

function setupChatUI() {
    const messageInput = document.getElementById('messageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const chatroomSelect = document.getElementById('chatroomSelect');
    const createChatroomBtn = document.getElementById('createChatroomBtn');
    const minimizeChatBtn = document.getElementById('minimizeChatBtn');

    sendMessageBtn.addEventListener('click', handleSend);

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSend();
        }
    });

    messageInput.addEventListener('input', () => {
        if (window._chatMode === 'dms') {
            if (typeof handleDmTyping === 'function') handleDmTyping();
        } else {
            handleTyping();
        }
    });

    chatroomSelect.addEventListener('change', (e) => {
        const chatroomId = parseInt(e.target.value);
        switchChatroom(chatroomId);
    });

    createChatroomBtn.addEventListener('click', createChatroom);

    minimizeChatBtn.addEventListener('click', closeChatPanel);

    const chatNavLink = document.getElementById('chatNavLink');
    if (chatNavLink) {
        chatNavLink.addEventListener('click', (e) => {
            e.preventDefault();
            toggleChatPanel();
        });
    }
}

async function loadChatrooms() {
    try {
        const response = await fetch('/api/chatrooms');
        const data = await response.json();

        const chatroomSelect = document.getElementById('chatroomSelect');
        chatroomSelect.innerHTML = data.chatrooms.map(room =>
            `<option value="${room.id}">${room.name}</option>`
        ).join('');

        // Join the first chatroom (Global by default)
        if (data.chatrooms.length > 0) {
            const firstChatroomId = data.chatrooms[0].id;
            chatroomSelect.value = firstChatroomId;
            switchChatroom(firstChatroomId);
        }
    } catch (error) {
        console.error('Load chatrooms error:', error);
    }
}

function switchChatroom(chatroomId) {
    if (currentChatroomId) {
        socket.emit('leave_chatroom', currentChatroomId);
    }

    currentChatroomId = chatroomId;
    socket.emit('join_chatroom', chatroomId);

    // Update chatroom name
    const select = document.getElementById('chatroomSelect');
    const selectedOption = select.options[select.selectedIndex];
    document.getElementById('currentChatroomName').textContent = selectedOption.text;
}

async function loadMessages(chatroomId) {
    try {
        const response = await fetch(`/api/chatrooms/${chatroomId}/messages?limit=100`);
        const data = await response.json();

        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '';

        data.messages.forEach(message => {
            displayMessage(message, false);
        });

        scrollToBottom();
    } catch (error) {
        console.error('Load messages error:', error);
    }
}

function handleSend() {
    if (window._chatMode === 'dms') {
        if (typeof sendDmMessage === 'function') sendDmMessage();
    } else {
        sendMessage();
    }
}

function sendMessage() {
    // Hard guard: never send to chatroom while in DMs mode
    if (window._chatMode === 'dms') return;

    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();

    if (!message) return;

    socket.emit('send_message', {
        chatroomId: currentChatroomId,
        message
    });

    messageInput.value = '';
    socket.emit('stop_typing', { chatroomId: currentChatroomId });
}

function displayMessage(message, scrollDown = true) {
    const chatMessages = document.getElementById('chatMessages');

    // Check if message is owned by current user or guest
    let isOwn = false;
    if (currentUser && message.user_id === currentUser.id) {
        isOwn = true;
    } else if (isGuest && message.is_guest && message.guest_id === guestId) {
        isOwn = true;
    } else if (isGuest && message.guest_name === guestName) {
        isOwn = true;
    }

    const isAdmin = currentUser && currentUser.is_admin;
    const avatarUrl = message.profile_picture || `https://ui-avatars.com/api/?name=${message.username}&background=random`;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isOwn ? 'own-message' : ''}`;
    messageDiv.dataset.messageId = message.id;

    messageDiv.innerHTML = `
        <img src="${avatarUrl}" alt="${message.username}" class="message-avatar">
        <div class="message-content">
            <div class="message-header">
                ${message.is_guest ?
                    `<span class="message-username">${message.username}</span>` :
                    `<a href="/profile.html?username=${message.username}" class="message-username">${message.username}</a>`
                }
                <span class="message-time">${formatDate(message.created_at)}</span>
            </div>
            <div class="message-text">${linkifyUrls(embedYouTubeVideos(escapeHtml(message.message)))}</div>
            ${!message.is_guest ? `
                <div class="message-actions">
                    ${isOwn ? `<button class="btn-delete-message" data-message-id="${message.id}">Delete</button>` :
                     isAdmin ? `<button class="btn-delete-message" data-message-id="${message.id}">🛡️ Delete</button><button class="btn-report-message" data-message-id="${message.id}" data-user-id="${message.user_id}">🚩 Report</button>` :
                     `<button class="btn-report-message" data-message-id="${message.id}" data-user-id="${message.user_id}">🚩 Report</button>`}
                </div>
            ` : ''}
        </div>
    `;

    chatMessages.appendChild(messageDiv);

    // Attach delete listener (for owners or admins)
    if ((isOwn || isAdmin) && !message.is_guest) {
        const deleteBtn = messageDiv.querySelector('.btn-delete-message');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => deleteMessage(message.id));
        }
    }

    // Attach report listener (for non-owners)
    if (!isOwn && !message.is_guest) {
        const reportBtn = messageDiv.querySelector('.btn-report-message');
        if (reportBtn) {
            reportBtn.addEventListener('click', () => reportMessage(message.id, message.user_id));
        }
    }

    if (scrollDown) {
        scrollToBottom();
    }
}

function deleteMessage(messageId) {
    if (!confirm('Delete this message?')) return;

    socket.emit('delete_message', {
        messageId,
        chatroomId: currentChatroomId
    });
}

function removeMessage(messageId) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.remove();
    }
}

async function reportMessage(messageId, userId) {
    const reason = prompt('Please provide a reason for reporting this message:');
    if (!reason || reason.trim().length === 0) return;

    try {
        const response = await fetch('/api/moderation/report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                report_type: 'message',
                reported_user_id: userId,
                content_id: messageId,
                reason: reason.trim()
            })
        });

        if (response.ok) {
            showToast('Message reported. Moderators will review your report.', 'success');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to report message', 'error');
        }
    } catch (error) {
        console.error('Report message error:', error);
        showToast('Failed to report message', 'error');
    }
}

function handleTyping() {
    socket.emit('typing', { chatroomId: currentChatroomId });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', { chatroomId: currentChatroomId });
    }, 1000);
}

function showTypingIndicator(username) {
    const typingIndicator = document.getElementById('typingIndicator');
    typingIndicator.querySelector('span').textContent = `${username} is typing...`;
    typingIndicator.style.display = 'block';

    setTimeout(hideTypingIndicator, 3000);
}

function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typingIndicator');
    typingIndicator.style.display = 'none';
}

function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function createChatroom() {
    // Guests can't create chatrooms
    if (typeof isGuest !== 'undefined' && isGuest) {
        showToast('Please login or register to create chatrooms', 'warning');
        return;
    }

    const name = prompt('Enter chatroom name:');
    if (!name) return;

    try {
        const response = await fetch('/api/chatrooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name })
        });

        if (response.ok) {
            await loadChatrooms();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to create chatroom', 'error');
        }
    } catch (error) {
        console.error('Create chatroom error:', error);
        showToast('Failed to create chatroom', 'error');
    }
}

function toggleChatPanel() {
    const chatSection = document.getElementById('chatSection');
    const chatNavLink = document.getElementById('chatNavLink');
    const isOpen = chatSection.classList.contains('chat-open');

    if (isOpen) {
        chatSection.classList.remove('chat-open');
        document.body.classList.remove('chat-open');
        chatNavLink && chatNavLink.classList.remove('active');
    } else {
        chatSection.classList.add('chat-open');
        document.body.classList.add('chat-open');
        chatNavLink && chatNavLink.classList.add('active');
    }
}

function closeChatPanel() {
    const chatSection = document.getElementById('chatSection');
    chatSection.classList.remove('chat-open');
    document.body.classList.remove('chat-open');
    const chatNavLink = document.getElementById('chatNavLink');
    chatNavLink && chatNavLink.classList.remove('active');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function linkifyUrls(text) {
    // Match URLs but exclude those that will be YouTube embeds
    const urlRegex = /(?<!href="|src=")(https?:\/\/(?:www\.)?(?!(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/))[^\s<]+)/gi;

    return text.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="post-link">${url}</a>`;
    });
}

function embedYouTubeVideos(text) {
    // Match YouTube URLs: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&][^\s]*)?/g;

    return text.replace(youtubeRegex, (match, videoId) => {
        return `<div class="youtube-embed">
            <iframe
                width="100%"
                height="200"
                src="https://www.youtube.com/embed/${videoId}"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen>
            </iframe>
        </div>`;
    });
}
