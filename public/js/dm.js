// DM (Direct Messages) frontend logic — encrypted via crypto.js

let currentDmConversationId = null;
let currentDmPartnerId = null;
let currentDmSharedKey = null;
let dmTypingTimeout = null;
let dmUnreadCount = 0;
let previousDmConversationId = null;

// --- Tab switching ---

function switchChatTab(tab) {
    const roomsTab = document.getElementById('roomsTab');
    const dmsTab = document.getElementById('dmsTab');
    const roomsHeader = document.getElementById('roomsHeader');
    const dmsHeader = document.getElementById('dmsHeader');
    const chatMessages = document.getElementById('chatMessages');
    const messageInput = document.getElementById('messageInput');

    if (tab === 'rooms') {
        roomsTab.classList.add('active');
        dmsTab.classList.remove('active');
        roomsHeader.style.display = '';
        dmsHeader.style.display = 'none';
        messageInput.placeholder = 'Type a message...';
        window._chatMode = 'rooms';

        // Reload current chatroom messages
        chatMessages.innerHTML = '';
        if (typeof currentChatroomId !== 'undefined' && currentChatroomId) {
            if (typeof loadMessages === 'function') loadMessages(currentChatroomId);
        }
    } else {
        dmsTab.classList.add('active');
        roomsTab.classList.remove('active');
        roomsHeader.style.display = 'none';
        dmsHeader.style.display = '';
        messageInput.placeholder = 'Encrypted message...';
        window._chatMode = 'dms';

        chatMessages.innerHTML = '';
        loadDmConversations();
    }
}

// --- Conversations list ---

// Pending conversation to open after list loads (set by page init for ?dm= param)
let _pendingDmId = null;

async function loadDmConversations() {
    try {
        const res = await fetch('/api/dms/conversations');
        if (!res.ok) return;
        const data = await res.json();

        const list = document.getElementById('dmConversationList');
        list.innerHTML = '';

        if (data.conversations.length === 0) {
            list.innerHTML = '<div class="dm-no-convs">No conversations yet. Start one with a friend!</div>';
        }

        data.conversations.forEach(conv => {
            const lastReadId = parseInt(localStorage.getItem(dmReadKey(conv.id)) || '0', 10);
            const hasUnread = (conv.last_message_id || 0) > lastReadId;
            const avatarUrl = conv.partner_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.partner_username)}&background=random`;

            const item = document.createElement('div');
            item.className = 'dm-conversation-item' + (hasUnread ? ' unread' : '');
            item.dataset.convId = conv.id;
            item.dataset.partnerId = conv.partner_id;
            item.dataset.partnerPublicKey = conv.partner_public_key || '';
            item.dataset.lastMessageId = conv.last_message_id || '0';
            item.dataset.partnerAvatar = conv.partner_avatar || '';
            item.dataset.partnerUsername = conv.partner_username;
            item.innerHTML = `
                <img src="${avatarUrl}" alt="${escapeHtmlDm(conv.partner_username)}" class="dm-conv-avatar">
                <span class="dm-conv-name">${escapeHtmlDm(conv.partner_username)}</span>
                ${hasUnread ? '<span class="dm-conv-unread-dot"></span>' : ''}
            `;
            item.addEventListener('click', () => {
                openDmConversation(conv.id, conv.partner_id, conv.partner_public_key || '');
            });
            list.appendChild(item);
        });

        // Open pending conversation from URL param or explicit request
        if (_pendingDmId) {
            const pending = _pendingDmId;
            _pendingDmId = null;
            const item = list.querySelector(`[data-conv-id="${pending}"]`);
            if (item) {
                openDmConversation(parseInt(item.dataset.convId), parseInt(item.dataset.partnerId), item.dataset.partnerPublicKey);
            }
        }
    } catch (err) {
        console.error('Load DM conversations error:', err);
    }
}

// --- Open conversation ---

async function openDmConversation(conversationId, partnerId, partnerPublicKeyStr) {
    // Leave previous DM room
    if (window.socket && previousDmConversationId) {
        window.socket.emit('leave_dm', previousDmConversationId);
    }

    previousDmConversationId = conversationId;
    currentDmConversationId = conversationId;
    currentDmPartnerId = partnerId;
    currentDmSharedKey = null;

    if (window.socket && window.socket.connected) {
        window.socket.emit('join_dm', conversationId);
    } else if (window.socket) {
        window.socket.once('connect', () => window.socket.emit('join_dm', conversationId));
    }

    // Update active state in conversation list
    const list = document.getElementById('dmConversationList');
    const activeItem = list ? list.querySelector(`[data-conv-id="${conversationId}"]`) : null;
    if (list) {
        list.querySelectorAll('.dm-conversation-item').forEach(i => i.classList.remove('active'));
    }
    if (activeItem) {
        activeItem.classList.add('active');
        activeItem.classList.remove('unread');
        const dot = activeItem.querySelector('.dm-conv-unread-dot');
        if (dot) dot.remove();
    }

    // Update header: partner name, avatar, encryption label
    const partnerName = activeItem ? activeItem.dataset.partnerUsername : 'DM';
    document.getElementById('currentDmPartnerName').textContent = partnerName;

    const dmPartnerAvatar = document.getElementById('dmPartnerAvatar');
    if (dmPartnerAvatar) {
        const avatarSrc = (activeItem && activeItem.dataset.partnerAvatar)
            ? activeItem.dataset.partnerAvatar
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(partnerName)}&background=random`;
        dmPartnerAvatar.src = avatarSrc;
        dmPartnerAvatar.style.display = '';
    }

    const dmEncLabel = document.getElementById('dmEncLabel');
    if (dmEncLabel) dmEncLabel.style.display = '';

    // Mark as read — store last message ID so same-second replies are detected
    if (activeItem && activeItem.dataset.lastMessageId) {
        localStorage.setItem(dmReadKey(conversationId), activeItem.dataset.lastMessageId);
    }
    dmUnreadCount = Math.max(0, dmUnreadCount - 1);
    updateDmBadge();

    // Derive shared key — always fetch partner's latest public key from server
    await tryDeriveSharedKey();

    await loadDmMessages(conversationId);
}

