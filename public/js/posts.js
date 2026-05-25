// Posts feed functionality

let currentMediaFile = null;     // single file for video/audio
let currentMediaFiles = [];      // array of File objects for images (up to 10)
let currentMediaType = null;
let currentAudioDuration = null;
let currentAudioFormat = null;
let _previewObjectUrl = null;    // single object URL for video/audio preview
let _previewObjectUrls = [];     // object URLs for image thumbnails (to revoke)
let postsSocket = null;

// Pagination state
let currentOffset = 0;
let currentTagFilter = null;
let isLoadingMore = false;
let hasMorePosts = true;

// Client-side cache for link previews
const _linkPreviewFetched = new Set();

function renderSkeletonPosts(count = 3) {
    const skeletonPost = `
        <div class="skeleton-post">
            <div class="skeleton-header">
                <div class="skeleton-avatar-block"></div>
                <div class="skeleton-meta">
                    <div class="skeleton-line skeleton-name"></div>
                    <div class="skeleton-line skeleton-time"></div>
                </div>
            </div>
            <div class="skeleton-line skeleton-body-line"></div>
            <div class="skeleton-line skeleton-body-line"></div>
            <div class="skeleton-line skeleton-body-line short"></div>
            <div class="skeleton-footer-row">
                <div class="skeleton-line skeleton-btn"></div>
                <div class="skeleton-line skeleton-btn"></div>
                <div class="skeleton-line skeleton-btn"></div>
            </div>
        </div>`;
    return Array(count).fill(skeletonPost).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('postsContainer')) {
        const focusId = new URLSearchParams(location.search).get('post');
        if (focusId) {
            loadSinglePost(focusId);
        } else {
            loadPosts();
            setupLiveFeed();
        }
        setupPostCreation();
        loadTrendingTags();
        loadTrendingPosters();
        initGlobalSearch();
        startTimestampUpdater();
    }
});

// Focused single-post view (opened via /?post=<id>) — shows one post with comments expanded
async function loadSinglePost(id) {
    const postsContainer = document.getElementById('postsContainer');
    postsContainer.innerHTML = renderSkeletonPosts(1);

    const composer = document.querySelector('.create-post-section');
    if (composer) composer.style.display = 'none';

    try {
        const response = await fetch(`/api/posts/${id}`);
        if (!response.ok) {
            postsContainer.innerHTML = '<p class="no-posts">This post is no longer available. <a href="/" class="back-to-feed">Back to feed</a></p>';
            return;
        }
        const { post } = await response.json();
        postsContainer.innerHTML =
            `<a href="/" class="back-to-feed">&#8249; Back to feed</a>` + renderPost(post);
        attachPostEventListeners();
        enrichLinkPreviews();
        hideLoadMoreButton();

        // Auto-expand the comments so likes/comments are visible right away
        const section = document.getElementById(`comments-${post.id}`);
        if (section) {
            section.style.display = 'block';
            await loadComments(post.id);
        }
    } catch (error) {
        console.error('Load single post error:', error);
        postsContainer.innerHTML = '<p class="error">Failed to load post. <a href="/" class="back-to-feed">Back to feed</a></p>';
    }
}

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

function handleImageUpload(e) {
    const files = Array.from(e.target.files);
    e.target.value = ''; // reset so same files can trigger change again
    if (!files.length) return;

    // Clear video/audio if switching to image
    if (currentMediaType && currentMediaType !== 'image') clearMedia();

    const remaining = 10 - currentMediaFiles.length;
    if (remaining <= 0) {
        showToast('Maximum 10 images per post', 'warning');
        return;
    }

    let skipped = 0;
    for (const file of files) {
        if (currentMediaFiles.length >= 10) { skipped++; continue; }
        if (file.size > 10 * 1024 * 1024) {
            showToast(`${file.name} exceeds 10MB, skipped`, 'warning');
            skipped++;
            continue;
        }
        currentMediaFiles.push(file);
    }
    if (skipped > 0 && files.length - skipped > 0) {
        showToast(`Added ${files.length - skipped} image${files.length - skipped !== 1 ? 's' : ''} (${skipped} skipped)`, 'info');
    } else if (currentMediaFiles.length > remaining && files.length > remaining) {
        showToast(`Max 10 images per post`, 'warning');
    }

    if (currentMediaFiles.length === 0) return;
    currentMediaType = 'image';
    currentMediaFile = null;
    renderImagePreviewGrid();
}

