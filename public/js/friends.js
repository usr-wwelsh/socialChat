// Friends management functionality

let friendsCurrentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    try {
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
            window.location.href = '/login.html';
            return;
        }
        const data = await response.json();
        friendsCurrentUser = data.user;

        // Update nav
        if (document.getElementById('navUsername')) {
            document.getElementById('navUsername').textContent = `@${friendsCurrentUser.username}`;
        }

        // Check admin status
        await checkAdminStatus();

        // Setup tabs
        setupTabs();

        // Load initial data
        loadFriends();
        loadFriendRequests();
        loadSentRequests();

        // Setup search
        setupSearch();

    } catch (error) {
        console.error('Auth error:', error);
        window.location.href = '/login.html';
    }
});

async function checkAdminStatus() {
    try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();
        if (data.isAuthenticated && data.user.isAdmin) {
            const moderationLink = document.getElementById('moderationLink');
            if (moderationLink) {
                moderationLink.style.display = 'inline';
            }
        }
    } catch (error) {
        console.error('Admin check error:', error);
    }
}

function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            // Remove active class from all
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked
            btn.classList.add('active');
            document.getElementById(`${tabName}Tab`).classList.add('active');
        });
    });
}

function setupSearch() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
}

async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();

    if (!query) {
        showToast('Please enter a username to search', 'warning');
        return;
    }

    const searchResults = document.getElementById('searchResults');
    searchResults.innerHTML = '<div class="loading">Searching...</div>';

    try {
        const response = await fetch(`/api/profiles/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.users.length === 0) {
            searchResults.innerHTML = '<p class="no-results">No users found</p>';
            return;
        }

        // Get current friend status for each user
        const friendsResponse = await fetch('/api/friends');
        const friendsData = await friendsResponse.json();

        // Create a map of friend statuses
        const friendStatusMap = new Map();
        friendsData.friends.forEach(f => {
            const friendId = f.requester_id === friendsCurrentUser.id ? f.receiver_id : f.requester_id;
            friendStatusMap.set(friendId, f.status);
        });

        searchResults.innerHTML = data.users
            .filter(user => user.id !== friendsCurrentUser.id) // Don't show self
            .map(user => renderUserCard(user, friendStatusMap.get(user.id)))
            .join('');

        // Attach event listeners
        attachFriendButtonListeners();

    } catch (error) {
        console.error('Search error:', error);
        searchResults.innerHTML = '<p class="error">Failed to search users</p>';
    }
}

async function loadFriends() {
    const friendsList = document.getElementById('friendsList');
    friendsList.innerHTML = '<div class="loading">Loading friends...</div>';

    try {
        const response = await fetch('/api/friends');
        const data = await response.json();

        const acceptedFriends = data.friends.filter(f => f.status === 'accepted');

        if (acceptedFriends.length === 0) {
            friendsList.innerHTML = '<p class="no-results">No friends yet. Use the search tab to find friends!</p>';
            return;
        }

        friendsList.innerHTML = acceptedFriends.map(friendship => {
            const friend = friendship.requester_id === friendsCurrentUser.id ? friendship.receiver : friendship.requester;
            return renderFriendCard(friend, friendship.id);
        }).join('');

        // Attach unfriend listeners
        attachUnfriendListeners();

    } catch (error) {
        console.error('Load friends error:', error);
        friendsList.innerHTML = '<p class="error">Failed to load friends</p>';
    }
}

async function loadFriendRequests() {
    const requestsList = document.getElementById('friendRequests');
    const requestCount = document.getElementById('requestCount');

    try {
        const response = await fetch('/api/friends/requests/received');
        const data = await response.json();

        requestCount.textContent = data.requests.length;

        if (data.requests.length === 0) {
            requestsList.innerHTML = '<p class="no-results">No pending friend requests</p>';
            return;
        }

        requestsList.innerHTML = data.requests.map(req => {
            return renderRequestCard(req.requester, req.id);
        }).join('');

        // Attach accept/reject listeners
        attachRequestListeners();

    } catch (error) {
        console.error('Load requests error:', error);
        requestsList.innerHTML = '<p class="error">Failed to load requests</p>';
    }
}

async function loadSentRequests() {
    const sentList = document.getElementById('sentRequests');

    try {
        const response = await fetch('/api/friends/requests/sent');
        const data = await response.json();

        if (data.requests.length === 0) {
            sentList.innerHTML = '<p class="no-results">No sent requests</p>';
            return;
        }

        sentList.innerHTML = data.requests.map(req => {
            return renderSentRequestCard(req.receiver, req.id);
        }).join('');

        // Attach cancel listeners
        attachCancelListeners();

    } catch (error) {
        console.error('Load sent requests error:', error);
        sentList.innerHTML = '<p class="error">Failed to load sent requests</p>';
    }
}

function renderUserCard(user, friendStatus) {
    const avatarUrl = user.profile_picture || `https://ui-avatars.com/api/?name=${user.username}&background=random`;

    let actionButton = '';
    if (!friendStatus) {
        actionButton = `<button class="btn-add-friend" data-user-id="${user.id}">Add Friend</button>`;
    } else if (friendStatus === 'pending') {
        actionButton = `<button class="btn-secondary" disabled>Request Sent</button>`;
    } else if (friendStatus === 'accepted') {
        actionButton = `<button class="btn-secondary" disabled>Already Friends</button>`;
    }

    return `
        <div class="friend-card">
            <img src="${avatarUrl}" alt="${user.username}" class="friend-avatar">
            <div class="friend-info">
                <a href="/profile.html?username=${user.username}" class="friend-name">${user.username}</a>
                ${user.bio ? `<p class="friend-bio">${escapeHtml(user.bio)}</p>` : ''}
            </div>
            <div class="friend-actions">
                ${actionButton}
            </div>
        </div>
    `;
}

function renderFriendCard(friend, friendshipId) {
    const avatarUrl = friend.profile_picture || `https://ui-avatars.com/api/?name=${friend.username}&background=random`;

    return `
        <div class="friend-card">
            <img src="${avatarUrl}" alt="${friend.username}" class="friend-avatar">
            <div class="friend-info">
                <a href="/profile.html?username=${friend.username}" class="friend-name">${friend.username}</a>
                ${friend.bio ? `<p class="friend-bio">${escapeHtml(friend.bio)}</p>` : ''}
            </div>
            <div class="friend-actions">
                <button class="btn-message" data-friend-id="${friend.id}">Message</button>
                <button class="btn-unfriend" data-friendship-id="${friendshipId}">Unfriend</button>
            </div>
        </div>
    `;
}

function renderRequestCard(requester, friendshipId) {
    const avatarUrl = requester.profile_picture || `https://ui-avatars.com/api/?name=${requester.username}&background=random`;

    return `
        <div class="friend-card">
            <img src="${avatarUrl}" alt="${requester.username}" class="friend-avatar">
            <div class="friend-info">
                <a href="/profile.html?username=${requester.username}" class="friend-name">${requester.username}</a>
                ${requester.bio ? `<p class="friend-bio">${escapeHtml(requester.bio)}</p>` : ''}
            </div>
            <div class="friend-actions">
                <button class="btn-accept" data-friendship-id="${friendshipId}">Accept</button>
                <button class="btn-reject" data-friendship-id="${friendshipId}">Reject</button>
            </div>
        </div>
    `;
}

function renderSentRequestCard(receiver, friendshipId) {
    const avatarUrl = receiver.profile_picture || `https://ui-avatars.com/api/?name=${receiver.username}&background=random`;

    return `
        <div class="friend-card">
            <img src="${avatarUrl}" alt="${receiver.username}" class="friend-avatar">
            <div class="friend-info">
                <a href="/profile.html?username=${receiver.username}" class="friend-name">${receiver.username}</a>
                ${receiver.bio ? `<p class="friend-bio">${escapeHtml(receiver.bio)}</p>` : ''}
            </div>
            <div class="friend-actions">
                <button class="btn-cancel" data-friendship-id="${friendshipId}">Cancel Request</button>
            </div>
        </div>
    `;
}

function attachFriendButtonListeners() {
    document.querySelectorAll('.btn-add-friend').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = parseInt(e.target.dataset.userId);
            await sendFriendRequest(userId);
        });
    });
}

