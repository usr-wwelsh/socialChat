// Register the service worker and surface an install prompt.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const btn = document.createElement('button');
  btn.id = 'pwa-install-btn';
  btn.textContent = 'Install app';
  btn.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:9999;background:#4992A7;' +
    'border:none;color:#fff;padding:.6rem 1.2rem;border-radius:20px;cursor:pointer;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.4);font-size:.9rem';
  btn.addEventListener('click', async () => {
    btn.remove();
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
  document.body.appendChild(btn);
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  document.getElementById('pwa-install-btn')?.remove();
});
