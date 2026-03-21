// Check authentication and admin status
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (!data.isAuthenticated) {
            window.location.href = '/login.html';
            return false;
        }

        // Check if user is actually an admin
        if (!data.user?.isAdmin) {
            alert('Access denied. This page requires admin privileges.');
            window.location.href = '/';
            return false;
        }

        return true;
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = '/login.html';
        return false;
    }
}

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Load dashboard stats
async function loadStats() {
    try {
        const response = await fetch('/api/moderation/stats');

        if (response.status === 403) {
            alert('Access denied. Admin privileges required.');
            window.location.href = '/';
            return;
        }

        const data = await response.json();

        document.getElementById('pendingReportsCount').textContent = data.pendingReports;
        document.getElementById('bannedUsersCount').textContent = data.bannedUsers;
        document.getElementById('totalUsersCount').textContent = data.totalUsers;
        document.getElementById('removedPostsCount').textContent = data.removedPosts;
    } catch (error) {
        console.error('Load stats error:', error);
    }
}

// Load reports
async function loadReports(status = 'pending') {
    const container = document.getElementById('reportsContainer');
    container.innerHTML = '<p class="loading-message">Loading reports...</p>';

    try {
        const response = await fetch(`/api/moderation/reports?status=${status}`);

        if (!response.ok) {
            throw new Error('Failed to load reports');
        }

        const data = await response.json();

        if (data.reports.length === 0) {
            container.innerHTML = '<p class="empty-message">No reports found.</p>';
            return;
        }

        container.innerHTML = '';

        data.reports.forEach(report => {
            const reportCard = createReportCard(report);
            container.appendChild(reportCard);
        });
    } catch (error) {
        console.error('Load reports error:', error);
        container.innerHTML = '<p class="empty-message">Failed to load reports.</p>';
    }
}

// Create report card element
function createReportCard(report) {
    const card = document.createElement('div');
    card.className = 'report-card';

    const createdAt = new Date(report.created_at).toLocaleString();
    const reviewedAt = report.reviewed_at ? new Date(report.reviewed_at).toLocaleString() : 'N/A';

    card.innerHTML = `
        <div class="report-header">
            <div>
                <span class="report-type ${report.report_type}">${report.report_type}</span>
                <span class="report-status ${report.status}">${report.status}</span>
            </div>
            <div style="color: var(--text-secondary); font-size: 0.9em;">#${report.id}</div>
        </div>
        <div class="report-body">
            <div class="report-info">
                <div><strong>Reporter:</strong> ${report.reporter_username}</div>
                <div><strong>Reported User:</strong> ${report.reported_username || 'N/A'}</div>
                <div><strong>Content ID:</strong> ${report.content_id || 'N/A'}</div>
                <div><strong>Created:</strong> ${createdAt}</div>
                ${report.reviewer_username ? `<div><strong>Reviewed by:</strong> ${report.reviewer_username}</div>` : ''}
                ${report.reviewed_at ? `<div><strong>Reviewed at:</strong> ${reviewedAt}</div>` : ''}
            </div>
            <div class="report-reason">
                <strong>Reason:</strong><br>
                ${report.reason}
            </div>
        </div>
        <div class="report-actions" id="actions-${report.id}">
            ${report.status === 'pending' ? `
                <button class="btn-review" onclick="updateReportStatus(${report.id}, 'reviewed')">Mark as Reviewed</button>
                <button class="btn-resolve" onclick="updateReportStatus(${report.id}, 'resolved')">Resolve</button>
            ` : ''}
            ${report.status === 'reviewed' ? `
                <button class="btn-resolve" onclick="updateReportStatus(${report.id}, 'resolved')">Resolve</button>
            ` : ''}
            ${report.reported_user_id ? `
                <button class="btn-ban" onclick="banUser(${report.reported_user_id}, '${report.reported_username}')">Ban User</button>
            ` : ''}
            ${report.content_id && report.report_type === 'post' ? `
                <button class="btn-delete-content" onclick="deletePost(${report.content_id})">Delete Post</button>
            ` : ''}
            ${report.content_id && report.report_type === 'message' ? `
                <button class="btn-delete-content" onclick="deleteMessage(${report.content_id})">Delete Message</button>
            ` : ''}
        </div>
    `;

    return card;
}

