// Elements
const serverStatusPill = document.getElementById('server-status-pill');
const serverStatusText = document.getElementById('server-status-text');
const lanUrlInput = document.getElementById('lan-url-input');
const btnCopyUrl = document.getElementById('btn-copy-url');
const btnPushNow = document.getElementById('btn-push-now');
const qrCanvas = document.getElementById('qr-canvas');
const qrCaption = document.getElementById('qr-caption');
const tabQrTab = document.getElementById('tab-qr-tab');
const tabQrPair = document.getElementById('tab-qr-pair');

// Receiver Card Elements
const receiverUrlCode = document.getElementById('receiver-url-code');
const btnCopyPairLink = document.getElementById('btn-copy-pair-link');
const btnOpenReceiver = document.getElementById('btn-open-receiver');
const displayPairKey = document.getElementById('display-pair-key');
const toast = document.getElementById('toast');

// Settings Elements
const selectClickBehavior = document.getElementById('select-click-behavior');
const inputServerUrl = document.getElementById('input-server-url');
const inputPairKey = document.getElementById('input-pair-key');
const btnRegenPairKey = document.getElementById('btn-regen-pair-key');
const selectNetworkInterface = document.getElementById('select-network-interface');
const btnSaveSettings = document.getElementById('btn-save-settings');

// State
let currentTab = null;
let currentResolvedUrl = null;
let currentServerUrl = 'http://localhost:4567';
let currentPairKey = '';
let currentLanIp = null;
let serverPort = 4567;
let activeQrMode = 'tab'; // 'tab' | 'pair'

// Helper: Generate Random 8-character Pairing Key
function generatePairKey() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = 'qwik-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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
    clickBehavior: 'popup',
    manualIp: '',
    pairKey: ''
  });

  currentServerUrl = (settings.serverUrl || 'http://localhost:4567').trim().replace(/\/+$/, '');
  currentLanIp = settings.manualIp || null;

  // Auto-generate pairing key if not present
  if (!settings.pairKey || settings.pairKey.trim() === '') {
    currentPairKey = generatePairKey();
    await chrome.storage.sync.set({ pairKey: currentPairKey });
  } else {
    currentPairKey = settings.pairKey.trim();
  }

  inputServerUrl.value = currentServerUrl;
  if (inputPairKey) inputPairKey.value = currentPairKey;
  if (displayPairKey) displayPairKey.textContent = currentPairKey;
  selectClickBehavior.value = settings.clickBehavior;

  updateReceiverUrlDisplay();
}

// Fetch Active Tab (robust across popup dropdown, options page, or separate tabs)
async function loadActiveTab() {
  let activeTab = null;

  // 1. Check active tab in last focused window
  try {
    const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (focusedTabs.length > 0 && focusedTabs[0].url && !isInternalUrl(focusedTabs[0].url)) {
      activeTab = focusedTabs[0];
    }
  } catch {}

  // 2. Check active tab in current window
  if (!activeTab) {
    try {
      const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTabs.length > 0 && currentTabs[0].url && !isInternalUrl(currentTabs[0].url)) {
        activeTab = currentTabs[0];
      }
    } catch {}
  }

  // 3. Fallback: Search all open tabs for any web page (e.g. localhost or website)
  if (!activeTab) {
    try {
      const allTabs = await chrome.tabs.query({});
      const webTabs = allTabs.filter(t => t.url && !isInternalUrl(t.url));
      if (webTabs.length > 0) {
        activeTab = webTabs.find(t => t.active) || webTabs[webTabs.length - 1];
      }
    } catch {}
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

function isInternalBridgeIp(ip) {
  if (!ip) return true;
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('192.168.65.') || ip.startsWith('192.168.64.')) return true; // Docker Desktop Mac VM bridge / Multipass
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // Docker container bridges
  if (ip.startsWith('10.0.2.')) return true;
  return false;
}

// Query Relay Server Status & IP
async function checkServerStatus() {
  const cleanServer = (currentServerUrl || '').trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${cleanServer}/api/status?pair=${encodeURIComponent(currentPairKey)}`, {
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const statusData = await res.json();
    serverPort = statusData.serverPort || 4567;

    const count = statusData.roomClients || 0;
    serverStatusPill.className = 'status-pill status-online';
    serverStatusText.textContent = count > 0 ? `Online (${count} paired)` : 'Online (0 phones)';

    // Determine Developer's LAN IP (excluding virtual Docker bridges)
    if (!currentLanIp || isInternalBridgeIp(currentLanIp)) {
      if (statusData.primaryIp && !isInternalBridgeIp(statusData.primaryIp)) {
        currentLanIp = statusData.primaryIp;
      } else if (statusData.callerIp && !isInternalBridgeIp(statusData.callerIp)) {
        currentLanIp = statusData.callerIp;
      } else {
        try {
          const sHost = new URL(cleanServer).hostname;
          if (/^(\d{1,3}\.){3}\d{1,3}$/.test(sHost) && !isInternalBridgeIp(sHost)) {
            currentLanIp = sHost;
          }
        } catch {}
      }
      resolveAndDisplayUrl();
    }

    loadNetworkInterfaces();
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
        if (isInternalBridgeIp(iface.address)) return;
        const opt = document.createElement('option');
        opt.value = iface.address;
        opt.textContent = `${iface.address} (${iface.interface})`;
        selectNetworkInterface.appendChild(opt);
      });
    }

    // Ensure primary detected LAN IP is always in the dropdown list
    if (data.primaryIp && !isInternalBridgeIp(data.primaryIp)) {
      const exists = Array.from(selectNetworkInterface.options).some(o => o.value === data.primaryIp);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = data.primaryIp;
        opt.textContent = `${data.primaryIp} (Primary LAN / Wi-Fi)`;
        selectNetworkInterface.appendChild(opt);
      }
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

  renderActiveQr();
}

function getReceiverPairingUrl(serverIp = null) {
  try {
    const clean = (currentServerUrl || '').trim().replace(/\/+$/, '');
    const sUrl = new URL(clean);
    let base = clean;
    if (sUrl.protocol !== 'https:' && (sUrl.hostname === 'localhost' || sUrl.hostname === '127.0.0.1')) {
      const ip = serverIp || currentLanIp || '192.168.x.x';
      base = `http://${ip}:${serverPort}`;
    }
    return `${base}/?pair=${encodeURIComponent(currentPairKey)}`;
  } catch {
    return `${currentServerUrl}/?pair=${encodeURIComponent(currentPairKey)}`;
  }
}

