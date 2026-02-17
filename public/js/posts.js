// Posts feed functionality

let currentMediaData = null;
let currentMediaType = null;
let currentAudioDuration = null;
let currentAudioFormat = null;
let postsSocket = null;

// Pagination state
let currentOffset = 0;
let currentTagFilter = null;
let isLoadingMore = false;
let hasMorePosts = true;

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('postsContainer')) {
        loadPosts();
        setupPostCreation();
        loadTrendingTags();
        setupLiveFeed();
        startTimestampUpdater();
    }
});

// Setup Socket.io for live feed updates
function setupLiveFeed() {
    // Initialize Socket.io connection
    if (typeof io !== 'undefined') {
        // Create socket connection for live feed
        postsSocket = io();
        console.log('Socket.io connected for live feed');

        // Listen for new posts
        postsSocket.on('new_post', (post) => {
            console.log('New post received via Socket.io:', post);
            prependPost(post);
        });

        // Listen for new comments
        postsSocket.on('new_comment', (comment) => {
            console.log('New comment received via Socket.io:', comment);
            addCommentToPost(comment);
        });

        postsSocket.on('connect', () => {
            console.log('Live feed socket connected');
        });

        postsSocket.on('connect_error', (error) => {
            console.error('Live feed socket connection error:', error);
        });
    } else {
        console.warn('Socket.io not available - live feed disabled');
    }
}

// Prepend new post to the feed (live update)
function prependPost(post) {
    const postsContainer = document.getElementById('postsContainer');
    if (!postsContainer) return;

    // Check if "no posts" message exists and remove it
    const noPosts = postsContainer.querySelector('.no-posts');
    if (noPosts) {
        noPosts.remove();
    }

    // Create post HTML and insert at the top
    const postHTML = renderPost(post);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = postHTML;
    const postElement = tempDiv.firstElementChild;

    postsContainer.insertBefore(postElement, postsContainer.firstChild);

    // Attach event listeners to the new post
    attachPostEventListeners();

    // Optional: Add a subtle highlight animation
    postElement.style.animation = 'slideIn 0.3s ease-out';
    setTimeout(() => {
        postElement.style.animation = '';
    }, 300);
}

// Add new comment to post (real-time update)
function addCommentToPost(comment) {
    const commentsList = document.getElementById(`comments-list-${comment.post_id}`);
    if (!commentsList) return;

    // Check if comment already exists (prevent duplicates)
    const existingComment = commentsList.querySelector(`[data-comment-id="${comment.id}"]`);
    if (existingComment) return;

    // Remove "no comments" message if it exists
    const noComments = commentsList.querySelector('.no-comments');
    if (noComments) {
        noComments.remove();
    }

    // Check if there's a "Load more" button
    const loadMoreBtn = commentsList.querySelector('.btn-load-more-comments');

    // Create comment element
    const commentHTML = renderSingleComment(comment);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = commentHTML;
    const commentElement = tempDiv.firstElementChild;

    // Add comment to the list (append to end, chronological order)
    if (loadMoreBtn) {
        // If there's a load more button, insert before it
        commentsList.insertBefore(commentElement, loadMoreBtn);
    } else {
        // Otherwise append to end
        commentsList.appendChild(commentElement);
    }

    // Update comment count
    const commentBtn = document.querySelector(`.btn-comment[data-post-id="${comment.post_id}"]`);
    if (commentBtn) {
        const commentCount = commentBtn.querySelector('.comment-count');
        const currentCount = parseInt(commentCount.textContent) || 0;
        commentCount.textContent = currentCount + 1;
    }

    // Show comments section if it's hidden
    const commentsSection = document.getElementById(`comments-${comment.post_id}`);
    if (commentsSection && commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
    }

    // Re-attach event listeners
    attachPostEventListeners();

    // Add animation
    commentElement.style.animation = 'slideIn 0.3s ease-out';
    setTimeout(() => {
        commentElement.style.animation = '';
    }, 300);
}