function renderImagePreviewGrid() {
    // Revoke old preview URLs
    for (const u of _previewObjectUrls) URL.revokeObjectURL(u);
    _previewObjectUrls = [];

    const grid = document.getElementById('mediaPreviewGrid');
    const singleImg = document.getElementById('mediaPreviewImg');
    const video = document.getElementById('mediaPreviewVideo');
    const audio = document.getElementById('mediaPreviewAudio');
    singleImg.style.display = 'none';
    if (video) video.style.display = 'none';
    if (audio) audio.style.display = 'none';

    grid.innerHTML = '';
    currentMediaFiles.forEach((file, i) => {
        const url = URL.createObjectURL(file);
        _previewObjectUrls.push(url);
        const thumb = document.createElement('div');
        thumb.className = 'media-preview-thumb';
        thumb.innerHTML = `<img src="${url}" alt="Image ${i + 1}"><button class="media-preview-thumb-remove" title="Remove" type="button">&#x2715;</button>`;
        thumb.querySelector('.media-preview-thumb-remove').addEventListener('click', () => {
            currentMediaFiles.splice(i, 1);
            if (currentMediaFiles.length === 0) { clearMedia(); } else { renderImagePreviewGrid(); }
        });
        grid.appendChild(thumb);
    });

    const countLabel = document.createElement('span');
    countLabel.className = 'media-preview-count';
    countLabel.textContent = `${currentMediaFiles.length}/10`;
    grid.appendChild(countLabel);

    grid.style.display = 'flex';
    document.getElementById('mediaPreview').style.display = 'block';
}

function handleVideoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        showToast('Video must be less than 10MB', 'warning');
        e.target.value = '';
        return;
    }

    currentMediaFile = file;
    currentMediaType = 'video';
    if (_previewObjectUrl) URL.revokeObjectURL(_previewObjectUrl);
    _previewObjectUrl = URL.createObjectURL(file);

    const mediaPreview = document.getElementById('mediaPreview');
    const mediaPreviewImg = document.getElementById('mediaPreviewImg');
    const mediaPreviewVideo = document.getElementById('mediaPreviewVideo');
    const mediaPreviewAudio = document.getElementById('mediaPreviewAudio');

    mediaPreviewVideo.src = _previewObjectUrl;
    mediaPreviewVideo.style.display = 'block';
    mediaPreviewImg.style.display = 'none';
    if (mediaPreviewAudio) mediaPreviewAudio.style.display = 'none';
    mediaPreview.style.display = 'block';
}

function handleAudioUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
        showToast('Audio must be less than 20MB', 'warning');
        e.target.value = '';
        return;
    }

    // Get audio format from file extension
    const format = file.name.split('.').pop().toLowerCase();
    if (!['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(format)) {
        showToast('Unsupported audio format. Please use MP3, WAV, OGG, FLAC, or M4A', 'warning');
        e.target.value = '';
        return;
    }

    currentMediaFile = file;
    currentMediaType = 'audio';
    currentAudioFormat = format;
    if (_previewObjectUrl) URL.revokeObjectURL(_previewObjectUrl);
    _previewObjectUrl = URL.createObjectURL(file);

    // Get duration from a temporary audio element
    const audio = new Audio(_previewObjectUrl);
    audio.addEventListener('loadedmetadata', () => {
        currentAudioDuration = Math.floor(audio.duration);
    });

    const mediaPreview = document.getElementById('mediaPreview');
    const mediaPreviewImg = document.getElementById('mediaPreviewImg');
    const mediaPreviewVideo = document.getElementById('mediaPreviewVideo');
    const mediaPreviewAudio = document.getElementById('mediaPreviewAudio');

    if (mediaPreviewAudio) {
        mediaPreviewAudio.src = _previewObjectUrl;
        mediaPreviewAudio.style.display = 'block';
    }
    mediaPreviewImg.style.display = 'none';
    mediaPreviewVideo.style.display = 'none';
    mediaPreview.style.display = 'block';
}