// --- Load messages ---

async function loadDmMessages(conversationId) {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '<div class="loading">Loading messages...</div>';

    try {
        const res = await fetch(`/api/dms/conversations/${conversationId}/messages`);
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            chatMessages.innerHTML = `<div class="error">Failed to load messages${errData.error ? ': ' + errData.error : ''}</div>`;
            return;
        }
        const data = await res.json();
        chatMessages.innerHTML = '';

        for (const msg of data.messages) {
            await displayDmMessage(msg, false);
        }

        if (data.messages.length === 0) {
            chatMessages.innerHTML = '<div class="loading" style="color:var(--text-secondary)">No messages yet. Say hello!</div>';
        }

        scrollToDmBottom();
    } catch (err) {
        console.error('Load DM messages error:', err);
        document.getElementById('chatMessages').innerHTML = '<div class="error">Failed to load messages</div>';
    }
}

// --- Display a DM message ---

async function displayDmMessage(msg, scrollDown = true) {
    const chatMessages = document.getElementById('chatMessages');
    const isOwn = (typeof currentUser !== 'undefined') && currentUser && msg.sender_id === currentUser.id;
    const avatarUrl = msg.sender_avatar || `https://ui-avatars.com/api/?name=${msg.sender_username}&background=random`;

    let plaintext = '[Encrypted — key unavailable]';
    if (currentDmSharedKey) {
        try {
            plaintext = await decryptMessage(msg.ciphertext, msg.iv, currentDmSharedKey);
        } catch {
            plaintext = '[Could not decrypt]';
        }
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message dm-message ${isOwn ? 'own-message' : ''}`;
    messageDiv.dataset.dmMessageId = msg.id;

    messageDiv.innerHTML = `
        <img src="${avatarUrl}" alt="${escapeHtmlDm(msg.sender_username)}" class="message-avatar">
        <div class="message-content">
            <div class="message-header">
                <span class="message-username">${escapeHtmlDm(msg.sender_username)}</span>
                <span class="message-time">${formatDmDate(msg.created_at)}</span>
                <span class="encrypted-indicator" title="End-to-end encrypted">🔒</span>
            </div>
            <div class="message-text">${escapeHtmlDm(plaintext)}</div>
        </div>
    `;

    chatMessages.appendChild(messageDiv);
    if (scrollDown) scrollToDmBottom();
}

// --- Derive shared key (always fetches partner's latest public key from server) ---

async function tryDeriveSharedKey() {
    if (!currentDmPartnerId) return;
    try {
        const res = await fetch(`/api/keys/user/${currentDmPartnerId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.publicKey) return;
        const partnerPublicKey = JSON.parse(data.publicKey);
        const myUserId = await getMyUserId();
        const myPrivateKey = myUserId ? await getCachedPrivateKey(myUserId) : null;
        if (myPrivateKey) {
            currentDmSharedKey = await deriveSharedKey(myPrivateKey, partnerPublicKey);
        }
    } catch (err) {
        console.error('Failed to derive shared key:', err);
    }
}

