const SPEED_STEP = 0.25;
const MIN_SPEED = 0.25;
const MAX_SPEED = 100.0;
const FS_WRAPPER_CLASS = '__tvs_fs_wrapper';

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

  // Keyboard shortcuts (capture phase: intercept before page scripts like Bilibili's danmaku toggle)
  document.addEventListener('keydown', onKeyDown, true);

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(onMessage);

  // Fullscreen handling: ensure OSD is visible when video is fullscreen
  ensureFullscreenStyles();
  patchRequestFullscreen();
  document.addEventListener('fullscreenchange', onFullscreenChange);
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

function ensureFullscreenStyles() {
  if (document.getElementById('__tvs_fs_styles')) return;
  const style = document.createElement('style');
  style.id = '__tvs_fs_styles';
  style.textContent =
    `.${FS_WRAPPER_CLASS}:fullscreen,.${FS_WRAPPER_CLASS}:-webkit-full-screen{` +
    `display:flex!important;align-items:center!important;` +
    `justify-content:center!important;background:#000!important}` +
    `.${FS_WRAPPER_CLASS}:fullscreen>video,.${FS_WRAPPER_CLASS}:-webkit-full-screen>video{` +
    `width:100%!important;height:100%!important;object-fit:contain!important}`;
  (document.head || document.documentElement).appendChild(style);
}

function patchRequestFullscreen() {
  if (HTMLVideoElement.prototype.__tvs_fs_patched) return;
  HTMLVideoElement.prototype.__tvs_fs_patched = true;

  const original = HTMLVideoElement.prototype.requestFullscreen;

  HTMLVideoElement.prototype.requestFullscreen = function (options) {
    const parent = this.parentElement;

    // Already wrapped — forward fullscreen to the wrapper
    if (parent && parent.classList.contains(FS_WRAPPER_CLASS)) {
      return parent.requestFullscreen.call(parent, options);
    }

    // Detached node — fall back to native
    if (!parent || !this.isConnected) {
      return original.call(this, options);
    }

    // Wrap the video in a container so the OSD can be rendered inside it
    const wrapper = document.createElement('div');
    wrapper.classList.add(FS_WRAPPER_CLASS);
    wrapper.style.position = 'relative';

    parent.insertBefore(wrapper, this);
    wrapper.appendChild(this);

    return wrapper.requestFullscreen.call(wrapper, options);
  };
}

function onFullscreenChange() {
  if (!document.fullscreenElement) {
    document.querySelectorAll('.' + FS_WRAPPER_CLASS).forEach(function (wrapper) {
      if (!wrapper.querySelector('video')) {
        wrapper.remove();
      }
    });
  }
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  if (key !== 'a' && key !== 'd' && key !== 's') return;

  // Guard: don't intercept when modifier keys are held (e.g. Ctrl+D bookmark)
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

  // Guard: don't intercept when user is typing in an input
  // Use composedPath[0] to reach the real target inside Shadow DOM
  if (isEditableElement(event.composedPath()[0])) return;

  // Guard: only act if there's at least one video on the page
  if (document.querySelectorAll('video').length === 0) return;

  // Prevent page scripts (e.g., Bilibili danmaku toggle) from also handling this key
  event.stopPropagation();
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

  const fsElement = document.fullscreenElement;

  Object.assign(osd.style, {
    position: fsElement ? 'absolute' : 'fixed',
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

  const mountTarget = fsElement || document.body;
  mountTarget.appendChild(osd);

  osdTimeout = setTimeout(() => {
    osd.style.opacity = '0';
    setTimeout(() => osd.remove(), 300);
    osdTimeout = null;
  }, 800);
}