function clearMedia() {
    currentMediaFile = null;
    currentMediaFiles = [];
    currentMediaType = null;
    currentAudioDuration = null;
    currentAudioFormat = null;
    if (_previewObjectUrl) { URL.revokeObjectURL(_previewObjectUrl); _previewObjectUrl = null; }
    for (const u of _previewObjectUrls) URL.revokeObjectURL(u);
    _previewObjectUrls = [];

    document.getElementById('mediaPreview').style.display = 'none';
    const grid = document.getElementById('mediaPreviewGrid');
    if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }
    const img = document.getElementById('mediaPreviewImg');
    img.src = ''; img.style.display = 'none';
    const video = document.getElementById('mediaPreviewVideo');
    video.src = ''; video.style.display = 'none';
    const audioPreview = document.getElementById('mediaPreviewAudio');
    if (audioPreview) { audioPreview.src = ''; audioPreview.style.display = 'none'; }
    document.getElementById('imageUpload').value = '';
    document.getElementById('videoUpload').value = '';
    const audioUpload = document.getElementById('audioUpload');
    if (audioUpload) audioUpload.value = '';
}

// Quote-post state: id of the post being quoted, or null
let quotingPostId = null;

function handleQuotePost(e) {
    const btn = e.currentTarget;
    const postEl = btn.closest('.post');
    const contentEl = postEl ? postEl.querySelector('.post-content') : null;
    const snippet = contentEl ? contentEl.textContent.trim().slice(0, 140) : '';
    startQuote(btn.dataset.postId, btn.dataset.username, snippet);
}

function startQuote(postId, username, snippet) {
    quotingPostId = postId;
    const preview = document.getElementById('quotePreview');
    if (preview) {
        preview.innerHTML = `
            <div class="quote-chip">
                <div class="quote-chip-body">
                    <span class="quote-chip-label">Quoting @${username}</span>
                    ${snippet ? `<span class="quote-chip-snippet">${escapeHtml(snippet)}</span>` : ''}
                </div>
                <button type="button" class="quote-chip-remove" id="cancelQuoteBtn" title="Remove">&#x2715;</button>
            </div>`;
        preview.style.display = 'block';
        const cancel = document.getElementById('cancelQuoteBtn');
        if (cancel) cancel.addEventListener('click', cancelQuote);
    }
    const textarea = document.getElementById('postContent');
    if (textarea) {
        textarea.focus();
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function cancelQuote() {
    quotingPostId = null;
    const preview = document.getElementById('quotePreview');
    if (preview) {
        preview.style.display = 'none';
        preview.innerHTML = '';
    }
}

async function createPost() {
    const content = document.getElementById('postContent').value.trim();
    const visibility = document.getElementById('postVisibility')?.value || 'public';

    if (!content && !currentMediaFile && currentMediaFiles.length === 0 && !quotingPostId) {
        showToast('Please add some content or media', 'warning');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('content', content);
        formData.append('visibility', visibility);
        if (quotingPostId) formData.append('quoted_post_id', quotingPostId);

        if (currentMediaType === 'image' && currentMediaFiles.length > 0) {
            formData.append('media_type', 'image');
            for (const file of currentMediaFiles) {
                formData.append('media', file);
            }
        } else if (currentMediaFile) {
            if (currentMediaType) formData.append('media_type', currentMediaType);
            formData.append('media', currentMediaFile);
            if (currentMediaType === 'audio') {
                if (currentAudioDuration) formData.append('audio_duration', currentAudioDuration);
                if (currentAudioFormat) formData.append('audio_format', currentAudioFormat);
            }
        }

        const response = await fetch('/api/posts', {
            method: 'POST',
            body: formData
            // No Content-Type header — browser sets multipart boundary automatically
        });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.error || 'Failed to create post', 'error');
            return;
        }

        // Clear form
        document.getElementById('postContent').value = '';
        if (document.getElementById('postVisibility')) {
            document.getElementById('postVisibility').value = 'public';
        }
        clearMedia();
        cancelQuote();

        // Reset pagination and reload posts (respecting current filter)
        currentOffset = 0;
        hasMorePosts = true;
        await loadPosts(currentTagFilter);
        await loadTrendingTags();
    } catch (error) {
        console.error('Create post error:', error);
        showToast('Failed to create post', 'error');
    }
}