// --- Send DM ---

async function sendDmMessage() {
    if (!currentDmConversationId) return;

    if (!currentDmSharedKey) {
        await tryDeriveSharedKey();
    }

    if (!currentDmSharedKey) {
        alert('Cannot send message: encryption key not available. Ensure your friend has logged in at least once since the encryption feature was added.');
        return;
    }

    const input = document.getElementById('messageInput');
    const plaintext = input.value.trim();
    if (!plaintext) return;

    try {
        const { ciphertext, iv } = await encryptMessage(plaintext, currentDmSharedKey);

        const res = await fetch(`/api/dms/conversations/${currentDmConversationId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ciphertext, iv })
        });

        if (res.ok) {
            input.value = '';
            // Store our sent message's ID as lastRead so our own sends don't trigger the badge
            const sent = await res.json();
            if (sent.lastMessageId) {
                localStorage.setItem(dmReadKey(currentDmConversationId), sent.lastMessageId);
                const item = document.querySelector(`#dmConversationList [data-conv-id="${currentDmConversationId}"]`);
                if (item) item.dataset.lastMessageId = sent.lastMessageId;
            }
            if (window.socket) {
                window.socket.emit('dm_stop_typing', currentDmConversationId);
            }
        } else {
            const data = await res.json();
            alert(data.error || 'Failed to send message');
        }
    } catch (err) {
        console.error('Send DM error:', err);
        alert('Failed to send message');
    }
}

// --- Typing indicator for DMs ---

function handleDmTyping() {
    if (!currentDmConversationId || window._chatMode !== 'dms') return;
    if (window.socket) {
        window.socket.emit('dm_typing', currentDmConversationId);
    }
    clearTimeout(dmTypingTimeout);
    dmTypingTimeout = setTimeout(() => {
        if (window.socket) {
            window.socket.emit('dm_stop_typing', currentDmConversationId);
        }
    }, 1000);
}

// --- New message dialog ---

function openDmFriendPicker() {
    const modal = document.getElementById('dmFriendPickerModal');
    modal.style.display = 'flex';
    loadFriendsForDmPicker();
}

function closeDmFriendPicker() {
    document.getElementById('dmFriendPickerModal').style.display = 'none';
}