function setupPostCreation() {
    const createPostBtn = document.getElementById('createPostBtn');
    const postContent = document.getElementById('postContent');
    const imageUpload = document.getElementById('imageUpload');
    const videoUpload = document.getElementById('videoUpload');
    const audioUpload = document.getElementById('audioUpload');
    const removeMediaBtn = document.getElementById('removeMediaBtn');

    createPostBtn.addEventListener('click', createPost);

    postContent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            createPost();
        }
    });

    imageUpload.addEventListener('change', handleImageUpload);
    videoUpload.addEventListener('change', handleVideoUpload);
    audioUpload.addEventListener('change', handleAudioUpload);
    removeMediaBtn.addEventListener('click', clearMedia);
}

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        alert('Image must be less than 10MB');
        e.target.value = '';
        return;
    }

    try {
        currentMediaData = await fileToBase64(file);
        currentMediaType = 'image';

        const mediaPreview = document.getElementById('mediaPreview');
        const mediaPreviewImg = document.getElementById('mediaPreviewImg');
        const mediaPreviewVideo = document.getElementById('mediaPreviewVideo');
        const mediaPreviewAudio = document.getElementById('mediaPreviewAudio');

        mediaPreviewImg.src = currentMediaData;
        mediaPreviewImg.style.display = 'block';
        mediaPreviewVideo.style.display = 'none';
        if (mediaPreviewAudio) mediaPreviewAudio.style.display = 'none';
        mediaPreview.style.display = 'block';
    } catch (error) {
        console.error('Image upload error:', error);
        alert('Failed to load image');
    }
}

async function handleVideoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        alert('Video must be less than 10MB');
        e.target.value = '';
        return;
    }

    try {
        currentMediaData = await fileToBase64(file);
        currentMediaType = 'video';

        const mediaPreview = document.getElementById('mediaPreview');
        const mediaPreviewImg = document.getElementById('mediaPreviewImg');
        const mediaPreviewVideo = document.getElementById('mediaPreviewVideo');
        const mediaPreviewAudio = document.getElementById('mediaPreviewAudio');

        mediaPreviewVideo.src = currentMediaData;
        mediaPreviewVideo.style.display = 'block';
        mediaPreviewImg.style.display = 'none';
        if (mediaPreviewAudio) mediaPreviewAudio.style.display = 'none';
        mediaPreview.style.display = 'block';
    } catch (error) {
        console.error('Video upload error:', error);
        alert('Failed to load video');
    }
}

async function handleAudioUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
        alert('Audio must be less than 20MB');
        e.target.value = '';
        return;
    }

    // Get audio format from file extension
    const format = file.name.split('.').pop().toLowerCase();
    if (!['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(format)) {
        alert('Unsupported audio format. Please use MP3, WAV, OGG, FLAC, or M4A');
        e.target.value = '';
        return;
    }

    try {
        currentMediaData = await fileToBase64(file);
        currentMediaType = 'audio';
        currentAudioFormat = format;

        // Create temporary audio element to get duration
        const audio = new Audio(currentMediaData);
        audio.addEventListener('loadedmetadata', () => {
            currentAudioDuration = Math.floor(audio.duration);
        });

        const mediaPreview = document.getElementById('mediaPreview');
        const mediaPreviewImg = document.getElementById('mediaPreviewImg');
        const mediaPreviewVideo = document.getElementById('mediaPreviewVideo');
        const mediaPreviewAudio = document.getElementById('mediaPreviewAudio');

        if (mediaPreviewAudio) {
            mediaPreviewAudio.src = currentMediaData;
            mediaPreviewAudio.style.display = 'block';
        }
        mediaPreviewImg.style.display = 'none';
        mediaPreviewVideo.style.display = 'none';
        mediaPreview.style.display = 'block';
    } catch (error) {
        console.error('Audio upload error:', error);
        alert('Failed to load audio');
    }
}

