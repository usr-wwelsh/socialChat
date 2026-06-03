// Profile page functionality

let currentUser = null;
let profileUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadProfile();
    await loadFriendsPanel();
    setupProfileUI();
});

async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me');

        if (!response.ok) {
            window.location.href = '/login.html';
            return;
        }

        const data = await response.json();
        currentUser = data.user;
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/login.html';
    }
}

async function loadProfile() {
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('username');

    if (!username) {
        showToast('No username provided', 'warning');
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch(`/api/profiles/${username}`);

        if (!response.ok) {
            showToast('User not found', 'error');
            window.location.href = '/';
            return;
        }

        const data = await response.json();
        profileUser = data.user;

        displayProfile(data.user, data.posts);
    } catch (error) {
        console.error('Load profile error:', error);
        showToast('Failed to load profile', 'error');
    }
}

function displayProfile(user, posts) {
    // Set profile info
    document.getElementById('profileUsername').textContent = user.username;
    document.getElementById('profileBio').textContent = user.bio || 'No bio yet';

    // Set avatar
    const avatarUrl = user.profile_picture || `https://ui-avatars.com/api/?name=${user.username}&background=random&size=200`;
    document.getElementById('profileAvatar').src = avatarUrl;

    // Set joined date
    const joinedDate = new Date(user.created_at).toLocaleDateString();
    document.getElementById('profileJoined').textContent = joinedDate;

    // Display links
    const linksContainer = document.getElementById('profileLinks');
    if (user.links) {
        try {
            const links = JSON.parse(user.links);
            linksContainer.innerHTML = Object.entries(links).map(([label, url]) =>
                `<a href="${url}" target="_blank" class="profile-link">${label}</a>`
            ).join('');
        } catch (error) {
            linksContainer.innerHTML = '';
        }
    } else {
        linksContainer.innerHTML = '';
    }

    // Show edit button if own profile
    if (currentUser && currentUser.id === user.id) {
        document.getElementById('editProfileBtn').style.display = 'block';
    } else {
        // Show friend actions for other users' profiles
        loadFriendshipStatus(user.id);
    }

    // Display posts
    displayPosts(posts);
}

function displayPosts(posts) {
    const postsContainer = document.getElementById('profilePostsContainer');

    if (posts.length === 0) {
        postsContainer.innerHTML = '<p class="no-posts">No posts yet</p>';
        return;
    }

    postsContainer.innerHTML = posts.map(post => renderPost(post)).join('');
    attachProfilePostListeners();
}

function attachProfilePostListeners() {
    document.querySelectorAll('.btn-reaction').forEach(btn => btn.addEventListener('click', handleReaction));
    document.querySelectorAll('.btn-comment').forEach(btn => btn.addEventListener('click', toggleComments));
    document.querySelectorAll('.btn-quote').forEach(btn => btn.addEventListener('click', handleQuotePost));
    document.querySelectorAll('.btn-submit-comment').forEach(btn => btn.addEventListener('click', submitComment));
    document.querySelectorAll('.btn-delete-comment').forEach(btn => btn.addEventListener('click', handleDeleteComment));
    document.querySelectorAll('.btn-load-more-comments').forEach(btn => btn.addEventListener('click', loadMoreComments));
    document.querySelectorAll('.quoted-post[data-quoted-id]').forEach(el => el.addEventListener('click', () => {
        window.location.href = `/?post=${el.dataset.quotedId}`;
    }));

    // Auto-show comment sections that already have comments
    document.querySelectorAll('.comments-section').forEach(section => {
        const list = section.querySelector('.comments-list');
        if (list && (list.querySelector('.comment') || list.querySelector('.btn-load-more-comments'))) {
            section.style.display = 'block';
        }
    });
}