// Update report status
async function updateReportStatus(reportId, status) {
    try {
        const response = await fetch(`/api/moderation/reports/${reportId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });

        if (!response.ok) {
            throw new Error('Failed to update report');
        }

        alert('Report updated successfully');
        loadReports(document.getElementById('reportStatusFilter').value);
        loadStats();
    } catch (error) {
        console.error('Update report error:', error);
        alert('Failed to update report');
    }
}

// Ban user
async function banUser(userId, username) {
    if (!confirm(`Are you sure you want to ban ${username}? This will remove all their content.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/moderation/ban/${userId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to ban user');
        }

        alert(`${username} has been banned and all their content removed`);
        loadReports(document.getElementById('reportStatusFilter').value);
        loadUsers();
        loadStats();
    } catch (error) {
        console.error('Ban user error:', error);
        alert('Failed to ban user');
    }
}

// Unban user
async function unbanUser(userId, username) {
    if (!confirm(`Are you sure you want to unban ${username}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/moderation/unban/${userId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Failed to unban user');
        }

        alert(`${username} has been unbanned`);
        loadUsers();
        loadStats();
    } catch (error) {
        console.error('Unban user error:', error);
        alert('Failed to unban user');
    }
}

// Delete post
async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post?')) {
        return;
    }

    try {
        const response = await fetch(`/api/moderation/posts/${postId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete post');
        }

        alert('Post deleted successfully');
        loadReports(document.getElementById('reportStatusFilter').value);
        loadStats();
    } catch (error) {
        console.error('Delete post error:', error);
        alert('Failed to delete post');
    }
}

// Delete message
async function deleteMessage(messageId) {
    if (!confirm('Are you sure you want to delete this message?')) {
        return;
    }

    try {
        const response = await fetch(`/api/moderation/messages/${messageId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Failed to delete message');
        }

        alert('Message deleted successfully');
        loadReports(document.getElementById('reportStatusFilter').value);
        loadStats();
    } catch (error) {
        console.error('Delete message error:', error);
        alert('Failed to delete message');
    }
}

// Load users
async function loadUsers() {
    const container = document.getElementById('usersContainer');
    container.innerHTML = '<p class="loading-message">Loading users...</p>';

    try {
        const response = await fetch('/api/moderation/users');

        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const data = await response.json();

        if (data.users.length === 0) {
            container.innerHTML = '<p class="empty-message">No users found.</p>';
            return;
        }

        container.innerHTML = '';

        data.users.forEach(user => {
            const userCard = createUserCard(user);
            container.appendChild(userCard);
        });
    } catch (error) {
        console.error('Load users error:', error);
        container.innerHTML = '<p class="empty-message">Failed to load users.</p>';
    }
}

// Create user card element
function createUserCard(user) {
    const card = document.createElement('div');
    card.className = `user-card ${user.is_banned ? 'banned' : ''}`;

    const createdAt = new Date(user.created_at).toLocaleDateString();
    const bannedAt = user.banned_at ? new Date(user.banned_at).toLocaleDateString() : null;

    card.innerHTML = `
        <div class="user-info">
            <div class="user-name">
                ${user.username}
                ${user.is_banned ? '<span class="user-badge banned">BANNED</span>' : ''}
            </div>
            <div class="user-stats">
                <span>${user.post_count} posts</span>
                <span>${user.report_count} reports</span>
                <span>Joined ${createdAt}</span>
                ${bannedAt ? `<span>Banned ${bannedAt}</span>` : ''}
            </div>
        </div>
        <div class="user-actions">
            ${user.is_banned ? `
                <button class="btn-unban" onclick="unbanUser(${user.id}, '${user.username}')">Unban User</button>
            ` : `
                <button class="btn-ban" onclick="banUser(${user.id}, '${user.username}')">Ban User</button>
            `}
        </div>
    `;

    return card;
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;

        // Update active tab button
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`${tabName}Tab`).classList.add('active');

        // Load data for the active tab
        if (tabName === 'reports') {
            loadReports(document.getElementById('reportStatusFilter').value);
        } else if (tabName === 'users') {
            loadUsers();
        } else if (tabName === 'bots') {
            loadBotList();
        }
    });
});

// Report status filter
document.getElementById('reportStatusFilter')?.addEventListener('change', (e) => {
    loadReports(e.target.value);
});

// Refresh buttons
document.getElementById('refreshReportsBtn')?.addEventListener('click', () => {
    loadReports(document.getElementById('reportStatusFilter').value);
    loadStats();
});

document.getElementById('refreshUsersBtn')?.addEventListener('click', () => {
    loadUsers();
    loadStats();
});


// Load bot list into dropdown and avatar grid
async function loadBotList() {
    try {
        const response = await fetch('/api/moderation/bot/list');
        if (!response.ok) return;
        const data = await response.json();

        // Populate dropdown
        const select = document.getElementById('botSelect');
        select.innerHTML = '<option value="">— random —</option>';
        data.bots.forEach(bot => {
            const opt = document.createElement('option');
            opt.value = bot.username;
            opt.textContent = `${bot.username} (${bot.style})`;
            select.appendChild(opt);
        });

        // Render avatar grid
        const grid = document.getElementById('botAvatarGrid');
        grid.innerHTML = '';
        data.bots.forEach(bot => {
            const card = document.createElement('div');
            card.className = 'bot-avatar-card';

            const imgSrc = bot.profile_picture || '';
            card.innerHTML = `
                <div class="bot-avatar-wrap">
                    <img class="bot-avatar-img" src="${imgSrc}" alt="${bot.username}" ${imgSrc ? '' : 'style="display:none"'}>
                    <div class="bot-avatar-placeholder" style="${imgSrc ? 'display:none' : ''}">
                        ${bot.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div class="bot-avatar-overlay">📷</div>
                </div>
                <span class="bot-avatar-name">${bot.username}</span>
                <input type="file" class="bot-avatar-input" accept="image/*" style="display:none">
                <span class="bot-avatar-status"></span>
            `;

            const wrap = card.querySelector('.bot-avatar-wrap');
            const input = card.querySelector('.bot-avatar-input');
            const status = card.querySelector('.bot-avatar-status');

            wrap.addEventListener('click', () => input.click());

            input.addEventListener('change', async () => {
                const file = input.files[0];
                if (!file) return;
                status.textContent = '…';
                status.className = 'bot-avatar-status';

                const formData = new FormData();
                formData.append('avatar', file);

                try {
                    const res = await fetch(`/api/moderation/bot/${bot.username}/picture`, {
                        method: 'POST',
                        body: formData
                    });
                    const result = await res.json();
                    if (res.ok) {
                        const img = card.querySelector('.bot-avatar-img');
                        const placeholder = card.querySelector('.bot-avatar-placeholder');
                        img.src = result.profile_picture;
                        img.style.display = '';
                        placeholder.style.display = 'none';
                        status.textContent = '✓';
                        status.classList.add('success');
                    } else {
                        status.textContent = '✗';
                        status.classList.add('error');
                    }
                } catch {
                    status.textContent = '✗';
                    status.classList.add('error');
                }
                setTimeout(() => { status.textContent = ''; status.className = 'bot-avatar-status'; }, 2000);
            });

            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Load bot list error:', error);
    }
}

// Trigger bot post
document.getElementById('triggerBotBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('triggerBotBtn');
    const status = document.getElementById('botTriggerStatus');
    const username = document.getElementById('botSelect').value;

    btn.disabled = true;
    btn.textContent = 'Generating...';
    status.textContent = '';
    status.className = 'bot-trigger-status';

    try {
        const response = await fetch('/api/moderation/bot/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username || undefined })
        });
        const data = await response.json();
        if (response.ok) {
            status.textContent = '✓ Post generated!';
            status.classList.add('success');
        } else {
            status.textContent = `✗ ${data.error}`;
            status.classList.add('error');
        }
    } catch (error) {
        status.textContent = '✗ Request failed';
        status.classList.add('error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Post';
    }
});

// Burst bot posts over 24 hours
document.getElementById('burstBotBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('burstBotBtn');
    const status = document.getElementById('botTriggerStatus');

    btn.disabled = true;
    btn.textContent = 'Scheduling...';
    status.textContent = '';
    status.className = 'bot-trigger-status';

    try {
        const response = await fetch('/api/moderation/bot/burst', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: 10 })
        });
        const data = await response.json();
        if (response.ok) {
            status.textContent = `✓ ${data.scheduled.length} posts fired!`;
            status.classList.add('success');
        } else {
            status.textContent = `✗ ${data.error}`;
            status.classList.add('error');
        }
    } catch (error) {
        status.textContent = '✗ Request failed';
        status.classList.add('error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Burst 10x (24h)';
    }
});

// Initialize
(async () => {
    if (await checkAuth()) {
        loadStats();
        loadReports('pending');
    }
})();