function clearMedia() {
    currentMediaData = null;
    currentMediaType = null;
    currentAudioDuration = null;
    currentAudioFormat = null;

    document.getElementById('mediaPreview').style.display = 'none';
    document.getElementById('mediaPreviewImg').src = '';
    document.getElementById('mediaPreviewVideo').src = '';
    const audioPreview = document.getElementById('mediaPreviewAudio');
    if (audioPreview) audioPreview.src = '';
    document.getElementById('imageUpload').value = '';
    document.getElementById('videoUpload').value = '';
    const audioUpload = document.getElementById('audioUpload');
    if (audioUpload) audioUpload.value = '';
}

async function createPost() {
    const content = document.getElementById('postContent').value.trim();
    const visibility = document.getElementById('postVisibility')?.value || 'public';

    if (!content && !currentMediaData) {
        alert('Please add some content or media');
        return;
    }

    try {
        const postData = {
            content,
            media_type: currentMediaType,
            media_data: currentMediaData,
            visibility: visibility
        };

        // Add audio metadata if audio post
        if (currentMediaType === 'audio') {
            postData.audio_duration = currentAudioDuration;
            postData.audio_format = currentAudioFormat;
        }

        const response = await fetch('/api/posts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(postData)
        });

        if (!response.ok) {
            const data = await response.json();
            alert(data.error || 'Failed to create post');
            return;
        }

        // Clear form
        document.getElementById('postContent').value = '';
        if (document.getElementById('postVisibility')) {
            document.getElementById('postVisibility').value = 'public';
        }
        clearMedia();

        // Reset pagination and reload posts (respecting current filter)
        currentOffset = 0;
        hasMorePosts = true;
        await loadPosts(currentTagFilter);
        await loadTrendingTags();
    } catch (error) {
        console.error('Create post error:', error);
        alert('Failed to create post');
    }
}

async function loadPosts(tagFilter = null, append = false) {
    const postsContainer = document.getElementById('postsContainer');

    try {
        let url = '/api/posts?limit=20'; // Optimized for fast loading
        if (tagFilter) {
            url = `/api/tags/${tagFilter}/posts?limit=20`;
        }

        // Add offset for pagination (only when appending)
        if (append && currentOffset > 0) {
            url += `&offset=${currentOffset}`;
        }

        const response = await fetch(url);
        const data = await response.json();
        const posts = Array.isArray(data) ? data : (data.posts || data);

        if (posts.length === 0) {
            if (append) {
                // No more posts to load
                hasMorePosts = false;
                hideLoadMoreButton();
                return;
            }
            postsContainer.innerHTML = '<p class="no-posts">No posts yet. Be the first to post!</p>';
            hasMorePosts = false;
            hideLoadMoreButton();
            return;
        }

        if (append) {
            // Remove "Load More" button if it exists
            const existingBtn = document.getElementById('loadMorePostsBtn');
            if (existingBtn) existingBtn.remove();

            // Append new posts
            const newPostsHtml = posts.map(post => renderPost(post)).join('');
            postsContainer.insertAdjacentHTML('beforeend', newPostsHtml);
        } else {
            // Replace entire container (initial load or filter change)
            postsContainer.innerHTML = posts.map(post => renderPost(post)).join('');
            currentOffset = 0;
            currentTagFilter = tagFilter;
            hasMorePosts = true;
        }

        // Update offset for next load
        currentOffset += posts.length;

        // Check if we got fewer posts than requested (indicates end of feed)
        // Only set hasMorePosts to false if we got 0 posts, or if we're appending and got less than requested
        if (append && posts.length === 0) {
            hasMorePosts = false;
        } else if (!append && posts.length < 20) {
            // On initial load, if we got less than 20, there are no more posts
            hasMorePosts = false;
        } else if (append && posts.length < 20 && posts.length > 0) {
            // On append, if we got some but less than 20, this is the last batch
            hasMorePosts = false;
        }

        // Attach event listeners
        attachPostEventListeners();

        // Lazy load media using Intersection Observer
        lazyLoadMedia();

        // Show/hide Load More button
        if (hasMorePosts) {
            showLoadMoreButton();
        } else {
            hideLoadMoreButton();
        }
    } catch (error) {
        console.error('Load posts error:', error);
        if (!append) {
            postsContainer.innerHTML = '<p class="error">Failed to load posts</p>';
        }
    }
}

