// Default relay server configuration
const DEFAULT_SERVER_URL = 'http://localhost:4567';

function generatePairKey() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = 'qwik-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Initialize context menu items & ensure pairKey exists
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: 'push_current_tab',
    title: '⚡ Push this tab to mobile',
    contexts: ['action', 'page']
  });

  chrome.contextMenus.create({
    id: 'open_dashboard',
    title: '📱 Mobile Preview Dashboard',
    contexts: ['action']
  });

  chrome.contextMenus.create({
    id: 'open_receiver_page',
    title: '📱 Open Mobile Receiver in Browser',
    contexts: ['action']
  });

  // Ensure pairing key exists on install
  const { pairKey } = await chrome.storage.sync.get({ pairKey: '' });
  if (!pairKey) {
    await chrome.storage.sync.set({ pairKey: generatePairKey() });
  }

  // Apply default action behavior
  applyActionBehavior();
});

// Configure whether action click pushes directly or opens popup
async function applyActionBehavior() {
  const { clickBehavior } = await chrome.storage.sync.get({ clickBehavior: 'one_click' });
  if (clickBehavior === 'popup') {
    await chrome.action.setPopup({ popup: 'popup/popup.html' });
  } else {
    await chrome.action.setPopup({ popup: '' });
  }
}

// 1-Click Action Handler (Fires only when clickBehavior === 'one_click')
chrome.action.onClicked.addListener(async (tab) => {
  await pushTabToMobile(tab);
});

// Shortcut Hotkey Handler (Cmd+Shift+Q / Ctrl+Shift+Q)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'push_current_tab') {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs.length > 0) {
      await pushTabToMobile(tabs[0]);
    }
  }
});

// Context Menu Action Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'push_current_tab' && tab) {
    await pushTabToMobile(tab);
  } else if (info.menuItemId === 'open_dashboard') {
    if (chrome.action.openPopup) {
      chrome.action.openPopup().catch(() => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
      });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    }
  } else if (info.menuItemId === 'open_receiver_page') {
    let { serverUrl, pairKey } = await chrome.storage.sync.get({
      serverUrl: DEFAULT_SERVER_URL,
      pairKey: ''
    });
    if (!pairKey) {
      pairKey = generatePairKey();
      await chrome.storage.sync.set({ pairKey });
    }
    try {
      const res = await fetch(`${serverUrl}/api/ip`);
      const data = await res.json();
      const ip = data.primaryIp || 'localhost';
      const target = `http://${ip}:${data.serverPort || 4567}/?pair=${encodeURIComponent(pairKey)}`;
      chrome.tabs.create({ url: target });
    } catch {
      const target = `${serverUrl}/?pair=${encodeURIComponent(pairKey)}`;
      chrome.tabs.create({ url: target });
    }
  }
});

function isInternalBridgeIp(ip) {
  if (!ip) return true;
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('192.168.65.') || ip.startsWith('192.168.64.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith('10.0.2.')) return true;
  return false;
}

// Main Push Function
async function pushTabToMobile(tab) {
  if (!tab || !tab.url) {
    showBadge('!', '#ef4444', 3000, tab?.id);
    return;
  }

  // Prevent pushing internal browser scheme pages
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    showBadge('✕', '#ef4444', 2500, tab.id);
    notify('Cannot Preview Internal Page', 'Open a web page or localhost application to preview.');
    return;
  }

  let { serverUrl, manualIp, pairKey } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER_URL,
    manualIp: '',
    pairKey: ''
  });

  if (!pairKey) {
    pairKey = generatePairKey();
    await chrome.storage.sync.set({ pairKey });
  }

  const cleanServer = (serverUrl || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');

  showBadge('...', '#3b82f6', null, tab.id);

  try {
    // 1. Resolve LAN IP for localhost conversion
    let lanIp = manualIp;
    if (!lanIp || isInternalBridgeIp(lanIp)) {
      try {
        const ipRes = await fetch(`${cleanServer}/api/ip`, { signal: AbortSignal.timeout(2000) });
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          if (ipData.primaryIp && !isInternalBridgeIp(ipData.primaryIp)) {
            lanIp = ipData.primaryIp;
          }
        }
      } catch (e) {
        console.warn('[QwikPreview] Could not fetch LAN IP from server:', e);
      }

      if (!lanIp || isInternalBridgeIp(lanIp)) {
        try {
          const sHost = new URL(cleanServer).hostname;
          if (/^(\d{1,3}\.){3}\d{1,3}$/.test(sHost) && !isInternalBridgeIp(sHost)) {
            lanIp = sHost;
          }
        } catch {}
      }
    }

    // 2. Dispatch push to server with Pair Key
    const pushRes = await fetch(`${cleanServer}/api/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pair-Key': pairKey
      },
      body: JSON.stringify({
        url: tab.url,
        title: tab.title || '',
        lanIp: lanIp || undefined,
        pairKey: pairKey,
        source: 'extension'
      }),
      signal: AbortSignal.timeout(4000)
    });

    if (pushRes.status === 429) {
      showBadge('⌛', '#f59e0b', 3500, tab.id);
      notify('Push Rate Limited', 'Please wait a minute before pushing more links.');
      return;
    }

    if (!pushRes.ok) {
      const errData = await pushRes.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${pushRes.status}`);
    }

    const result = await pushRes.json();
    const count = result.receiversNotified || 0;

    // Visual confirmation badge
    showBadge('✓', '#10b981', 2500, tab.id);

    const message = count > 0
      ? `Sent to ${count} active phone(s) [${pairKey}]:\n${result.pushedUrl}`
      : `Sent to room [${pairKey}] (0 phones active):\n${result.pushedUrl}`;

    notify('⚡ Preview Pushed to Mobile', message);

  } catch (err) {
    console.error('[QwikPreview] Push failed:', err);
    showBadge('!', '#ef4444', 3500, tab.id);
    notify('Push Failed', `Could not reach relay server: ${err.message || 'Error'}`);
  }
}

// Helpers
function showBadge(text, color, durationMs = 2500, tabId = undefined) {
  const options = tabId ? { tabId, text } : { text };
  chrome.action.setBadgeText(options);
  chrome.action.setBadgeBackgroundColor({ color, ...(tabId ? { tabId } : {}) });

  if (durationMs) {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', ...(tabId ? { tabId } : {}) });
    }, durationMs);
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
    priority: 1
  });
}

// Listen for messages from popup / options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REFRESH_CLICK_BEHAVIOR') {
    applyActionBehavior();
    sendResponse({ ok: true });
  } else if (request.type === 'PUSH_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) pushTabToMobile(tab);
    });
    sendResponse({ ok: true });
  }
  return true;
});
