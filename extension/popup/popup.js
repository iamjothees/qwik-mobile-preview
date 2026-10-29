// Elements
const serverStatusPill = document.getElementById('server-status-pill');
const serverStatusText = document.getElementById('server-status-text');
const qrCanvas = document.getElementById('qr-canvas');

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
let currentServerUrl = 'http://localhost:4567';
let currentPairKey = '';
let currentLanIp = null;
let serverPort = 4567;

// Helper: Generate Random 8-character Pairing Key
function generatePairKey() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = 'qwik-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function isInternalBridgeIp(ip) {
  if (!ip) return true;
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('192.168.65.') || ip.startsWith('192.168.64.')) return true; // Docker Desktop Mac VM bridge
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // Docker container bridges
  if (ip.startsWith('10.0.2.')) return true; // VirtualBox NAT
  return false;
}

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkServerStatus();
});

// Load Settings from chrome.storage
async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    serverUrl: 'http://localhost:4567',
    clickBehavior: 'one_click',
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

// Query Relay Server Status & Discovered Network IP
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

    // Update real physical LAN IP (excluding virtual bridges)
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

    // Ensure detected primary physical LAN IP is in dropdown
    if (data.primaryIp && !isInternalBridgeIp(data.primaryIp)) {
      const exists = Array.from(selectNetworkInterface.options).some(o => o.value === data.primaryIp);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = data.primaryIp;
        opt.textContent = `${data.primaryIp} (Primary Wi-Fi / LAN)`;
        selectNetworkInterface.appendChild(opt);
      }
    }

    if (currentLanIp) {
      selectNetworkInterface.value = currentLanIp;
    }
  } catch {}
}

// Compute the Mobile Receiver Pairing URL
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

// Update Pairing Link Display & Render QR Code
function updateReceiverUrlDisplay(serverIp = null) {
  const pairUrl = getReceiverPairingUrl(serverIp);
  if (receiverUrlCode) receiverUrlCode.value = pairUrl;
  if (displayPairKey) displayPairKey.textContent = currentPairKey;
  renderQrCode(pairUrl);
}

// Generate QR Code with QRCode library
function renderQrCode(text) {
  if (typeof QRCode !== 'undefined' && qrCanvas) {
    QRCode.toCanvas(qrCanvas, text, {
      width: 150,
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
    currentPairKey = newKey;
    displayPairKey.textContent = newKey;
    updateReceiverUrlDisplay();
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
});

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
}
