/**
 * Toast notification system
 * Usage: showToast(message, type, duration)
 * Types: 'success' | 'error' | 'warning' | 'info'
 */

(function () {
    let container = null;

    const ICONS = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ',
    };

    function getContainer() {
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    window.showToast = function (message, type = 'info', duration = 3500) {
        const c = getContainer();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icon = document.createElement('em');
        icon.className = 'toast-icon';
        icon.textContent = ICONS[type] || ICONS.info;

        const body = document.createElement('span');
        body.className = 'toast-body';
        body.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(body);
        c.appendChild(toast);

        const dismiss = () => {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', () => toast.remove(), { once: true });
        };

        const timer = setTimeout(dismiss, duration);
        toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
    };
})();