// Lazy load media when posts come into view
function lazyLoadMedia() {
    const lazyElements = document.querySelectorAll('.lazy-media');

    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const postId = element.dataset.postId;

                    if (postId && !element.dataset.loaded) {
                        element.dataset.loaded = 'true';
                        loadMediaForPost(postId, element);
                        observer.unobserve(element);
                    }
                }
            });
        }, {
            rootMargin: '50px' // Start loading 50px before element is visible
        });

        lazyElements.forEach(element => {
            if (!element.dataset.loaded) {
                imageObserver.observe(element);
            }
        });
    } else {
        // Fallback for browsers without IntersectionObserver
        lazyElements.forEach(element => {
            const postId = element.dataset.postId;
            if (postId && !element.dataset.loaded) {
                element.dataset.loaded = 'true';
                loadMediaForPost(postId, element);
            }
        });
    }
}

// Load media for a specific post
async function loadMediaForPost(postId, element) {
    try {
        const response = await fetch(`/api/posts/${postId}/media`);
        if (!response.ok) return;

        const data = await response.json();

        if (element.tagName === 'IMG') {
            element.src = data.media_data;
        } else if (element.tagName === 'VIDEO') {
            const source = element.querySelector('source');
            if (source) {
                source.src = data.media_data;
                element.load();
            }
        } else if (element.tagName === 'AUDIO') {
            const source = element.querySelector('source');
            if (source) {
                source.src = data.media_data;
                element.load();
            }
        }
    } catch (error) {
        console.error('Failed to load media for post', postId, error);
    }
}

// Load more posts (pagination)
async function loadMorePosts() {
    if (isLoadingMore || !hasMorePosts) {
        return;
    }

    isLoadingMore = true;
    const loadMoreBtn = document.getElementById('loadMorePostsBtn');

    if (loadMoreBtn) {
        loadMoreBtn.textContent = 'Loading...';
        loadMoreBtn.disabled = true;
    }

    try {
        await loadPosts(currentTagFilter, true); // append = true
    } catch (error) {
        console.error('Load more posts error:', error);
        if (loadMoreBtn) {
            loadMoreBtn.textContent = 'Failed to load - Click to retry';
        }
    } finally {
        isLoadingMore = false;
        if (loadMoreBtn && hasMorePosts) {
            loadMoreBtn.textContent = 'Load More Posts';
            loadMoreBtn.disabled = false;
        }
    }
}

// Show Load More button
function showLoadMoreButton() {
    let loadMoreBtn = document.getElementById('loadMorePostsBtn');

    if (!loadMoreBtn) {
        loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'loadMorePostsBtn';
        loadMoreBtn.className = 'btn-load-more-posts';
        loadMoreBtn.textContent = 'Load More Posts';
        loadMoreBtn.onclick = loadMorePosts;
    }

    const postsContainer = document.getElementById('postsContainer');
    if (postsContainer && !postsContainer.contains(loadMoreBtn)) {
        postsContainer.appendChild(loadMoreBtn);
    }
}

// Hide Load More button
function hideLoadMoreButton() {
    const loadMoreBtn = document.getElementById('loadMorePostsBtn');
    if (loadMoreBtn) {
        loadMoreBtn.remove();
    }
}

