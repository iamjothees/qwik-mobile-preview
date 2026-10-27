// Elements
const serverStatusPill = document.getElementById('server-status-pill');
const serverStatusText = document.getElementById('server-status-text');
const lanUrlInput = document.getElementById('lan-url-input');
const btnCopyUrl = document.getElementById('btn-copy-url');
const btnPushNow = document.getElementById('btn-push-now');
const qrCanvas = document.getElementById('qr-canvas');
const receiverUrlCode = document.getElementById('receiver-url-code');
const btnOpenReceiver = document.getElementById('btn-open-receiver');
const toast = document.getElementById('toast');

// Settings Elements
const selectClickBehavior = document.getElementById('select-click-behavior');
const inputServerUrl = document.getElementById('input-server-url');
const selectNetworkInterface = document.getElementById('select-network-interface');
const btnSaveSettings = document.getElementById('btn-save-settings');

// State
let currentTab = null;
let currentResolvedUrl = null;
let currentServerUrl = 'http://localhost:4567';
let currentLanIp = null;
let serverPort = 4567;

// Initialize Popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadActiveTab();
  await checkServerStatus();
});

// Load Settings from chrome.storage
async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    serverUrl: 'http://localhost:4567',
    clickBehavior: 'one_click',
    manualIp: ''
  });

  currentServerUrl = (settings.serverUrl || 'http://localhost:4567').trim().replace(/\/+$/, '');
  inputServerUrl.value = currentServerUrl;
  selectClickBehavior.value = settings.clickBehavior;
  currentLanIp = settings.manualIp || null;
}

// Fetch Active Tab (smartly skips chrome internal pages if opened in options page)
async function loadActiveTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  let activeTab = tabs.find(t => t.active);

  // If currently active tab is an internal page (like chrome://extensions), find the last web tab
  if (activeTab && isInternalUrl(activeTab.url)) {
    const webTab = tabs.find(t => t.url && !isInternalUrl(t.url));
    if (webTab) {
      activeTab = webTab;
    }
  }

  currentTab = activeTab;
  if (!activeTab || !activeTab.url) {
    lanUrlInput.value = 'No active webpage found';
    return;
  }

  resolveAndDisplayUrl();
}

function isInternalUrl(url) {
  if (!url) return true;
  return url.startsWith('chrome://') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('chrome-extension://');
}

// Query Relay Server Status & IP
async function checkServerStatus() {
  const cleanServer = (currentServerUrl || '').trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${cleanServer}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const statusData = await res.json();
    serverPort = statusData.serverPort || 4567;

    const count = statusData.connectedClients || 0;
    serverStatusPill.className = 'status-pill status-online';
    serverStatusText.textContent = count > 0 ? `Online (${count} ready)` : 'Online (0 phones)';

    // Update laptop IP if not manually forced
    const isLocalServer = cleanServer.includes('localhost') || cleanServer.includes('127.0.0.1');
    if (!currentLanIp) {
      if (isLocalServer && statusData.primaryIp) {
        currentLanIp = statusData.primaryIp;
      } else if (!isLocalServer && statusData.callerIp && !statusData.callerIp.startsWith('172.')) {
        currentLanIp = statusData.callerIp;
      }
      resolveAndDisplayUrl();
    }

    // Populate network interfaces dropdown
    loadNetworkInterfaces();

    // Update receiver URL text
    updateReceiverUrlDisplay(statusData.primaryIp);
  } catch (err) {
    console.warn('[QwikPreview] Status check failed:', err);
    serverStatusPill.className = 'status-pill status-offline';
    serverStatusText.textContent = 'Server Offline';
    updateReceiverUrlDisplay();
  }
}