function attachRequestListeners() {
    document.querySelectorAll('.btn-accept').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const friendshipId = parseInt(e.target.dataset.friendshipId);
            await acceptFriendRequest(friendshipId);
        });
    });

    document.querySelectorAll('.btn-reject').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const friendshipId = parseInt(e.target.dataset.friendshipId);
            await rejectFriendRequest(friendshipId);
        });
    });
}

function attachUnfriendListeners() {
    document.querySelectorAll('.btn-unfriend').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const friendshipId = parseInt(e.target.dataset.friendshipId);
            if (confirm('Are you sure you want to unfriend this user?')) {
                await removeFriend(friendshipId);
            }
        });
    });

    document.querySelectorAll('.btn-message').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const friendId = parseInt(e.target.dataset.friendId);
            await openDmFromFriendsPage(friendId);
        });
    });
}

async function openDmFromFriendsPage(friendId) {
    try {
        const res = await fetch(`/api/dms/conversation-with/${friendId}`);
        const data = await res.json();

        let convId;
        if (data.conversation) {
            convId = data.conversation.id;
        } else {
            const createRes = await fetch('/api/dms/conversations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ partnerId: friendId })
            });
            if (!createRes.ok) {
                const err = await createRes.json();
                showToast(err.error || 'Failed to open DM', 'error');
                return;
            }
            const createData = await createRes.json();
            convId = createData.conversation.id;
        }

        window.location.href = `/?dm=${convId}`;
    } catch (err) {
        console.error('Open DM from friends page error:', err);
        showToast('Failed to open DM', 'error');
    }
}