function renderPost(post) {
    const isOwner = currentUser && post.user_id === currentUser.id;
    const isAdmin = currentUser && currentUser.is_admin;
    const isGuestUser = typeof isGuest !== 'undefined' && isGuest;
    const avatarUrl = post.user_profile_picture || `https://ui-avatars.com/api/?name=${post.username}&background=random`;

    // Render media based on type (lazy load for performance)
    let mediaHtml = '';
    if (post.media_type === 'image') {
        if (post.media_data) {
            // Media already loaded (e.g., from socket.io new post)
            mediaHtml = `<img src="${post.media_data}" alt="Post image" class="post-media">`;
        } else {
            // Lazy load media
            mediaHtml = `<img data-post-id="${post.id}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23f0f0f0' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23999'%3ELoading...%3C/text%3E%3C/svg%3E" alt="Post image" class="post-media lazy-media" loading="lazy">`;
        }
    } else if (post.media_type === 'video') {
        if (post.media_data) {
            mediaHtml = `<video src="${post.media_data}" controls class="post-media"></video>`;
        } else {
            mediaHtml = `<video data-post-id="${post.id}" class="post-media lazy-media" controls><source type="video/mp4"></video>`;
        }
    } else if (post.media_type === 'audio') {
        const duration = post.audio_duration ? formatDuration(post.audio_duration) : '';
        if (post.media_data) {
            mediaHtml = `
                <div class="post-audio">
                    <audio controls class="audio-player">
                        <source src="${post.media_data}" type="audio/${post.audio_format || 'mpeg'}">
                        Your browser does not support audio playback.
                    </audio>
                    ${duration ? `<span class="audio-duration">${duration}</span>` : ''}
                </div>
            `;
        } else {
            mediaHtml = `
                <div class="post-audio">
                    <audio controls class="audio-player lazy-media" data-post-id="${post.id}">
                        <source type="audio/${post.audio_format || 'mpeg'}">
                        Your browser does not support audio playback.
                    </audio>
                    ${duration ? `<span class="audio-duration">${duration}</span>` : ''}
                </div>
            `;
        }
    }

    // Render tags
    let tagsHtml = '';
    if (post.tags && Array.isArray(post.tags) && post.tags.length > 0) {
        tagsHtml = `
            <div class="post-tags">
                ${post.tags.map(tag => `<span class="tag" data-tag="${tag.name}" onclick="filterByTag('${tag.name}')">#${tag.name}</span>`).join('')}
            </div>
        `;
    }

    // Visibility indicator
    let visibilityHtml = '';
    if (post.visibility === 'friends') {
        visibilityHtml = '<span class="visibility-indicator" title="Friends Only">👥 Friends</span>';
    } else if (post.visibility === 'private') {
        visibilityHtml = '<span class="visibility-indicator" title="Private">🔒 Private</span>';
    }

    // Linkify hashtags, embed YouTube videos, then linkify remaining URLs
    const escapedContent = escapeHtml(post.content);
    const contentWithHashtags = linkifyHashtags(escapedContent);
    const contentWithYouTube = embedYouTubeVideos(contentWithHashtags);
    const contentWithLinks = linkifyUrls(contentWithYouTube);

    // Action menu (only for authenticated users)
    let actionsMenuHtml = '';
    if (!isGuestUser) {
        if (isOwner) {
            actionsMenuHtml = `
                <div class="post-actions-menu">
                    <button class="btn-edit-post" data-post-id="${post.id}">Edit</button>
                    <button class="btn-delete-post" data-post-id="${post.id}">Delete</button>
                </div>
            `;
        } else if (isAdmin) {
            // Admins can delete any post
            actionsMenuHtml = `
                <div class="post-actions-menu">
                    <button class="btn-delete-post" data-post-id="${post.id}">🛡️ Delete</button>
                    <button class="btn-report-post" data-post-id="${post.id}" data-user-id="${post.user_id}">🚩 Report</button>
                </div>
            `;
        } else {
            actionsMenuHtml = `
                <div class="post-actions-menu">
                    <button class="btn-report-post" data-post-id="${post.id}" data-user-id="${post.user_id}">🚩 Report</button>
                </div>
            `;
        }
    }

    return `
        <div class="post" data-post-id="${post.id}">
            <div class="post-header">
                <img src="${avatarUrl}" alt="${post.username}" class="post-avatar">
                <div class="post-user-info">
                    <a href="/profile.html?username=${post.username}" class="post-username">${post.username}</a>
                    <span class="post-time" data-timestamp="${post.created_at}">${formatDate(post.created_at)}</span>
                    ${post.updated_at !== post.created_at ? '<span class="post-edited">(edited)</span>' : ''}
                    ${visibilityHtml}
                </div>
                ${actionsMenuHtml}
            </div>
            <div class="post-content">${contentWithLinks}</div>
            ${mediaHtml}
            ${tagsHtml}
            <div class="post-footer">
                <button class="btn-reaction" data-post-id="${post.id}" data-reaction="like" ${isGuestUser ? 'disabled title="Login to react to posts"' : ''}>
                    👍 Like <span class="reaction-count">${post.reaction_count || 0}</span>
                </button>
                <button class="btn-comment" data-post-id="${post.id}" ${isGuestUser ? 'disabled title="Login to comment"' : ''}>
                    💬 Comment <span class="comment-count">${post.comment_count || 0}</span>
                </button>
            </div>
            <div class="comments-section" id="comments-${post.id}" style="display: none;">
                <div class="comment-input-section" ${isGuestUser ? 'style="display: none;"' : ''}>
                    <textarea class="comment-input" placeholder="Write a comment..." maxlength="2000"></textarea>
                    <button class="btn-submit-comment" data-post-id="${post.id}">Post Comment</button>
                </div>
                <div class="comments-list" id="comments-list-${post.id}">
                    ${renderComments(post, isGuestUser)}
                </div>
            </div>
        </div>
    `;
}

function renderComments(post, isGuestUser) {
    const comments = post.preview_comments || [];
    const commentCount = post.comment_count || 0;

    if (commentCount === 0) {
        return '<p class="no-comments">No comments yet. Be the first to comment!</p>';
    }

    let html = '';

    // Render the preview comments (first 3)
    html += comments.map(comment => renderSingleComment(comment)).join('');

    // Add "Load more" button if there are more than 3 comments
    if (commentCount > 3) {
        const remainingCount = commentCount - 3;
        html += `<button class="btn-load-more-comments" data-post-id="${post.id}" data-loaded="3">
            Load ${remainingCount} more comment${remainingCount > 1 ? 's' : ''}
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
    return text.replace(/#(\w+)/g, '<span class="hashtag" onclick="filterByTag(\'$1\')">#$1</span>');
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

function filterByTag(tagName) {
    // Reset pagination state when changing filters
    currentOffset = 0;
    currentTagFilter = tagName;
    hasMorePosts = true;

    loadPosts(tagName);
    // Update UI to show active filter
    const filterIndicator = document.getElementById('activeFilter');
    if (filterIndicator) {
        filterIndicator.innerHTML = `Filtering by: <span class="active-tag">#${tagName}</span> <button onclick="clearTagFilter()">Clear</button>`;
        filterIndicator.style.display = 'block';
    }
}

function clearTagFilter() {
    // Reset pagination state when clearing filter
    currentOffset = 0;
    currentTagFilter = null;
    hasMorePosts = true;

    loadPosts();
    const filterIndicator = document.getElementById('activeFilter');
    if (filterIndicator) {
        filterIndicator.style.display = 'none';
    }
}

async function loadTrendingTags() {
    try {
        const response = await fetch('/api/tags/trending?limit=10');
        const tags = await response.json();

        const trendingContainer = document.getElementById('trendingTags');
        if (trendingContainer && tags.length > 0) {
            trendingContainer.innerHTML = `
                <h3>Trending Tags</h3>
                <div class="trending-tags-list">
                    ${tags.map(tag => `
                        <span class="trending-tag" onclick="filterByTag('${tag.name}')">
                            #${tag.name} <span class="tag-count">(${tag.use_count})</span>
                        </span>
                    `).join('')}
                </div>
            `;
        }
    } catch (error) {
        console.error('Load trending tags error:', error);
    }
}

function attachPostEventListeners() {
    // Edit post buttons
    document.querySelectorAll('.btn-edit-post').forEach(btn => {
        btn.addEventListener('click', handleEditPost);
    });

    // Delete post buttons
    document.querySelectorAll('.btn-delete-post').forEach(btn => {
        btn.addEventListener('click', handleDeletePost);
    });

    // Report post buttons
    document.querySelectorAll('.btn-report-post').forEach(btn => {
        btn.addEventListener('click', handleReportPost);
    });

    // Reaction buttons
    document.querySelectorAll('.btn-reaction').forEach(btn => {
        btn.addEventListener('click', handleReaction);
    });

    // Comment buttons
    document.querySelectorAll('.btn-comment').forEach(btn => {
        btn.addEventListener('click', toggleComments);
    });

    // Submit comment buttons
    document.querySelectorAll('.btn-submit-comment').forEach(btn => {
        btn.addEventListener('click', submitComment);
    });

    // Delete comment buttons
    document.querySelectorAll('.btn-delete-comment').forEach(btn => {
        btn.addEventListener('click', handleDeleteComment);
    });

    // Load more comments buttons
    document.querySelectorAll('.btn-load-more-comments').forEach(btn => {
        btn.addEventListener('click', loadMoreComments);
    });

    // Auto-show comments sections that have comments
    document.querySelectorAll('.comments-section').forEach(section => {
        const commentsList = section.querySelector('.comments-list');
        const hasComments = commentsList && (
            commentsList.querySelector('.comment') ||
            commentsList.querySelector('.btn-load-more-comments')
        );
        if (hasComments) {
            section.style.display = 'block';
        }
    });
}

async function handleEditPost(e) {
    const postId = e.target.dataset.postId;
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    const contentElement = postElement.querySelector('.post-content');
    const currentContent = contentElement.textContent;

    const newContent = prompt('Edit your post:', currentContent);
    if (!newContent || newContent === currentContent) return;

    try {
        const response = await fetch(`/api/posts/${postId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: newContent })
        });

        if (response.ok) {
            await loadPosts();
            await loadTrendingTags();
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to edit post');
        }
    } catch (error) {
        console.error('Edit post error:', error);
        alert('Failed to edit post');
    }
}

async function handleDeletePost(e) {
    const postId = e.target.dataset.postId;

    if (!confirm('Are you sure you want to delete this post?')) return;

    try {
        const response = await fetch(`/api/posts/${postId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadPosts();
            await loadTrendingTags();
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to delete post');
        }
    } catch (error) {
        console.error('Delete post error:', error);
        alert('Failed to delete post');
    }
}

async function handleReportPost(e) {
    const postId = e.target.dataset.postId;
    const userId = e.target.dataset.userId;

    const reason = prompt('Please provide a reason for reporting this post:');
    if (!reason || reason.trim().length === 0) return;

    try {
        const response = await fetch('/api/moderation/report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                report_type: 'post',
                reported_user_id: parseInt(userId),
                content_id: parseInt(postId),
                reason: reason.trim()
            })
        });

        if (response.ok) {
            alert('Post reported successfully. Moderators will review your report.');
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to report post');
        }
    } catch (error) {
        console.error('Report post error:', error);
        alert('Failed to report post');
    }
}

async function handleReaction(e) {
    const postId = e.currentTarget.dataset.postId;
    const reactionType = e.currentTarget.dataset.reaction;

    try {
        const response = await fetch(`/api/posts/${postId}/react`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reaction_type: reactionType })
        });

        if (response.ok) {
            await loadPosts();
        }
    } catch (error) {
        console.error('Reaction error:', error);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Comments functionality
async function toggleComments(e) {
    const postId = e.currentTarget.dataset.postId;
    const commentsSection = document.getElementById(`comments-${postId}`);
    if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        await loadComments(postId);
    } else {
        commentsSection.style.display = 'none';
    }
}

