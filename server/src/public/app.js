// DOM Elements
const standbyScreen = document.getElementById('standby-screen');
const viewportContainer = document.getElementById('viewport-container');
const previewFrame = document.getElementById('preview-frame');
const frameLoader = document.getElementById('frame-loader');
const wsBadge = document.getElementById('ws-badge');
const wsStatusText = document.getElementById('ws-status-text');
const wakelockBadge = document.getElementById('wakelock-badge');
const wakelockStatusText = document.getElementById('wakelock-status-text');
const serverUrlEl = document.getElementById('server-url');
const deskModeStatus = document.getElementById('desk-mode-status');
const barUrlPreview = document.getElementById('bar-url-preview');
const controlBar = document.getElementById('control-bar');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');

// Install UI Elements
const installBanner = document.getElementById('install-banner');
const btnInstallApp = document.getElementById('btn-install-app');
const iosInstallGuide = document.getElementById('ios-install-guide');

// Buttons
const btnActivateWakeLock = document.getElementById('btn-activate-wakelock');
const btnToggleBar = document.getElementById('btn-toggle-bar');
const btnRefresh = document.getElementById('btn-refresh');
const btnOpenExternal = document.getElementById('btn-open-external');
const btnHistory = document.getElementById('btn-history');
const btnClosePreview = document.getElementById('btn-close-preview');
const btnCloseModal = document.getElementById('btn-close-modal');

// State
let wakeLockSentinel = null;
let currentPreviewUrl = null;
let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let barCollapseTimer = null;
let deferredPrompt = null;
let audioContext = null;

// Display current server address
serverUrlEl.textContent = window.location.host;

// ==========================================
// 1. Service Worker & PWA Auto-Update Management
// ==========================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[PWA] Service Worker active on scope:', reg.scope);

      // Proactively check for updates on load, periodically, and on wake
      reg.update();
      setInterval(() => reg.update(), 60 * 60 * 1000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update();
        }
      });
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });

    // Seamless auto-reload when a new version of the app is deployed
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] New version activated, refreshing...');
        window.location.reload();
      }
    });
  });
}

// Capture Chrome / Android PWA install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('[PWA] Install prompt captured');
  if (installBanner) {
    installBanner.classList.remove('hidden');
  }
});