function updateReceiverUrlDisplay(serverIp = null) {
  const pairUrl = getReceiverPairingUrl(serverIp);
  if (receiverUrlCode) receiverUrlCode.value = pairUrl;
  if (displayPairKey) displayPairKey.textContent = currentPairKey;
}

// Generate QR Code with QRCode library
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

function renderActiveQr() {
  if (activeQrMode === 'tab') {
    if (currentResolvedUrl) renderQrCode(currentResolvedUrl);
    if (qrCaption) qrCaption.textContent = 'Scan with phone camera to preview this tab';
  } else {
    const pairUrl = getReceiverPairingUrl();
    renderQrCode(pairUrl);
    if (qrCaption) qrCaption.textContent = 'Scan with phone once to pair with this laptop';
  }
}

// QR Tabs Switcher
if (tabQrTab && tabQrPair) {
  tabQrTab.addEventListener('click', () => {
    activeQrMode = 'tab';
    tabQrTab.classList.add('active');
    tabQrPair.classList.remove('active');
    renderActiveQr();
  });

  tabQrPair.addEventListener('click', () => {
    activeQrMode = 'pair';
    tabQrPair.classList.add('active');
    tabQrTab.classList.remove('active');
    renderActiveQr();
  });
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
      headers: {
        'Content-Type': 'application/json',
        'X-Pair-Key': currentPairKey
      },
      body: JSON.stringify({
        url: targetUrl,
        title: currentTab?.title || '',
        lanIp: currentLanIp || undefined,
        pairKey: currentPairKey
      })
    });

    if (res.ok) {
      const data = await res.json();
      const count = data.receiversNotified || 0;
      btnPushNow.textContent = count > 0 ? `✓ Sent to ${count} phone(s)!` : '✓ Pushed (0 paired phones)';
      setTimeout(() => {
        btnPushNow.textContent = '⚡ Push to Mobile Now';
        btnPushNow.disabled = false;
      }, 2000);
      checkServerStatus();
    } else if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      btnPushNow.textContent = '⏳ Rate Limited';
      showToast(data.message || 'Push limit reached. Please wait a minute.');
      setTimeout(() => {
        btnPushNow.textContent = '⚡ Push to Mobile Now';
        btnPushNow.disabled = false;
      }, 3500);
    } else {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
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

// Event: Copy Tab URL
btnCopyUrl.addEventListener('click', () => {
  if (currentResolvedUrl) {
    navigator.clipboard.writeText(currentResolvedUrl);
    showToast('Copied LAN URL to clipboard!');
  }
});

// Event: Copy Mobile Pairing Link
if (btnCopyPairLink) {
  btnCopyPairLink.addEventListener('click', () => {
    const pairUrl = getReceiverPairingUrl();
    navigator.clipboard.writeText(pairUrl);
    showToast('Copied Mobile Pairing Link!');
  });
}

// Event: Open Receiver in Tab
btnOpenReceiver.addEventListener('click', () => {
  const pairUrl = getReceiverPairingUrl();
  chrome.tabs.create({ url: pairUrl });
});

// Event: Regenerate Pair Key
if (btnRegenPairKey) {
  btnRegenPairKey.addEventListener('click', () => {
    const newKey = generatePairKey();
    inputPairKey.value = newKey;
    showToast('Generated new key! Click Save to apply.');
  });
}

// Event: Save Settings
btnSaveSettings.addEventListener('click', async () => {
  const rawInput = inputServerUrl.value.trim() || 'http://localhost:4567';
  const newServerUrl = rawInput.replace(/\/+$/, '');
  const newBehavior = selectClickBehavior.value;
  const newIp = selectNetworkInterface.value === 'auto' ? '' : selectNetworkInterface.value;
  const newPairKey = inputPairKey ? (inputPairKey.value.trim() || generatePairKey()) : currentPairKey;

  await chrome.storage.sync.set({
    serverUrl: newServerUrl,
    clickBehavior: newBehavior,
    manualIp: newIp,
    pairKey: newPairKey
  });

  currentServerUrl = newServerUrl;
  currentPairKey = newPairKey;
  inputServerUrl.value = newServerUrl;
  inputPairKey.value = newPairKey;
  currentLanIp = newIp || null;

  // Notify background service worker to update toolbar action click behavior
  chrome.runtime.sendMessage({ type: 'REFRESH_CLICK_BEHAVIOR' });

  showToast('Settings saved!');
  updateReceiverUrlDisplay();
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