async function loadComments(postId) {
    const commentsList = document.getElementById(`comments-list-${postId}`);
    const existingComments = commentsList.querySelectorAll('.comment');
    const loadedCount = existingComments.length;

    try {
        const response = await fetch(`/api/comments/post/${postId}`);
        const data = await response.json();
        const commentBtn = document.querySelector(`.btn-comment[data-post-id="${postId}"]`);
        const commentCount = commentBtn.querySelector('.comment-count');
        commentCount.textContent = data.comments.length;

        if (data.comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first to comment!</p>';
            return;
        }

        commentsList.innerHTML = data.comments.map(comment => renderSingleComment(comment)).join('');

        // Re-attach event listeners
        attachPostEventListeners();
    } catch (error) {
        console.error('Load comments error:', error);
        commentsList.innerHTML = '<p class="error">Failed to load comments</p>';
    }
}

async function loadMoreComments(e) {
    const postId = e.target.dataset.postId;
    const loadMoreBtn = e.target;

    loadMoreBtn.textContent = 'Loading...';
    loadMoreBtn.disabled = true;

    try {
        await loadComments(postId);
    } catch (error) {
        console.error('Load more comments error:', error);
        loadMoreBtn.textContent = 'Failed to load';
        loadMoreBtn.disabled = false;
    }
}

