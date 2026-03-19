// Authentication handling for login and register pages

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
});

async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('errorMessage');

    errorMessage.textContent = '';

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            const userId = data.user ? data.user.id : null;
            await initializeCryptoKeys(password, userId).catch(e => console.warn('Crypto init failed:', e));
            window.location.href = '/';
        } else {
            // Show rate limit info if rate limited
            if (response.status === 429 && data.retryAfter) {
                const minutes = Math.floor(data.retryAfter / 60);
                const seconds = data.retryAfter % 60;
                const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                errorMessage.textContent = `Too many login attempts. Try again in ${timeStr}.`;
            } else {
                errorMessage.textContent = data.error || 'Login failed';
            }
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'An error occurred. Please try again.';
    }
}

async function handleRegister(e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorMessage = document.getElementById('errorMessage');

    errorMessage.textContent = '';

    // Validate passwords match
    if (password !== confirmPassword) {
        errorMessage.textContent = 'Passwords do not match';
        return;
    }

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            const userId = data.user ? data.user.id : null;
            await initializeCryptoKeys(password, userId).catch(e => console.warn('Crypto init failed:', e));
            window.location.href = '/';
        } else {
            // Show rate limit info if rate limited
            if (response.status === 429 && data.retryAfter) {
                const minutes = Math.floor(data.retryAfter / 60);
                const seconds = data.retryAfter % 60;
                const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                errorMessage.textContent = `Too many attempts. Try again in ${timeStr}.`;
            } else {
                errorMessage.textContent = data.error || 'Registration failed';
            }
        }
    } catch (error) {
        console.error('Registration error:', error);
        errorMessage.textContent = 'An error occurred. Please try again.';
    }
}