async function loadPosts(tagFilter = null, append = false) {
    const postsContainer = document.getElementById('postsContainer');

    if (!append) {
        postsContainer.innerHTML = renderSkeletonPosts(4);
    }

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

        // Enrich posts with link previews
        enrichLinkPreviews();

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

function renderCarousel(urls) {
    const galleryJson = JSON.stringify(urls);
    const tiles = urls.map((url, i) =>
        `<div class="carousel-tile">
            <img src="${url}" alt="Image ${i + 1} of ${urls.length}" class="carousel-img" data-lightbox data-gallery='${galleryJson}' data-gallery-index="${i}" loading="lazy">
        </div>`
    ).join('');
    return `<div class="post-carousel">${tiles}</div>`;
}

function renderQuotedPost(quoted) {
    if (!quoted) return '';
    if (quoted.redacted) {
        return `<div class="quoted-post quoted-post-redacted">This post is no longer available.</div>`;
    }
    const avatarUrl = quoted.user_profile_picture || `https://ui-avatars.com/api/?name=${quoted.username}&background=random`;
    let mediaHtml = '';
    if (quoted.media_type === 'image') {
        const urls = (quoted.media_urls && quoted.media_urls.length) ? quoted.media_urls
                   : (quoted.media_url ? [quoted.media_url] : []);
        if (urls.length > 1) {
            mediaHtml = renderCarousel(urls);
        } else if (urls.length === 1) {
            const galleryJson = JSON.stringify(urls);
            mediaHtml = `<img src="${urls[0]}" alt="" class="quoted-post-media" data-lightbox data-gallery='${galleryJson}' data-gallery-index="0" loading="lazy">`;
        }
    }
    const content = linkifyUrls(linkifyHashtags(escapeHtml(quoted.content || '')));
    return `
        <div class="quoted-post" data-quoted-id="${quoted.id}">
            <div class="quoted-post-header">
                <img src="${avatarUrl}" alt="${quoted.username}" class="quoted-post-avatar">
                <a href="/profile.html?username=${quoted.username}" class="quoted-post-username">${quoted.username}</a>
                <span class="quoted-post-time" data-timestamp="${quoted.created_at}">${formatDate(quoted.created_at)}</span>
            </div>
            ${content ? `<div class="quoted-post-content">${content}</div>` : ''}
            ${mediaHtml}
        </div>
    `;
}

// Clicking an embedded quoted post opens the original (unless a link or image was clicked)
function handleQuotedPostClick(e) {
    if (e.target.closest('a') || e.target.closest('[data-lightbox]') || e.target.closest('.carousel-img')) return;
    const id = e.currentTarget.dataset.quotedId;
    if (id) window.location.href = `/?post=${id}`;
}

function renderPost(post) {
    const isOwner = currentUser && post.user_id === currentUser.id;
    const isAdmin = currentUser && currentUser.is_admin;
    const isGuestUser = typeof isGuest !== 'undefined' && isGuest;
    const avatarUrl = post.user_profile_picture || `https://ui-avatars.com/api/?name=${post.username}&background=random`;

    // Render media based on type
    let mediaHtml = '';
    if (post.media_type === 'image') {
        const urls = (post.media_urls && post.media_urls.length) ? post.media_urls
                   : (post.media_url ? [post.media_url] : []);
        if (urls.length > 1) {
            mediaHtml = renderCarousel(urls);
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
            const pinBtn = isAdmin
                ? (post.is_pinned
                    ? `<button class="btn-unpin-post" data-post-id="${post.id}">📌 Unpin</button>`
                    : `<button class="btn-pin-post" data-post-id="${post.id}">📌 Pin</button>`)
                : '';
            actionsMenuHtml = `
                <div class="post-actions-menu">
                    ${pinBtn}
                    <button class="btn-edit-post" data-post-id="${post.id}">Edit</button>
                    <button class="btn-delete-post" data-post-id="${post.id}">Delete</button>
                </div>
            `;
        } else if (isAdmin) {
            // Admins can delete or pin any post
            const pinBtn = post.is_pinned
                ? `<button class="btn-unpin-post" data-post-id="${post.id}">📌 Unpin</button>`
                : `<button class="btn-pin-post" data-post-id="${post.id}">📌 Pin</button>`;
            actionsMenuHtml = `
                <div class="post-actions-menu">
                    ${pinBtn}
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

    const pinnedBannerHtml = post.is_pinned
        ? `<div class="pinned-banner">📌 Pinned post</div>`
        : '';

    return `
        <div class="post${post.is_pinned ? ' post-pinned' : ''}" data-post-id="${post.id}">
            ${pinnedBannerHtml}
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
            ${post.content && post.content.trim() ? `<div class="post-content">${contentWithLinks}</div>` : ''}
            ${renderQuotedPost(post.quoted_post)}
            ${mediaHtml}
            ${tagsHtml}
            <div class="post-footer">
                <button class="btn-reaction ${post.is_liked ? 'liked' : ''}" data-post-id="${post.id}" data-reaction="like" data-liked="${post.is_liked ? '1' : '0'}" ${isGuestUser ? 'disabled title="Login to react to posts"' : ''}>
                    ${post.is_liked ? '❤️' : '👍'} Like <span class="reaction-count">${post.reaction_count || 0}</span>
                </button>
                <button class="btn-comment" data-post-id="${post.id}" ${isGuestUser ? 'disabled title="Login to comment"' : ''}>
                    💬 Comment <span class="comment-count">${post.comment_count || 0}</span>
                </button>
                <button class="btn-quote" data-post-id="${post.id}" data-username="${post.username}" ${isGuestUser ? 'disabled title="Login to quote posts"' : ''}>
                    🔁 Quote
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

async function loadTrendingPosters() {
    try {
        const response = await fetch('/api/discovery/trending-posters?limit=5');
        if (!response.ok) return;
        const posters = await response.json();

        const container = document.getElementById('trendingPosters');
        if (!container || !posters.length) return;

        container.innerHTML = `
            <h4>Hot right now</h4>
            ${posters.map(p => {
                const avatarSrc = p.profile_picture
                    ? p.profile_picture
                    : `https://ui-avatars.com/api/?name=${encodeURIComponent(p.username)}&background=random`;
                return `
                    <a href="/profile.html?username=${encodeURIComponent(p.username)}" class="trending-poster-item">
                        <img src="${avatarSrc}" alt="${p.username}" class="trending-poster-avatar">
                        <span class="trending-poster-name">@${p.username}</span>
                    </a>
                `;
            }).join('')}
        `;
    } catch (error) {
        console.error('Load trending posters error:', error);
    }
}

async function enrichLinkPreviews() {
    const postCards = document.querySelectorAll('.post:not([data-previews-loaded])');
    for (const card of postCards) {
        card.setAttribute('data-previews-loaded', '1');
        const contentEl = card.querySelector('.post-content');
        if (!contentEl) continue;

        // Find all external links in post content (skip YouTube — already embedded)
        const links = [...contentEl.querySelectorAll('a.post-link')].filter(a => {
            const href = a.href;
            return href && !href.includes('youtube.com') && !href.includes('youtu.be');
        });
        if (!links.length) continue;

        // Insert previews after the content element, in order
        let insertAfter = contentEl;
        for (const link of links) {
            const href = link.href;
            if (_linkPreviewFetched.has(href)) continue;
            _linkPreviewFetched.add(href);

            try {
                const res = await fetch(`/api/discovery/link-preview?url=${encodeURIComponent(href)}`);
                if (!res.ok) continue;
                const preview = await res.json();
                if (!preview.title) continue;

                const card_html = `
                    <a href="${href}" target="_blank" rel="noopener noreferrer" class="link-preview-card">
                        ${preview.image ? `<img src="${preview.image}" alt="" class="link-preview-image" onerror="this.style.display='none'">` : ''}
                        <div class="link-preview-body">
                            <span class="link-preview-site">${preview.siteName || ''}</span>
                            <span class="link-preview-title">${preview.title}</span>
                            ${preview.description ? `<span class="link-preview-desc">${preview.description}</span>` : ''}
                        </div>
                    </a>
                `;

                const previewDiv = document.createElement('div');
                previewDiv.innerHTML = card_html;
                const cardEl = previewDiv.firstElementChild;
                insertAfter.after(cardEl);
                insertAfter = cardEl;
            } catch {
                // skip on error
            }
        }
    }
}

let _searchDebounceTimer = null;

function initGlobalSearch() {
    // Desktop search bar
    const input = document.getElementById('globalSearch');
    const dropdown = document.getElementById('searchResults');
    if (input && dropdown) {
        input.addEventListener('input', () => {
            clearTimeout(_searchDebounceTimer);
            const q = input.value.trim();
            if (!q) { dropdown.style.display = 'none'; return; }
            _searchDebounceTimer = setTimeout(() => performSearch(q, dropdown), 300);
        });

        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        input.addEventListener('focus', () => {
            if (input.value.trim() && dropdown.innerHTML) dropdown.style.display = 'block';
        });
    }

    // Mobile search overlay
    const mobileSearchBtn = document.getElementById('mobileSearch');
    const overlay = document.getElementById('mobileSearchOverlay');
    const mobileInput = document.getElementById('mobileSearchInput');
    const mobileDropdown = document.getElementById('mobileSearchResults');
    const closeBtn = document.getElementById('mobileSearchClose');

    if (mobileSearchBtn && overlay) {
        mobileSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            overlay.classList.add('active');
            setTimeout(() => mobileInput && mobileInput.focus(), 50);
        });
    }

    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => {
            overlay.classList.remove('active');
            if (mobileInput) mobileInput.value = '';
            if (mobileDropdown) mobileDropdown.style.display = 'none';
        });
    }

    if (mobileInput && mobileDropdown) {
        mobileInput.addEventListener('input', () => {
            clearTimeout(_searchDebounceTimer);
            const q = mobileInput.value.trim();
            if (!q) { mobileDropdown.style.display = 'none'; return; }
            _searchDebounceTimer = setTimeout(() => performSearch(q, mobileDropdown), 300);
        });
    }
}

async function performSearch(q, dropdown) {
    if (!dropdown) dropdown = document.getElementById('searchResults');
    if (!dropdown) return;

    try {
        const res = await fetch(`/api/discovery/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();

        const { users = [], posts = [] } = data;

        if (!users.length && !posts.length) {
            dropdown.innerHTML = '<div class="search-no-results">No results found</div>';
            dropdown.style.display = 'block';
            return;
        }

        let html = '';

        if (users.length) {
            html += '<div class="search-results-section">';
            html += '<div class="search-results-label">Users</div>';
            html += users.map(u => {
                const avatar = u.profile_picture
                    ? u.profile_picture
                    : `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=random`;
                return `
                    <div class="search-result-user" data-href="/profile.html?username=${encodeURIComponent(u.username)}">
                        <img src="${avatar}" alt="" class="search-result-avatar">
                        <span class="search-result-name">@${u.username}</span>
                    </div>
                `;
            }).join('');
            html += '</div>';
        }

        if (posts.length) {
            html += '<div class="search-results-section">';
            html += '<div class="search-results-label">Posts</div>';
            html += posts.map(p => `
                <div class="search-result-post" data-post-id="${p.id}">
                    <span class="search-result-snippet">${p.content.replace(/</g, '&lt;')}</span>
                    <span class="search-result-author">@${p.username}</span>
                </div>
            `).join('');
            html += '</div>';
        }

        dropdown.innerHTML = html;
        dropdown.style.display = 'block';

        // Click handlers for results
        dropdown.querySelectorAll('.search-result-user[data-href]').forEach(el => {
            el.addEventListener('click', () => {
                window.location.href = el.dataset.href;
            });
        });

        dropdown.querySelectorAll('.search-result-post[data-post-id]').forEach(el => {
            el.addEventListener('click', () => {
                const postId = el.dataset.postId;
                const postEl = document.querySelector(`.post-card[data-post-id="${postId}"]`);
                if (postEl) {
                    postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    postEl.style.outline = '2px solid var(--accent)';
                    setTimeout(() => { postEl.style.outline = ''; }, 2000);
                }
                dropdown.style.display = 'none';
            });
        });
    } catch (error) {
        console.error('Search error:', error);
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

    // Pin/unpin post buttons (admin only)
    document.querySelectorAll('.btn-pin-post').forEach(btn => {
        btn.addEventListener('click', handlePinPost);
    });
    document.querySelectorAll('.btn-unpin-post').forEach(btn => {
        btn.addEventListener('click', handleUnpinPost);
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

    // Quote buttons
    document.querySelectorAll('.btn-quote').forEach(btn => {
        btn.addEventListener('click', handleQuotePost);
    });

    // Embedded quoted posts (click to open the original)
    document.querySelectorAll('.quoted-post[data-quoted-id]').forEach(el => {
        el.addEventListener('click', handleQuotedPostClick);
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
            showToast(data.error || 'Failed to edit post', 'error');
        }
    } catch (error) {
        console.error('Edit post error:', error);
        showToast('Failed to edit post', 'error');
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
            showToast(data.error || 'Failed to delete post', 'error');
        }
    } catch (error) {
        console.error('Delete post error:', error);
        showToast('Failed to delete post', 'error');
    }
}

async function handlePinPost(e) {
    const postId = e.target.dataset.postId;

    try {
        const response = await fetch(`/api/moderation/posts/${postId}/pin`, { method: 'POST' });
        if (response.ok) {
            await loadPosts();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to pin post', 'error');
        }
    } catch (error) {
        console.error('Pin post error:', error);
        showToast('Failed to pin post', 'error');
    }
}

async function handleUnpinPost(e) {
    const postId = e.target.dataset.postId;

    try {
        const response = await fetch(`/api/moderation/posts/${postId}/pin`, { method: 'DELETE' });
        if (response.ok) {
            await loadPosts();
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to unpin post', 'error');
        }
    } catch (error) {
        console.error('Unpin post error:', error);
        showToast('Failed to unpin post', 'error');
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
            showToast('Post reported. Moderators will review your report.', 'success');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to report post', 'error');
        }
    } catch (error) {
        console.error('Report post error:', error);
        showToast('Failed to report post', 'error');
    }
}

async function handleReaction(e) {
    const btn = e.currentTarget;
    const postId = btn.dataset.postId;
    const reactionType = btn.dataset.reaction;
    const isLiked = btn.dataset.liked === '1';

    // Optimistic update
    const countEl = btn.querySelector('.reaction-count');
    const newLiked = !isLiked;
    btn.dataset.liked = newLiked ? '1' : '0';
    btn.classList.toggle('liked', newLiked);
    btn.innerHTML = `${newLiked ? '❤️' : '👍'} Like <span class="reaction-count">${parseInt(countEl.textContent) + (newLiked ? 1 : -1)}</span>`;

    try {
        const response = isLiked
            ? await fetch(`/api/posts/${postId}/react/${reactionType}`, { method: 'DELETE' })
            : await fetch(`/api/posts/${postId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reaction_type: reactionType })
            });

        if (!response.ok) {
            // Revert on failure
            btn.dataset.liked = isLiked ? '1' : '0';
            btn.classList.toggle('liked', isLiked);
            const revertCount = parseInt(btn.querySelector('.reaction-count').textContent) + (newLiked ? -1 : 1);
            btn.innerHTML = `${isLiked ? '❤️' : '👍'} Like <span class="reaction-count">${revertCount}</span>`;
        }
    } catch (error) {
        console.error('Reaction error:', error);
        // Revert on error
        btn.dataset.liked = isLiked ? '1' : '0';
        btn.classList.toggle('liked', isLiked);
        const revertCount = parseInt(btn.querySelector('.reaction-count').textContent) + (newLiked ? -1 : 1);
        btn.innerHTML = `${isLiked ? '❤️' : '👍'} Like <span class="reaction-count">${revertCount}</span>`;
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
            showToast('Failed to delete comment', 'error');
        }
    } catch (error) {
        console.error('Delete comment error:', error);
        showToast('Failed to delete comment', 'error');
    }
}

async function submitComment(e) {
    const postId = e.target.dataset.postId;
    const commentsSection = document.getElementById(`comments-${postId}`);
    const textarea = commentsSection.querySelector('.comment-input');
    const content = textarea.value.trim();
    if (!content) {
        showToast('Please enter a comment', 'warning');
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
            showToast(data.error || 'Failed to post comment', 'error');
        }
    } catch (error) {
        console.error('Submit comment error:', error);
        showToast('Failed to post comment', 'error');
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

// Image lightbox with zoom + pan + gallery navigation
(function initLightbox() {
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const closeBtn = document.getElementById('closeLightbox');
    const prevBtn = document.getElementById('lightboxPrev');
    const nextBtn = document.getElementById('lightboxNext');
    const counterEl = document.getElementById('lightboxCounter');
    if (!lightbox || !lightboxImg) return;

    const MIN_SCALE = 1, MAX_SCALE = 8;
    let scale = 1, tx = 0, ty = 0;
    let isDragging = false, hasDragged = false;
    let dragStartX = 0, dragStartY = 0, dragStartTx = 0, dragStartTy = 0;
    let lastPinchDist = null;
    let lbTouchStartX = 0;

    // Gallery state
    let gallery = [];
    let galleryIndex = 0;

    function applyTransform() {
        lightboxImg.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
        lightboxImg.classList.toggle('lb-zoomed', scale > 1);
        lightboxImg.classList.toggle('lb-dragging', isDragging);
    }

    function resetZoom() {
        scale = 1; tx = 0; ty = 0;
        applyTransform();
    }

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
        resetZoom();
        updateGalleryUI();
    }

    if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(-1); });
    if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(1); });

    // Open lightbox
    document.addEventListener('click', function(e) {
        const img = e.target.closest('img[data-lightbox]');
        if (!img) return;
        if (!img.src || img.src.startsWith('data:image/svg+xml')) return;

        try {
            gallery = img.dataset.gallery ? JSON.parse(img.dataset.gallery) : [img.src];
        } catch { gallery = [img.src]; }
        galleryIndex = parseInt(img.dataset.galleryIndex || '0');
        if (galleryIndex < 0 || galleryIndex >= gallery.length) galleryIndex = 0;

        lightboxImg.src = gallery[galleryIndex];
        lightbox.classList.add('active');
        resetZoom();
        updateGalleryUI();
    });

    function closeLightbox() {
        lightbox.classList.remove('active');
        lightboxImg.src = '';
        gallery = [];
        galleryIndex = 0;
        resetZoom();
        if (prevBtn) prevBtn.classList.remove('lb-nav-visible');
        if (nextBtn) nextBtn.classList.remove('lb-nav-visible');
        if (counterEl) counterEl.style.display = 'none';
    }

    // Scroll wheel zoom — zooms toward cursor position
    lightbox.addEventListener('wheel', function(e) {
        e.preventDefault();
        const rect = lightboxImg.getBoundingClientRect();
        const imgCenterX = rect.left + rect.width / 2;
        const imgCenterY = rect.top + rect.height / 2;

        const prevScale = scale;
        const delta = e.deltaY < 0 ? 1.12 : 0.9;
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));

        if (scale > 1) {
            // Shift translate so we zoom toward the cursor
            const cursorTx = (e.clientX - imgCenterX) / prevScale;
            const cursorTy = (e.clientY - imgCenterY) / prevScale;
            tx += cursorTx * (1 - scale / prevScale);
            ty += cursorTy * (1 - scale / prevScale);
        } else {
            tx = 0; ty = 0;
        }
        applyTransform();
    }, { passive: false });

    // Double-click to reset zoom
    lightboxImg.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        if (scale > 1) {
            resetZoom();
        } else {
            // Double-click to zoom in 2x toward click point
            const rect = lightboxImg.getBoundingClientRect();
            scale = 2;
            tx = (e.clientX - (rect.left + rect.width / 2)) * -0.5;
            ty = (e.clientY - (rect.top + rect.height / 2)) * -0.5;
            applyTransform();
        }
    });

    // Mouse drag to pan
    lightboxImg.addEventListener('mousedown', function(e) {
        if (scale <= 1) return;
        e.preventDefault();
        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartTx = tx;
        dragStartTy = ty;
        applyTransform();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const dx = (e.clientX - dragStartX) / scale;
        const dy = (e.clientY - dragStartY) / scale;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
        tx = dragStartTx + dx;
        ty = dragStartTy + dy;
        applyTransform();
    });

    document.addEventListener('mouseup', function() {
        isDragging = false;
        applyTransform();
    });

    // Touch: pinch-to-zoom + single-finger swipe to navigate gallery
    lightbox.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            lastPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        } else if (e.touches.length === 1) {
            lbTouchStartX = e.touches[0].clientX;
        }
    }, { passive: true });

    lightbox.addEventListener('touchmove', function(e) {
        if (e.touches.length !== 2 || !lastPinchDist) return;
        e.preventDefault();
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (dist / lastPinchDist)));
        if (scale === MIN_SCALE) { tx = 0; ty = 0; }
        lastPinchDist = dist;
        applyTransform();
    }, { passive: false });

    lightbox.addEventListener('touchend', function(e) {
        lastPinchDist = null;
        if (e.changedTouches.length === 1 && scale <= 1 && gallery.length > 1) {
            const dx = e.changedTouches[0].clientX - lbTouchStartX;
            if (Math.abs(dx) > 50) navigateLightbox(dx < 0 ? 1 : -1);
        }
    });

    // Close handlers
    closeBtn.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function(e) {
        if (e.target === lightbox && !hasDragged) closeLightbox();
        hasDragged = false;
    });
    document.addEventListener('keydown', function(e) {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
    });
}());