async function handleDeleteComment(e) {
    const commentId = e.target.dataset.commentId;
    const postId = e.target.dataset.postId;

    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
        const response = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
        if (response.ok) {
            // Remove comment from DOM
            const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
            if (commentElement) commentElement.remove();

            // Update comment count
            const commentBtn = document.querySelector(`.btn-comment[data-post-id="${postId}"]`);
            const commentCount = commentBtn.querySelector('.comment-count');
            const currentCount = parseInt(commentCount.textContent) || 0;
            commentCount.textContent = Math.max(0, currentCount - 1);

            // Check if no comments left
            const commentsList = document.getElementById(`comments-list-${postId}`);
            const remainingComments = commentsList.querySelectorAll('.comment');
            if (remainingComments.length === 0) {
                commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first to comment!</p>';
            }
        } else {
            alert('Failed to delete comment');
        }
    } catch (error) {
        console.error('Delete comment error:', error);
        alert('Failed to delete comment');
    }
}

async function submitComment(e) {
    const postId = e.target.dataset.postId;
    const commentsSection = document.getElementById(`comments-${postId}`);
    const textarea = commentsSection.querySelector('.comment-input');
    const content = textarea.value.trim();
    if (!content) {
        alert('Please enter a comment');
        return;
    }
    try {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ post_id: parseInt(postId), content: content })
        });
        if (response.ok) {
            textarea.value = '';
            const data = await response.json();

            // The Socket.io listener will handle adding the comment to the UI
            // But we still update the count here in case Socket.io is delayed
            const commentBtn = document.querySelector(`.btn-comment[data-post-id="${postId}"]`);
            const commentCount = commentBtn.querySelector('.comment-count');
            const currentCount = parseInt(commentCount.textContent) || 0;
            commentCount.textContent = currentCount + 1;
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to post comment');
        }
    } catch (error) {
        console.error('Submit comment error:', error);
        alert('Failed to post comment');
    }
}

// Update all post timestamps every minute
function startTimestampUpdater() {
    // Update immediately on load
    updateAllTimestamps();

    // Then update every 60 seconds
    setInterval(updateAllTimestamps, 60000);
}

function updateAllTimestamps() {
    const timestampElements = document.querySelectorAll('.post-time[data-timestamp]');
    timestampElements.forEach(element => {
        const timestamp = element.getAttribute('data-timestamp');
        if (timestamp) {
            element.textContent = formatDate(timestamp);
        }
    });
}