async function loadFriendsForDmPicker() {
    const list = document.getElementById('dmFriendPickerList');
    list.innerHTML = '<div class="loading">Loading friends...</div>';

    try {
        const res = await fetch('/api/friends');
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            list.innerHTML = `<p>Failed to load friends (HTTP ${res.status}${errData.error ? ': ' + errData.error : ''})</p>`;
            return;
        }
        const data = await res.json();

        const friendships = data.friends || [];
        if (friendships.length === 0) {
            list.innerHTML = '<p>No friends yet. Add some friends first!</p>';
            return;
        }

        // Use getMyUserId() in case window.currentUser isn't set yet
        const myId = await getMyUserId();
        list.innerHTML = friendships.map(f => {
            const friend = f.requester_id === myId ? f.receiver : f.requester;
            const avatarUrl = friend.profile_picture || `https://ui-avatars.com/api/?name=${friend.username}&background=random`;
            return `
                <div class="dm-friend-item" onclick="startDmWithFriend(${friend.id})">
                    <img src="${avatarUrl}" alt="${escapeHtmlDm(friend.username)}" class="friend-avatar">
                    <span>${escapeHtmlDm(friend.username)}</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Load friends for DM picker error:', err);
        list.innerHTML = `<p>Failed to load friends: ${err.message}</p>`;
    }
}

async function startDmWithFriend(friendId) {
    closeDmFriendPicker();
    await _openOrCreateDm(friendId);
}

// --- Shared helper: open or create DM with a user, then switch to DMs tab ---

async function _openOrCreateDm(partnerId) {
    try {
        // Check for existing conversation
        const checkRes = await fetch(`/api/dms/conversation-with/${partnerId}`);
        const checkData = await checkRes.json();

        let convId;
        if (checkData.conversation) {
            convId = checkData.conversation.id;
        } else {
            const createRes = await fetch('/api/dms/conversations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ partnerId })
            });
            if (!createRes.ok) {
                const err = await createRes.json();
                alert(err.error || 'Failed to open DM');
                return;
            }
            const createData = await createRes.json();
            convId = createData.conversation.id;
        }

        // Switch to DMs tab, then open conversation after list loads
        _pendingDmId = convId;
        if (window._chatMode !== 'dms') {
            switchChatTab('dms'); // loadDmConversations called here, will pick up _pendingDmId
        } else {
            // Already on DMs tab — reload list then open
            await loadDmConversations();
        }
    } catch (err) {
        console.error('Open DM error:', err);
        alert('Failed to open DM');
    }
}

// --- Entry point from within index.html (e.g. future use) ---

// --- localStorage key scoped per user to avoid cross-account contamination ---

function dmReadKey(convId) {
    // currentUser is a `let` global in app.js — not a window property, but accessible by name
    const uid = (typeof currentUser !== 'undefined' && currentUser?.id) || 'guest';
    return `dm_read_${uid}_${convId}`;
}

// --- Unread badge ---

async function refreshUnreadBadge() {
    try {
        const res = await fetch('/api/dms/conversations');
        if (!res.ok) return;
        const data = await res.json();
        let unread = 0;
        data.conversations.forEach(conv => {
            const lastReadId = parseInt(localStorage.getItem(dmReadKey(conv.id)) || '0', 10);
            const lastMsgId = conv.last_message_id || 0;
            if (lastMsgId > lastReadId) unread++;
        });
        dmUnreadCount = unread;
        updateDmBadge();
    } catch (e) {
        console.error('refreshUnreadBadge error:', e);
    }
}

function updateDmBadge() {
    const badge = document.getElementById('dmUnreadBadge');
    if (!badge) return;
    if (dmUnreadCount > 0) {
        badge.style.display = 'inline';
        badge.textContent = dmUnreadCount;
    } else {
        badge.style.display = 'none';
    }
}

// --- Socket event handlers (called from chat.js after socket connects) ---

function initDmSocketListeners(socket) {
    // Display incoming DM if currently viewing that conversation.
    // Badge counting is handled exclusively by dm_notification to avoid double-counting
    // (both new_dm and dm_notification can fire for the same message when the recipient
    // is still joined to the dm room from a previous session).
    socket.on('new_dm', async (message) => {
        if (window._chatMode === 'dms' && message.conversation_id === currentDmConversationId) {
            // Remove "no messages" placeholder if present
            const chatMessages = document.getElementById('chatMessages');
            const placeholder = chatMessages.querySelector('.loading');
            if (placeholder) placeholder.remove();
            await displayDmMessage(message, true);
        }
    });

    // dm_notification is only sent to the recipient, so increment badge unless
    // they are actively viewing that exact conversation right now.
    socket.on('dm_notification', (data) => {
        const isViewingThisConv = window._chatMode === 'dms' && data.conversationId === currentDmConversationId;
        if (!isViewingThisConv) {
            dmUnreadCount++;
            updateDmBadge();
            // Add unread dot to the conversation item in the list
            const item = document.querySelector(`#dmConversationList [data-conv-id="${data.conversationId}"]`);
            if (item && !item.querySelector('.dm-conv-unread-dot')) {
                const dot = document.createElement('span');
                dot.className = 'dm-conv-unread-dot';
                item.appendChild(dot);
                item.classList.add('unread');
            }
        }
    });

    socket.on('dm_user_typing', (data) => {
        if (window._chatMode === 'dms') {
            showTypingIndicator(data.username);
        }
    });

    socket.on('dm_user_stop_typing', () => {
        if (window._chatMode === 'dms') {
            hideTypingIndicator();
        }
    });
}

// --- Helpers ---

function scrollToDmBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtmlDm(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDmDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Initialize DM UI wiring ---

document.addEventListener('DOMContentLoaded', () => {
    // Show unread badge on load (persisted via localStorage)
    refreshUnreadBadge();

    // Check for ?dm= URL param — switch to DMs tab after socket connects and conversations load
    const urlParams = new URLSearchParams(window.location.search);
    const dmId = urlParams.get('dm');
    if (dmId) {
        _pendingDmId = dmId;
        switchChatTab('dms'); // → loadDmConversations → picks up _pendingDmId → openDmConversation
    }

    const newDmBtn = document.getElementById('newDmBtn');
    if (newDmBtn) {
        newDmBtn.addEventListener('click', openDmFriendPicker);
    }

    const modal = document.getElementById('dmFriendPickerModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeDmFriendPicker();
        });
    }
});