function attachCancelListeners() {
    document.querySelectorAll('.btn-cancel').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const friendshipId = parseInt(e.target.dataset.friendshipId);
            await cancelFriendRequest(friendshipId);
        });
    });
}

async function sendFriendRequest(userId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiver_id: userId })
        });

        if (response.ok) {
            showToast('Friend request sent!', 'success');
            performSearch(); // Refresh search results
            loadSentRequests(); // Refresh sent requests
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to send friend request', 'error');
        }
    } catch (error) {
        console.error('Send friend request error:', error);
        showToast('Failed to send friend request', 'error');
    }
}

async function acceptFriendRequest(friendshipId) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}/accept`, {
            method: 'PUT'
        });

        if (response.ok) {
            showToast('Friend request accepted!', 'success');
            loadFriends();
            loadFriendRequests();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to accept request', 'error');
        }
    } catch (error) {
        console.error('Accept request error:', error);
        showToast('Failed to accept request', 'error');
    }
}

async function rejectFriendRequest(friendshipId) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}/reject`, {
            method: 'PUT'
        });

        if (response.ok) {
            showToast('Friend request rejected', 'info');
            loadFriendRequests();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to reject request', 'error');
        }
    } catch (error) {
        console.error('Reject request error:', error);
        showToast('Failed to reject request', 'error');
    }
}

async function removeFriend(friendshipId) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('Friend removed', 'info');
            loadFriends();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to remove friend', 'error');
        }
    } catch (error) {
        console.error('Remove friend error:', error);
        showToast('Failed to remove friend', 'error');
    }
}

async function cancelFriendRequest(friendshipId) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('Request cancelled', 'info');
            loadSentRequests();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to cancel request', 'error');
        }
    } catch (error) {
        console.error('Cancel request error:', error);
        showToast('Failed to cancel request', 'error');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
