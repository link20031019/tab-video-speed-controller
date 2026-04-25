const SPEED_STEP = 0.25;
const MIN_SPEED = 0.1;
const MAX_SPEED = 5.0;

let currentSpeed = 1.0;
let tabId = null;

(function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();

function setup() {
  // Get tabId from background service worker
  chrome.runtime.sendMessage({ action: 'getTabId' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.tabId) {
      return;
    }
    tabId = response.tabId;
    loadSpeedAndApply();
  });

  // Watch for dynamically added videos
  setupMutationObserver();

  // Keyboard shortcuts
  document.addEventListener('keydown', onKeyDown);

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(onMessage);
}

function loadSpeedAndApply() {
  const key = `speed_${tabId}`;
  chrome.storage.session.get([key], (result) => {
    currentSpeed = result[key] !== undefined ? result[key] : 1.0;
    applyToAllVideos(currentSpeed);
  });
}

function applyToAllVideos(speed) {
  const videos = document.querySelectorAll('video');
  videos.forEach((video) => {
    if (!video.isConnected) return;
    video.playbackRate = speed;

    // Re-apply when video source changes (e.g., playlist progression)
    video.addEventListener('loadedmetadata', () => {
      if (video.isConnected && video.playbackRate !== currentSpeed) {
        video.playbackRate = currentSpeed;
      }
    }, { once: true });
  });
}

function setupMutationObserver() {
  const target = document.body || document.documentElement;
  if (!target) {
    document.addEventListener('DOMContentLoaded', setupMutationObserver);
    return;
  }

  const observer = new MutationObserver((mutations) => {
    let needsApply = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === 'VIDEO' || node.querySelector('video')) {
          needsApply = true;
          break;
        }
      }
      if (needsApply) break;
    }
    if (needsApply) {
      applyToAllVideos(currentSpeed);
    }
  });

  observer.observe(target, { childList: true, subtree: true });
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  if (key !== 'a' && key !== 'd' && key !== 's') return;

  // Guard: don't intercept when user is typing in an input
  const el = document.activeElement;
  if (el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return;
  }

  // Guard: only act if there's at least one video on the page
  if (document.querySelectorAll('video').length === 0) return;

  event.preventDefault();

  if (key === 's') {
    // Toggle between 1x and 2x
    currentSpeed = currentSpeed >= 1.5 ? 1.0 : 2.0;
  } else {
    const step = key === 'a' ? -SPEED_STEP : SPEED_STEP;
    currentSpeed = parseFloat(
      Math.max(MIN_SPEED, Math.min(MAX_SPEED, currentSpeed + step)).toFixed(2)
    );
  }

  applyToAllVideos(currentSpeed);

  // Persist to session storage (direct access, no background needed)
  chrome.storage.session.set({ [`speed_${tabId}`]: currentSpeed });

  // Show brief OSD feedback
  showOSD(currentSpeed);
}

function onMessage(message, sender, sendResponse) {
  if (message.action === 'applySpeed') {
    currentSpeed = message.speed;
    applyToAllVideos(currentSpeed);
    sendResponse({ success: true });
  }

  if (message.action === 'ping') {
    const hasVideo = document.querySelectorAll('video').length > 0;
    sendResponse({ alive: true, hasVideo });
  }

  return true; // Keep channel open for async response
}

let osdTimeout = null;

function showOSD(speed) {
  const existing = document.getElementById('__tvs_osd');
  if (existing) existing.remove();

  if (osdTimeout) clearTimeout(osdTimeout);

  const osd = document.createElement('div');
  osd.id = '__tvs_osd';
  osd.textContent = `${speed.toFixed(2)}x`;
  Object.assign(osd.style, {
    position: 'fixed',
    bottom: '80px',
    right: '24px',
    background: 'rgba(0,0,0,0.75)',
    color: '#fff',
    padding: '8px 16px',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '20px',
    fontWeight: 'bold',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transition: 'opacity 0.3s ease',
    opacity: '1'
  });

  document.body.appendChild(osd);

  osdTimeout = setTimeout(() => {
    osd.style.opacity = '0';
    setTimeout(() => osd.remove(), 300);
    osdTimeout = null;
  }, 800);
}
