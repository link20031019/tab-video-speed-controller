let currentTabId = null;
let storageKey = null;

document.addEventListener('DOMContentLoaded', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  currentTabId = tabs[0].id;
  storageKey = `speed_${currentTabId}`;

  // Load current speed
  const result = await chrome.storage.session.get([storageKey]);
  const speed = result[storageKey] !== undefined ? result[storageKey] : 1.0;
  updateUI(speed);

  // Sync with keyboard-triggered changes while popup is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    const changed = changes[storageKey];
    if (changed) {
      updateUI(changed.newValue);
    }
  });

  pingContentScript();
  setupEventHandlers();
});

function setupEventHandlers() {
  // Preset buttons
  document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSpeed(parseFloat(btn.dataset.speed));
    });
  });

  // Slider: update display live, commit on release
  const slider = document.getElementById('slider');
  slider.addEventListener('input', () => {
    updateDisplay(parseFloat(slider.value));
  });
  slider.addEventListener('change', () => {
    setSpeed(parseFloat(slider.value));
  });

  // Reset button
  document.getElementById('reset').addEventListener('click', () => {
    setSpeed(1.0);
  });
}

async function setSpeed(speed) {
  speed = parseFloat(speed.toFixed(2));

  // Persist to session storage
  await chrome.storage.session.set({ [storageKey]: speed });

  // Notify content script to apply immediately
  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'applySpeed', speed });
  } catch {
    // Content script not reachable (e.g. chrome:// page) — stored for later
  }

  updateUI(speed);
}

function updateUI(speed) {
  updateDisplay(speed);
  document.getElementById('slider').value = speed;

  document.querySelectorAll('.preset').forEach((btn) => {
    const btnSpeed = parseFloat(btn.dataset.speed);
    btn.classList.toggle('active', Math.abs(btnSpeed - speed) < 0.01);
  });
}

function updateDisplay(speed) {
  document.getElementById('display').textContent = `${speed.toFixed(2)}x`;
}

async function pingContentScript() {
  try {
    const response = await chrome.tabs.sendMessage(currentTabId, { action: 'ping' });
    const warning = document.getElementById('no-video-warning');
    if (response && !response.hasVideo) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  } catch {
    // No content script reachable
  }
}