if (btnInstallApp) {
  btnInstallApp.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install outcome: ${outcome}`);
    deferredPrompt = null;
    if (installBanner) installBanner.classList.add('hidden');
  });
}

window.addEventListener('appinstalled', () => {
  console.log('[PWA] Application installed');
  showToast('🎉 Installed! Ready 24/7 on Home Screen');
  if (installBanner) installBanner.classList.add('hidden');
  if (iosInstallGuide) iosInstallGuide.classList.add('hidden');
  activate247DeskMode();
});

// Check if running in Standalone (PWA) Mode or iOS
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;

if (isStandalone) {
  console.log('[PWA] Running as Standalone Installed App');
  if (installBanner) installBanner.classList.add('hidden');
  if (iosInstallGuide) iosInstallGuide.classList.add('hidden');
  // Auto-activate 24/7 mode when installed app is launched
  setTimeout(activate247DeskMode, 500);
} else if (isIos && iosInstallGuide) {
  iosInstallGuide.classList.remove('hidden');
}

// ==========================================
// 2. 24/7 Desk Mode (Wake Lock + Audio Keep-Alive)
// ==========================================
async function activate247DeskMode() {
  await requestWakeLock();
  startSilentAudioKeepAlive();

  if (deskModeStatus) {
    deskModeStatus.textContent = '24/7 Active';
    deskModeStatus.className = 'value text-success';
  }
}

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      updateWakeLockUI(true);

      wakeLockSentinel.addEventListener('release', () => {
        updateWakeLockUI(false);
      });
      console.log('[WakeLock] Screen Wake Lock active.');
    } catch (err) {
      console.warn('[WakeLock] Request failed:', err);
      updateWakeLockUI(false);
    }
  } else {
    wakelockStatusText.textContent = 'Wake Lock: Unsupported';
    wakelockBadge.className = 'badge badge-inactive';
  }
}

function updateWakeLockUI(isActive) {
  if (isActive) {
    wakelockBadge.className = 'badge badge-success';
    wakelockStatusText.textContent = 'Stay-Awake: ON';
    btnActivateWakeLock.textContent = '⚡ 24/7 Desk Mode: Active';
    btnActivateWakeLock.style.opacity = '0.75';
    if (deskModeStatus) {
      deskModeStatus.textContent = '24/7 Active';
      deskModeStatus.className = 'value text-success';
    }
  } else {
    wakelockBadge.className = 'badge badge-inactive';
    wakelockStatusText.textContent = 'Stay-Awake: Off';
    btnActivateWakeLock.textContent = '⚡ Activate 24/7 Desk Mode (Always Awake)';
    btnActivateWakeLock.style.opacity = '1';
    if (deskModeStatus) {
      deskModeStatus.textContent = 'Tap to activate';
      deskModeStatus.className = 'value text-warning';
    }
  }
}

// Silent Audio Keep-Alive: prevents mobile OS from suspending WebSockets in background
function startSilentAudioKeepAlive() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) {
      audioContext = new AudioCtx();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    // Generate 1-second silent buffer loop
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(audioContext.destination);
    source.start();
    console.log('[Keep-Alive] Audio background keep-alive loop running.');
  } catch (err) {
    console.warn('[Keep-Alive] Audio loop error:', err);
  }
}

// Re-acquire Wake Lock & check connection when tab/app gains visibility
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if (!wakeLockSentinel || wakeLockSentinel.released) {
      await requestWakeLock();
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    // Catch-up check for any missed previews
    checkLatestPreview();
    // Reconnect socket if dropped
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
  }
});

btnActivateWakeLock.addEventListener('click', activate247DeskMode);
document.addEventListener('touchstart', () => {
  if (!wakeLockSentinel) activate247DeskMode();
}, { once: true });

// ==========================================
// 3. Persistent WebSocket with Heartbeat
// ==========================================
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateWsUI('connecting');

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to relay server.');
      updateWsUI('connected');
      reconnectAttempts = 0;
      clearTimeout(reconnectTimer);
      if (isStandalone) activate247DeskMode();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      console.warn('[WS] Connection closed.');
      updateWsUI('disconnected');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('[WS] Socket error:', err);
      updateWsUI('disconnected');
    };
  } catch (err) {
    console.error('[WS] Connection setup failed:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 5000);
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

// Active ping every 15s to keep socket alive through NAT/firewalls
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
  }
}, 15000);

function updateWsUI(state) {
  if (state === 'connected') {
    wsBadge.className = 'badge badge-success';
    wsStatusText.textContent = 'Connected';
  } else if (state === 'connecting') {
    wsBadge.className = 'badge badge-warning';
    wsStatusText.textContent = 'Connecting...';
  } else {
    wsBadge.className = 'badge badge-warning';
    wsStatusText.textContent = 'Reconnecting...';
  }
}

function handleWsMessage(msg) {
  if (msg.type === 'init') {
    if (msg.data && msg.data.latestPreview) {
      loadPreview(msg.data.latestPreview.url, false);
    }
  } else if (msg.type === 'navigate') {
    if (msg.data && msg.data.url) {
      loadPreview(msg.data.url, true);
    }
  }
}

// ==========================================
// 4. Preview Navigation & Viewport Management
// ==========================================
function loadPreview(url, notify = true) {
  if (!url) return;
  currentPreviewUrl = url;

  // Haptic feedback & Notification
  if (notify) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([100, 50, 100]); } catch {}
    }
    showToast(`Navigated to: ${formatUrlDisplay(url)}`);
  }

  // Hide standby, show viewport
  standbyScreen.classList.add('hidden');
  viewportContainer.classList.remove('hidden');

  // Update header text
  barUrlPreview.textContent = formatUrlDisplay(url);

  // Show loader and set frame src
  frameLoader.classList.remove('hidden');

  // If receiver is on HTTPS (e.g. Cloudflare secured domain) and preview URL is HTTP,
  // route through /proxy to prevent browser Mixed Content iframe blocking
  const isHttpsOrigin = window.location.protocol === 'https:';
  const isHttpTarget = url.startsWith('http://');

  if (isHttpsOrigin && isHttpTarget) {
    console.log('[Preview] HTTPS origin detected with HTTP target. Routing through proxy to bypass mixed-content.');
    previewFrame.src = `/proxy?url=${encodeURIComponent(url)}`;
  } else {
    previewFrame.src = url;
  }

  previewFrame.onload = () => {
    frameLoader.classList.add('hidden');
  };

  previewFrame.onerror = () => {
    frameLoader.classList.add('hidden');
    fallbackToProxy(url);
  };

  scheduleBarCollapse();
}

function fallbackToProxy(url) {
  const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
  console.log('[Proxy Fallback] Attempting frame proxy:', proxyUrl);
  previewFrame.src = proxyUrl;
}

function formatUrlDisplay(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function scheduleBarCollapse() {
  clearTimeout(barCollapseTimer);
  controlBar.classList.remove('collapsed');
  barCollapseTimer = setTimeout(() => {
    controlBar.classList.add('collapsed');
  }, 4000);
}

// ==========================================
// 5. Catch-up Sync on Reconnect
// ==========================================
async function checkLatestPreview() {
  try {
    const res = await fetch('/api/latest');
    const data = await res.json();
    if (data && data.latest && data.latest.url && data.latest.url !== currentPreviewUrl) {
      loadPreview(data.latest.url, true);
    }
  } catch (err) {
    console.warn('[Sync] Could not check latest preview:', err);
  }
}

// ==========================================
// 6. User Controls & Actions
// ==========================================
btnToggleBar.addEventListener('click', () => {
  controlBar.classList.toggle('collapsed');
  clearTimeout(barCollapseTimer);
});

btnRefresh.addEventListener('click', () => {
  if (currentPreviewUrl) {
    frameLoader.classList.remove('hidden');
    previewFrame.src = currentPreviewUrl;
    showToast('Reloading preview...');
  }
});

btnOpenExternal.addEventListener('click', () => {
  if (currentPreviewUrl) {
    window.open(currentPreviewUrl, '_blank');
  }
});

btnClosePreview.addEventListener('click', () => {
  viewportContainer.classList.add('hidden');
  standbyScreen.classList.remove('hidden');
  previewFrame.src = 'about:blank';
  currentPreviewUrl = null;
});

btnHistory.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    renderHistory(data.history || []);
    historyModal.showModal();
  } catch (e) {
    showToast('Failed to load history');
  }
});

btnCloseModal.addEventListener('click', () => {
  historyModal.close();
});

function renderHistory(items) {
  if (!items || items.length === 0) {
    historyList.innerHTML = '<p class="empty-state">No preview history yet.</p>';
    return;
  }

  historyList.innerHTML = items.map(item => `
    <div class="history-item" data-url="${escapeHtml(item.url)}">
      <div class="history-url">${escapeHtml(item.url)}</div>
      <div class="history-time">${new Date(item.timestamp).toLocaleTimeString()}</div>
    </div>
  `).join('');

  historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const url = el.getAttribute('data-url');
      historyModal.close();
      loadPreview(url, true);
    });
  });
}

function showToast(msg) {
  toastMessage.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Initialize
connectWebSocket();
