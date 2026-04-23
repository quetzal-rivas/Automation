let lastSent = 0;

function reportActivity() {
  const now = Date.now();
  if (now - lastSent > 30000) { // Throttle to every 30s
    if (chrome && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({ type: 'USER_ACTIVITY' });
    }
    lastSent = now;
  }
}

window.addEventListener('mousedown', reportActivity, true);
window.addEventListener('keydown', reportActivity, true);
window.addEventListener('scroll', reportActivity, { passive: true });