// Populate interface dropdown from server
async function loadNetworkInterfaces() {
  const cleanServer = (currentServerUrl || '').trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${cleanServer}/api/ip`);
    const data = await res.json();

    selectNetworkInterface.innerHTML = '<option value="auto">Auto-detect from server</option>';
    if (data.interfaces) {
      data.interfaces.forEach(iface => {
        const opt = document.createElement('option');
        opt.value = iface.address;
        opt.textContent = `${iface.address} (${iface.interface})`;
        selectNetworkInterface.appendChild(opt);
      });
    }
    if (currentLanIp) {
      selectNetworkInterface.value = currentLanIp;
    }
  } catch {}
}

// Transform localhost/127.0.0.1 -> LAN IP
function resolveAndDisplayUrl() {
  if (!currentTab || !currentTab.url) return;

  const rawUrl = currentTab.url;
  const ip = currentLanIp || 'localhost';

  let resolved = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = ip;
      resolved = parsed.toString();
    }
  } catch {
    resolved = rawUrl;
  }

  currentResolvedUrl = resolved;
  lanUrlInput.value = resolved;

  // Render QR Code
  renderQrCode(resolved);
}

// Generate Offline QR Code with QRCode library
function renderQrCode(text) {
  if (typeof QRCode !== 'undefined' && qrCanvas) {
    QRCode.toCanvas(qrCanvas, text, {
      width: 140,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }, (error) => {
      if (error) console.error('[QR Error]', error);
    });
  }
}

function updateReceiverUrlDisplay(serverIp = null) {
  try {
    const clean = (currentServerUrl || '').trim().replace(/\/+$/, '');
    const sUrl = new URL(clean);
    if (sUrl.protocol === 'https:' || (sUrl.hostname !== 'localhost' && sUrl.hostname !== '127.0.0.1')) {
      receiverUrlCode.textContent = clean;
      return;
    }
    const ip = serverIp || currentLanIp || '192.168.x.x';
    receiverUrlCode.textContent = `http://${ip}:${serverPort}`;
  } catch {
    receiverUrlCode.textContent = currentServerUrl;
  }
}

// Event: Push to Mobile Now Button
btnPushNow.addEventListener('click', async () => {
  btnPushNow.textContent = 'Pushing...';
  btnPushNow.disabled = true;

  const targetUrl = currentResolvedUrl || currentTab?.url;

  if (!targetUrl || isInternalUrl(targetUrl)) {
    btnPushNow.textContent = '✕ Cannot preview internal page';
    setTimeout(() => {
      btnPushNow.textContent = '⚡ Push to Mobile Now';
      btnPushNow.disabled = false;
    }, 2500);
    showToast('Open a website or localhost tab first!');
    return;
  }

  const cleanServer = (currentServerUrl || '').trim().replace(/\/+$/, '');

  try {
    const res = await fetch(`${cleanServer}/api/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetUrl,
        title: currentTab?.title || '',
        lanIp: currentLanIp || undefined
      })
    });

    if (res.ok) {
      const data = await res.json();
      const count = data.receiversNotified || 0;
      btnPushNow.textContent = count > 0 ? `✓ Sent to ${count} phone(s)!` : '✓ Pushed to Server!';
      setTimeout(() => {
        btnPushNow.textContent = '⚡ Push to Mobile Now';
        btnPushNow.disabled = false;
      }, 2000);
      checkServerStatus();
    } else {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[QwikPreview Push Error]', err);
    btnPushNow.textContent = '✕ Push failed';
    showToast(`Error: ${err.message || 'Cannot reach server'}`);
    setTimeout(() => {
      btnPushNow.textContent = '⚡ Push to Mobile Now';
      btnPushNow.disabled = false;
    }, 2500);
  }
});

// Event: Copy URL
btnCopyUrl.addEventListener('click', () => {
  if (currentResolvedUrl) {
    navigator.clipboard.writeText(currentResolvedUrl);
    showToast('Copied LAN URL to clipboard!');
  }
});

// Event: Open Receiver in Tab
btnOpenReceiver.addEventListener('click', () => {
  try {
    const clean = (currentServerUrl || '').trim().replace(/\/+$/, '');
    const sUrl = new URL(clean);
    if (sUrl.protocol === 'https:' || (sUrl.hostname !== 'localhost' && sUrl.hostname !== '127.0.0.1')) {
      chrome.tabs.create({ url: clean });
      return;
    }
    const ip = currentLanIp || 'localhost';
    chrome.tabs.create({ url: `http://${ip}:${serverPort}` });
  } catch {
    chrome.tabs.create({ url: currentServerUrl });
  }
});

// Event: Save Settings
btnSaveSettings.addEventListener('click', async () => {
  const rawInput = inputServerUrl.value.trim() || 'http://localhost:4567';
  const newServerUrl = rawInput.replace(/\/+$/, '');
  const newBehavior = selectClickBehavior.value;
  const newIp = selectNetworkInterface.value === 'auto' ? '' : selectNetworkInterface.value;

  await chrome.storage.sync.set({
    serverUrl: newServerUrl,
    clickBehavior: newBehavior,
    manualIp: newIp
  });

  currentServerUrl = newServerUrl;
  inputServerUrl.value = newServerUrl;
  currentLanIp = newIp || null;

  // Notify background service worker to update toolbar action click behavior
  chrome.runtime.sendMessage({ type: 'REFRESH_CLICK_BEHAVIOR' });

  showToast('Settings saved!');
  await checkServerStatus();
  resolveAndDisplayUrl();
});

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
}
