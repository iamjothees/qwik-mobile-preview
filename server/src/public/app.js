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
const barUrlPreview = document.getElementById('bar-url-preview');
const controlBar = document.getElementById('control-bar');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');

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

// Display current server address
serverUrlEl.textContent = window.location.host;

// ==========================================
// 1. Screen Wake Lock API ("Always Ready")
// ==========================================
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
    btnActivateWakeLock.textContent = '⚡ Stay-Awake Active';
    btnActivateWakeLock.style.opacity = '0.7';
  } else {
    wakelockBadge.className = 'badge badge-inactive';
    wakelockStatusText.textContent = 'Stay-Awake: Off';
    btnActivateWakeLock.textContent = '⚡ Enable Stay-Awake (Desk Mode)';
    btnActivateWakeLock.style.opacity = '1';
  }
}

// Re-acquire Wake Lock when user switches back to the tab
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if (!wakeLockSentinel || wakeLockSentinel.released) {
      await requestWakeLock();
    }
    // Catch-up check when waking up
    checkLatestPreview();
  }
});

btnActivateWakeLock.addEventListener('click', requestWakeLock);
// Also trigger on first screen tap anywhere
document.addEventListener('touchstart', () => {
  if (!wakeLockSentinel) requestWakeLock();
}, { once: true });

// ==========================================
// 2. Persistent WebSocket Connection
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
      // Auto-enable wakelock on connect
      requestWakeLock();
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
// 3. Preview Navigation & Viewport Management
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
  previewFrame.src = url;

  previewFrame.onload = () => {
    frameLoader.classList.add('hidden');
  };

  previewFrame.onerror = () => {
    frameLoader.classList.add('hidden');
    // If direct load fails due to X-Frame-Options, fallback to proxy
    fallbackToProxy(url);
  };

  // Auto-schedule bar collapse to give full-screen view
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
// 4. Catch-up Sync on Reconnect
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
// 5. User Controls & Actions
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
requestWakeLock();
