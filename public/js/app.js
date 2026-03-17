// Main application logic

let currentUser = null;
let isGuest = false;
let guestName = null;
let guestId = null;

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupNavigation();
});

async function checkAuth() {
    try {
        // Check session status (supports both guests and authenticated users)
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (data.isGuest) {
            // Guest mode
            isGuest = true;
            guestName = data.guestName;
            guestId = data.guestId;

            console.log('Guest mode activated:', guestName, guestId);

            // Update UI for guest
            if (document.getElementById('navUsername')) {
                document.getElementById('navUsername').textContent = guestName;
            }

            // Hide post creation UI for guests
            const createPostSection = document.querySelector('.create-post-section');
            if (createPostSection) {
                createPostSection.style.display = 'none';
            }

            // Show login/register prompt for guests
            showGuestPrompt();

            // Hide "My Profile" and "Friends" links for guests
            const viewProfile = document.getElementById('viewProfile');
            if (viewProfile) {
                viewProfile.style.display = 'none';
            }

            const friendsLink = document.getElementById('friendsLink');
            if (friendsLink) {
                friendsLink.style.display = 'none';
            }

            // Replace logout button with Login + Register for guests
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) {
                const navUser = document.querySelector('.nav-user');
                logoutBtn.remove(); // Remove the logout button

                // Add Login and Register buttons
                const loginBtn = document.createElement('a');
                loginBtn.href = '/login.html';
                loginBtn.className = 'btn-secondary';
                loginBtn.textContent = 'Login';

                const registerBtn = document.createElement('a');
                registerBtn.href = '/register.html';
                registerBtn.className = 'btn-primary';
                registerBtn.textContent = 'Sign Up';

                navUser.appendChild(loginBtn);
                navUser.appendChild(registerBtn);
            }

        } else if (data.isAuthenticated) {
            // Authenticated user mode
            const userResponse = await fetch('/api/auth/me');
            if (!userResponse.ok) {
                window.location.href = '/login.html';
                return;
            }

            const userData = await userResponse.json();
            currentUser = userData.user;

            // Update UI with user info
            if (document.getElementById('navUsername')) {
                document.getElementById('navUsername').textContent = `@${currentUser.username}`;
            }

            if (document.getElementById('createPostUsername')) {
                document.getElementById('createPostUsername').textContent = currentUser.username;
            }

            // Set user avatar
            const userAvatar = document.getElementById('userAvatar');
            if (userAvatar) {
                if (currentUser.profile_picture) {
                    userAvatar.src = currentUser.profile_picture;
                } else {
                    userAvatar.src = `https://ui-avatars.com/api/?name=${currentUser.username}&background=random`;
                }
            }

            // Check admin status and show moderation link if admin
            await checkAdminStatus();

        } else {
            // No session at all - should not happen with allowGuest middleware
            // Try refreshing the page once to trigger guest session creation
            if (!sessionStorage.getItem('retried')) {
                sessionStorage.setItem('retried', 'true');
                window.location.reload();
            } else {
                sessionStorage.removeItem('retried');
                window.location.href = '/login.html';
            }
        }

    } catch (error) {
        console.error('Auth check error:', error);
        // On auth error, default to guest mode instead of forcing login
        // This prevents lockouts from rate limiting or temporary network issues
        isGuest = true;
        guestName = 'Guest';
        guestId = 'temp-' + Date.now();

        console.log('Auth check failed, defaulting to guest mode');

        // Update UI for guest fallback
        if (document.getElementById('navUsername')) {
            document.getElementById('navUsername').textContent = guestName;
        }

        const createPostSection = document.querySelector('.create-post-section');
        if (createPostSection) {
            createPostSection.style.display = 'none';
        }

        showGuestPrompt();
    }
}

function showGuestPrompt() {
    // Add a banner for guests to login/register
    const mainContainer = document.querySelector('.main-container');
    if (mainContainer && !document.getElementById('guestBanner')) {
        const banner = document.createElement('div');
        banner.id = 'guestBanner';
        banner.className = 'guest-banner';
        banner.innerHTML = `
            <p>🎨 You found the underground. Now claim your username.</p>
            <div class="guest-banner-actions">
                <a href="/register.html" class="guest-btn-primary">Sign Up Free</a>
                <a href="/login.html" class="guest-btn-secondary">Login</a>
            </div>
        `;
        // Insert BEFORE the main container, not inside it
        mainContainer.parentNode.insertBefore(banner, mainContainer);
    }
}

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

function setupNavigation() {
    const logoutBtn = document.getElementById('logoutBtn');
    const viewProfile = document.getElementById('viewProfile');

    if (logoutBtn) {
        if (isGuest) {
            // For guests, clicking "Login" redirects to login page
            logoutBtn.addEventListener('click', () => {
                window.location.href = '/login.html';
            });
        } else {
            // For authenticated users, logout normally
            logoutBtn.addEventListener('click', handleLogout);
        }
    }

    if (viewProfile && !isGuest) {
        viewProfile.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = `/profile.html?username=${currentUser.username}`;
        });
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

// Helper function to format dates
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