async function handleReaction(e) {
    const btn = e.currentTarget;
    const postId = btn.dataset.postId;
    const reactionType = btn.dataset.reaction;
    const isLiked = btn.dataset.liked === '1';

    // Optimistic update
    const countEl = btn.querySelector('.reaction-count');
    const newLiked = !isLiked;
    const optimisticCount = parseInt(countEl.textContent) + (newLiked ? 1 : -1);
    btn.dataset.liked = newLiked ? '1' : '0';
    btn.classList.toggle('liked', newLiked);
    btn.innerHTML = `${newLiked ? ICONS.heart : ICONS.like} Like <span class="reaction-count">${optimisticCount}</span>`;

    try {
        const response = isLiked
            ? await fetch(`/api/posts/${postId}/react/${reactionType}`, { method: 'DELETE' })
            : await fetch(`/api/posts/${postId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reaction_type: reactionType })
            });
        if (!response.ok) throw new Error('reaction failed');
    } catch (error) {
        console.error('Reaction error:', error);
        // Revert
        btn.dataset.liked = isLiked ? '1' : '0';
        btn.classList.toggle('liked', isLiked);
        btn.innerHTML = `${isLiked ? ICONS.heart : ICONS.like} Like <span class="reaction-count">${optimisticCount + (newLiked ? -1 : 1)}</span>`;
    }
}

async function toggleComments(e) {
    const postId = e.currentTarget.dataset.postId;
    const section = document.getElementById(`comments-${postId}`);
    if (section.style.display === 'none') {
        section.style.display = 'block';
        await loadComments(postId);
    } else {
        section.style.display = 'none';
    }
}

async function loadComments(postId) {
    const commentsList = document.getElementById(`comments-list-${postId}`);
    try {
        const response = await fetch(`/api/comments/post/${postId}`);
        const data = await response.json();

        const countEl = document.querySelector(`.btn-comment[data-post-id="${postId}"] .comment-count`);
        if (countEl) countEl.textContent = data.comments.length;

        if (data.comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first to comment!</p>';
            return;
        }

        commentsList.innerHTML = data.comments.map(comment => renderSingleComment(comment)).join('');
        attachProfilePostListeners();
    } catch (error) {
        console.error('Load comments error:', error);
        commentsList.innerHTML = '<p class="error">Failed to load comments</p>';
    }
}

async function loadMoreComments(e) {
    const btn = e.target;
    btn.textContent = 'Loading...';
    btn.disabled = true;
    await loadComments(btn.dataset.postId);
}

async function submitComment(e) {
    const postId = e.target.dataset.postId;
    const section = document.getElementById(`comments-${postId}`);
    const textarea = section.querySelector('.comment-input');
    const content = textarea.value.trim();
    if (!content) {
        showToast('Please enter a comment', 'warning');
        return;
    }
    try {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: parseInt(postId), content })
        });
        if (response.ok) {
            textarea.value = '';
            await loadComments(postId);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to post comment', 'error');
        }
    } catch (error) {
        console.error('Submit comment error:', error);
        showToast('Failed to post comment', 'error');
    }
}

async function handleDeleteComment(e) {
    const commentId = e.target.dataset.commentId;
    const postId = e.target.dataset.postId;
    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
        const response = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
        if (response.ok) {
            await loadComments(postId);
        } else {
            showToast('Failed to delete comment', 'error');
        }
    } catch (error) {
        console.error('Delete comment error:', error);
        showToast('Failed to delete comment', 'error');
    }
}

// Quote/reshare happens in the feed composer — hand off with the post pre-loaded.
function handleQuotePost(e) {
    const btn = e.currentTarget;
    window.location.href = `/?quote=${btn.dataset.postId}&quoteUser=${encodeURIComponent(btn.dataset.username)}`;
}

function renderPost(post) {
    const isOwner = currentUser && post.user_id === currentUser.id;
    const avatarUrl = post.user_profile_picture || `https://ui-avatars.com/api/?name=${post.username}&background=random`;

    // Render media based on type
    let mediaHtml = '';
    if (post.media_type === 'image') {
        const urls = (post.media_urls && post.media_urls.length) ? post.media_urls
                   : (post.media_url ? [post.media_url] : []);
        if (urls.length > 1) {
            const galleryJson = JSON.stringify(urls);
            const tiles = urls.map((url, i) =>
                `<div class="carousel-tile"><img src="${url}" alt="Image ${i + 1} of ${urls.length}" class="carousel-img" data-lightbox data-gallery='${galleryJson}' data-gallery-index="${i}" loading="lazy"></div>`
            ).join('');
            mediaHtml = `<div class="post-carousel">${tiles}</div>`;
        } else if (urls.length === 1) {
            const galleryJson = JSON.stringify(urls);
            mediaHtml = `<img src="${urls[0]}" alt="Post image" class="post-media" data-lightbox data-gallery='${galleryJson}' data-gallery-index="0" loading="lazy">`;
        }
    } else if (post.media_type === 'video' && post.media_url) {
        mediaHtml = `<video src="${post.media_url}" controls class="post-media"></video>`;
    } else if (post.media_type === 'audio' && post.media_url) {
        const duration = post.audio_duration ? formatDuration(post.audio_duration) : '';
        mediaHtml = `
            <div class="post-audio">
                <audio controls class="audio-player">
                    <source src="${post.media_url}" type="audio/${post.audio_format || 'mpeg'}">
                    Your browser does not support audio playback.
                </audio>
                ${duration ? `<span class="audio-duration">${duration}</span>` : ''}
            </div>
        `;
    }

    // Render tags
    let tagsHtml = '';
    if (post.tags && Array.isArray(post.tags) && post.tags.length > 0) {
        tagsHtml = `
            <div class="post-tags">
                ${post.tags.map(tag => `<span class="tag" data-tag="${tag.name}">#${tag.name}</span>`).join('')}
            </div>
        `;
    }

    // Visibility indicator
    let visibilityHtml = '';
    if (post.visibility === 'friends') {
        visibilityHtml = `<span class="visibility-indicator" title="Friends Only">${ICONS.friends} Friends</span>`;
    } else if (post.visibility === 'private') {
        visibilityHtml = `<span class="visibility-indicator" title="Private">${ICONS.lock} Private</span>`;
    }

    // Linkify hashtags, embed YouTube videos, then linkify remaining URLs
    const escapedContent = escapeHtml(post.content);
    const contentWithHashtags = linkifyHashtags(escapedContent);
    const contentWithYouTube = embedYouTubeVideos(contentWithHashtags);
    const contentWithLinks = linkifyUrls(contentWithYouTube);

    return `
        <div class="post" data-post-id="${post.id}">
            <div class="post-header">
                <img src="${avatarUrl}" alt="${post.username}" class="post-avatar">
                <div class="post-user-info">
                    <span class="post-username">${post.username}</span>
                    <span class="post-time">${formatDate(post.created_at)}</span>
                    ${post.updated_at !== post.created_at ? '<span class="post-edited">(edited)</span>' : ''}
                    ${visibilityHtml}
                </div>
            </div>
            ${post.content && post.content.trim() ? `<div class="post-content">${contentWithLinks}</div>` : ''}
            ${renderQuotedPost(post.quoted_post)}
            ${mediaHtml}
            ${tagsHtml}
            <div class="post-footer">
                <button class="btn-reaction ${post.is_liked ? 'liked' : ''}" data-post-id="${post.id}" data-reaction="like" data-liked="${post.is_liked ? '1' : '0'}">
                    ${post.is_liked ? ICONS.heart : ICONS.like} Like <span class="reaction-count">${post.reaction_count || 0}</span>
                </button>
                <button class="btn-comment" data-post-id="${post.id}">
                    ${ICONS.comment} Comment <span class="comment-count">${post.comment_count || 0}</span>
                </button>
                <button class="btn-quote" data-post-id="${post.id}" data-username="${post.username}">
                    ${ICONS.quote} Quote
                </button>
            </div>
            <div class="comments-section" id="comments-${post.id}" style="display: none;">
                <div class="comment-input-section">
                    <textarea class="comment-input" placeholder="Write a comment..." maxlength="2000"></textarea>
                    <button class="btn-submit-comment" data-post-id="${post.id}">Post Comment</button>
                </div>
                <div class="comments-list" id="comments-list-${post.id}">
                    ${renderComments(post)}
                </div>
            </div>
        </div>
    `;
}

function renderQuotedPost(quoted) {
    if (!quoted) return '';
    if (quoted.redacted) {
        return `<div class="quoted-post quoted-post-redacted">This post is unavailable.</div>`;
    }

    const avatarUrl = quoted.user_profile_picture || `https://ui-avatars.com/api/?name=${quoted.username}&background=random`;
    let quotedMedia = '';
    const urls = (quoted.media_urls && quoted.media_urls.length) ? quoted.media_urls
               : (quoted.media_url ? [quoted.media_url] : []);
    if (quoted.media_type === 'image' && urls.length) {
        quotedMedia = `<img src="${urls[0]}" alt="" class="quoted-post-media" loading="lazy">`;
    }

    return `
        <div class="quoted-post" data-quoted-id="${quoted.id}">
            <div class="quoted-post-header">
                <img src="${avatarUrl}" alt="${quoted.username}" class="quoted-post-avatar">
                <span class="quoted-post-username">${quoted.username}</span>
                <span class="quoted-post-time">${formatDate(quoted.created_at)}</span>
            </div>
            ${quoted.content ? `<div class="quoted-post-content">${escapeHtml(quoted.content)}</div>` : ''}
            ${quotedMedia}
        </div>
    `;
}

function renderComments(post) {
    const comments = post.preview_comments || [];
    const commentCount = post.comment_count || 0;

    if (commentCount === 0) {
        return '<p class="no-comments">No comments yet. Be the first to comment!</p>';
    }

    let html = comments.map(comment => renderSingleComment(comment)).join('');

    if (commentCount > 3) {
        const remaining = commentCount - 3;
        html += `<button class="btn-load-more-comments" data-post-id="${post.id}" data-loaded="3">
            Load ${remaining} more comment${remaining > 1 ? 's' : ''}
        </button>`;
    }

    return html;
}

function renderSingleComment(comment) {
    const isOwner = currentUser && comment.user_id === currentUser.id;
    const avatarUrl = comment.profile_picture || `https://ui-avatars.com/api/?name=${comment.username}&background=random`;

    return `
        <div class="comment" data-comment-id="${comment.id}">
            <img src="${avatarUrl}" alt="${comment.username}" class="comment-avatar">
            <div class="comment-content">
                <div class="comment-header">
                    <a href="/profile.html?username=${comment.username}" class="comment-username">${comment.username}</a>
                    <span class="comment-time">${formatDate(comment.created_at)}</span>
                    ${isOwner ? `<button class="btn-delete-comment" data-comment-id="${comment.id}" data-post-id="${comment.post_id}">Delete</button>` : ''}
                </div>
                <div class="comment-text">${escapeHtml(comment.content)}</div>
            </div>
        </div>
    `;
}

function linkifyHashtags(text) {
    return text.replace(/#(\w+)/g, '<span class="hashtag">#$1</span>');
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
                height="315"
                src="https://www.youtube.com/embed/${videoId}"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen>
            </iframe>
        </div>`;
    });
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function setupProfileUI() {
    const editProfileBtn = document.getElementById('editProfileBtn');
    const closeEditModal = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const editProfileForm = document.getElementById('editProfileForm');
    const logoutBtn = document.getElementById('logoutBtn');

    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', openEditModal);
    }

    if (closeEditModal) {
        closeEditModal.addEventListener('click', closeModal);
    }

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', closeModal);
    }

    if (editProfileForm) {
        editProfileForm.addEventListener('submit', handleProfileUpdate);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

function openEditModal() {
    // Populate form with current values
    document.getElementById('editBio').value = profileUser.bio || '';

    if (profileUser.links) {
        try {
            const links = JSON.parse(profileUser.links);
            document.getElementById('editLinks').value = JSON.stringify(links, null, 2);
        } catch (error) {
            document.getElementById('editLinks').value = '';
        }
    } else {
        document.getElementById('editLinks').value = '';
    }

    document.getElementById('editProfileModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('editProfileModal').style.display = 'none';
    document.getElementById('editErrorMessage').textContent = '';
}

async function handleProfileUpdate(e) {
    e.preventDefault();

    const bio = document.getElementById('editBio').value.trim();
    const linksText = document.getElementById('editLinks').value.trim();
    const profilePictureFile = document.getElementById('editProfilePicture').files[0];
    const errorMessage = document.getElementById('editErrorMessage');

    errorMessage.textContent = '';

    // Validate links JSON
    let links = null;
    if (linksText) {
        try {
            links = JSON.parse(linksText);
        } catch (error) {
            errorMessage.textContent = 'Invalid JSON format for links';
            return;
        }
    }

    // Validate profile picture size
    if (profilePictureFile && profilePictureFile.size > 10 * 1024 * 1024) {
        errorMessage.textContent = 'Profile picture must be less than 10MB';
        return;
    }

    try {
        const formData = new FormData();
        if (bio) formData.append('bio', bio);
        if (links) formData.append('links', JSON.stringify(links));
        if (profilePictureFile) formData.append('profile_picture', profilePictureFile);

        const response = await fetch('/api/profiles/me', {
            method: 'PUT',
            body: formData
            // No Content-Type — browser sets multipart boundary automatically
        });

        if (response.ok) {
            closeModal();
            location.reload(); // Reload to show updated profile
        } else {
            const data = await response.json();
            errorMessage.textContent = data.error || 'Failed to update profile';
        }
    } catch (error) {
        console.error('Update profile error:', error);
        errorMessage.textContent = 'Failed to update profile';
    }
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Helper functions
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Friendship functionality
async function loadFriendshipStatus(userId) {
    const friendshipActions = document.getElementById('friendshipActions');

    try {
        const response = await fetch(`/api/friends/status/${userId}`);
        const data = await response.json();

        if (data.status === 'none') {
            friendshipActions.innerHTML = `
                <button class="btn-primary" onclick="sendFriendRequest(${userId})">
                    Send Friend Request
                </button>
            `;
        } else if (data.status === 'pending') {
            if (data.isRequester) {
                friendshipActions.innerHTML = `
                    <button class="btn-secondary" disabled>Friend Request Sent</button>
                    <button class="btn-danger" onclick="cancelFriendRequest(${data.friendshipId})">Cancel Request</button>
                `;
            } else {
                friendshipActions.innerHTML = `
                    <button class="btn-primary" onclick="acceptFriendRequest(${data.friendshipId})">Accept Friend Request</button>
                    <button class="btn-danger" onclick="rejectFriendRequest(${data.friendshipId})">Reject</button>
                `;
            }
        } else if (data.status === 'accepted') {
            friendshipActions.innerHTML = `
                <button class="btn-success" disabled>Friends ✓</button>
                <button class="btn-primary" onclick="messageFriend(${userId})">Message</button>
                <button class="btn-danger" onclick="unfriend(${data.friendshipId})">Unfriend</button>
            `;
        }
    } catch (error) {
        console.error('Load friendship status error:', error);
    }
}

async function messageFriend(userId) {
    try {
        const checkRes = await fetch(`/api/dms/conversation-with/${userId}`);
        const checkData = await checkRes.json();
        let convId;
        if (checkData.conversation) {
            convId = checkData.conversation.id;
        } else {
            const createRes = await fetch('/api/dms/conversations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ partnerId: userId })
            });
            if (!createRes.ok) {
                const err = await createRes.json();
                showToast(err.error || 'Failed to open DM', 'error');
                return;
            }
            convId = (await createRes.json()).conversation.id;
        }
        window.location.href = `/?dm=${convId}`;
    } catch (err) {
        console.error('Message friend error:', err);
        showToast('Failed to open DM', 'error');
    }
}

async function sendFriendRequest(userId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ receiver_id: userId })
        });

        if (response.ok) {
            await loadFriendshipStatus(userId);
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
            await loadFriendshipStatus(profileUser.id);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to accept friend request', 'error');
        }
    } catch (error) {
        console.error('Accept friend request error:', error);
        showToast('Failed to accept friend request', 'error');
    }
}

async function rejectFriendRequest(friendshipId) {
    try {
        const response = await fetch(`/api/friends/${friendshipId}/reject`, {
            method: 'PUT'
        });

        if (response.ok) {
            await loadFriendshipStatus(profileUser.id);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to reject friend request', 'error');
        }
    } catch (error) {
        console.error('Reject friend request error:', error);
        showToast('Failed to reject friend request', 'error');
    }
}

async function cancelFriendRequest(friendshipId) {
    if (!confirm('Are you sure you want to cancel this friend request?')) return;

    try {
        const response = await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadFriendshipStatus(profileUser.id);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to cancel friend request', 'error');
        }
    } catch (error) {
        console.error('Cancel friend request error:', error);
        showToast('Failed to cancel friend request', 'error');
    }
}

async function unfriend(friendshipId) {
    if (!confirm('Are you sure you want to unfriend this user?')) return;

    try {
        const response = await fetch(`/api/friends/${friendshipId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadFriendshipStatus(profileUser.id);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to unfriend', 'error');
        }
    } catch (error) {
        console.error('Unfriend error:', error);
        showToast('Failed to unfriend', 'error');
    }
}

// ===== Friends Panel (MySpace-style Top Friends) =====

let friendsList = [];
let draggedElement = null;

async function loadFriendsPanel() {
    if (!profileUser) {
        console.log('loadFriendsPanel: profileUser is null');
        return;
    }

    console.log('loadFriendsPanel: Loading friends for user ID', profileUser.id);
    const friendsPanelList = document.getElementById('friendsPanelList');

    try {
        const response = await fetch(`/api/friends/user/${profileUser.id}`);
        console.log('loadFriendsPanel: Response status', response.status);

        if (!response.ok) {
            const errorData = await response.json();
            console.error('loadFriendsPanel: Error response', errorData);
            friendsPanelList.innerHTML = '<p class="no-results">No friends yet</p>';
            return;
        }

        const data = await response.json();
        console.log('loadFriendsPanel: Received data', data);
        friendsList = data.friends || [];
        console.log('loadFriendsPanel: Friends list length', friendsList.length);

        if (friendsList.length === 0) {
            friendsPanelList.innerHTML = '<p class="no-results">No friends yet</p>';
            return;
        }

        renderFriendsList();
    } catch (error) {
        console.error('Load friends panel error:', error);
        friendsPanelList.innerHTML = '<p class="error">Failed to load friends</p>';
    }
}

function renderFriendsList() {
    const friendsPanelList = document.getElementById('friendsPanelList');
    const isOwnProfile = currentUser && profileUser && currentUser.id === profileUser.id;

    friendsPanelList.innerHTML = friendsList.map((friend, index) => {
        const avatarUrl = friend.profile_picture || `https://ui-avatars.com/api/?name=${friend.username}&background=random`;

        return `
            <div class="friend-panel-item ${isOwnProfile ? 'draggable' : ''}"
                 data-friend-id="${friend.friend_id}"
                 data-friendship-id="${friend.id}"
                 data-index="${index}"
                 ${isOwnProfile ? 'draggable="true"' : ''}>
                ${isOwnProfile ? '<span class="drag-handle">☰</span>' : ''}
                <img src="${avatarUrl}" alt="${friend.username}" class="friend-panel-avatar">
                <div class="friend-panel-info">
                    <a href="/profile.html?username=${friend.username}" class="friend-panel-name">${friend.username}</a>
                </div>
            </div>
        `;
    }).join('');

    // Setup drag and drop if it's the user's own profile
    if (isOwnProfile) {
        setupDragAndDrop();
    }
}

function setupDragAndDrop() {
    const items = document.querySelectorAll('.friend-panel-item.draggable');

    items.forEach(item => {
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragleave', handleDragLeave);
    });
}

function handleDragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');

    // Remove drag-over class from all items
    document.querySelectorAll('.friend-panel-item').forEach(item => {
        item.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }

    e.dataTransfer.dropEffect = 'move';

    if (this !== draggedElement) {
        this.classList.add('drag-over');
    }

    return false;
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    this.classList.remove('drag-over');

    if (draggedElement !== this) {
        const draggedIndex = parseInt(draggedElement.dataset.index);
        const targetIndex = parseInt(this.dataset.index);

        // Reorder the friendsList array
        const [removed] = friendsList.splice(draggedIndex, 1);
        friendsList.splice(targetIndex, 0, removed);

        // Re-render the list
        renderFriendsList();

        // Save the new order to the server
        saveFriendOrder();
    }

    return false;
}

async function saveFriendOrder() {
    try {
        // Build array of {friendshipId, displayOrder}
        const friendOrders = friendsList.map((friend, index) => ({
            friendshipId: friend.id,
            displayOrder: friendsList.length - index // Higher number = higher priority
        }));

        const response = await fetch('/api/friends/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendOrders })
        });

        if (!response.ok) {
            const data = await response.json();
            console.error('Failed to save friend order:', data.error);
        }
    } catch (error) {
        console.error('Save friend order error:', error);
    }
}

// Download user data
document.getElementById('downloadDataBtn')?.addEventListener('click', async () => {
    try {
        const button = document.getElementById('downloadDataBtn');
        button.disabled = true;
        button.textContent = 'Preparing download...';

        const response = await fetch('/api/users/export-data');

        if (!response.ok) {
            throw new Error('Failed to export data');
        }

        const data = await response.json();

        // Create downloadable JSON file
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = currentUser.username + '_data_' + new Date().toISOString().split('T')[0] + '.json';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        button.disabled = false;
        button.textContent = '📊 Download My Data';
        showToast('Data exported successfully!', 'success');
    } catch (error) {
        console.error('Export data error:', error);
        showToast('Failed to export data. Please try again.', 'error');
        const button = document.getElementById('downloadDataBtn');
        button.disabled = false;
        button.textContent = '📊 Download My Data';
    }
});

// Image lightbox with gallery navigation
(function initLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const closeBtn = document.getElementById('closeLightbox');
    const prevBtn = document.getElementById('lightboxPrev');
    const nextBtn = document.getElementById('lightboxNext');
    const counterEl = document.getElementById('lightboxCounter');
    if (!lightbox || !lightboxImg) return;

    let gallery = [], galleryIndex = 0, lbTouchStartX = 0;

    function updateGalleryUI() {
        const multi = gallery.length > 1;
        if (prevBtn) prevBtn.classList.toggle('lb-nav-visible', multi);
        if (nextBtn) nextBtn.classList.toggle('lb-nav-visible', multi);
        if (counterEl) {
            counterEl.textContent = multi ? `${galleryIndex + 1} / ${gallery.length}` : '';
            counterEl.style.display = multi ? 'block' : 'none';
        }
    }

    function navigateLightbox(dir) {
        if (gallery.length <= 1) return;
        galleryIndex = (galleryIndex + dir + gallery.length) % gallery.length;
        lightboxImg.src = gallery[galleryIndex];
        updateGalleryUI();
    }

    if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(-1); });
    if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(1); });

    document.addEventListener('click', function(e) {
        const img = e.target.closest('img[data-lightbox]');
        if (!img) return;
        if (!img.src || img.src.startsWith('data:image/svg+xml')) return;
        try { gallery = img.dataset.gallery ? JSON.parse(img.dataset.gallery) : [img.src]; } catch { gallery = [img.src]; }
        galleryIndex = parseInt(img.dataset.galleryIndex || '0');
        if (galleryIndex < 0 || galleryIndex >= gallery.length) galleryIndex = 0;
        lightboxImg.src = gallery[galleryIndex];
        lightbox.classList.add('active');
        updateGalleryUI();
    });

    function closeLightbox() {
        lightbox.classList.remove('active');
        lightboxImg.src = '';
        gallery = []; galleryIndex = 0;
        if (prevBtn) prevBtn.classList.remove('lb-nav-visible');
        if (nextBtn) nextBtn.classList.remove('lb-nav-visible');
        if (counterEl) counterEl.style.display = 'none';
    }

    closeBtn.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function(e) { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', function(e) {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
    });
    lightbox.addEventListener('touchstart', (e) => { if (e.touches.length === 1) lbTouchStartX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
        if (e.changedTouches.length === 1 && gallery.length > 1) {
            const dx = e.changedTouches[0].clientX - lbTouchStartX;
            if (Math.abs(dx) > 50) navigateLightbox(dx < 0 ? 1 : -1);
        }
    }, { passive: true });
}());
