// Default relay server configuration
const DEFAULT_SERVER_URL = 'http://localhost:4567';

// Initialize context menu items
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'push_current_tab',
    title: '⚡ Push this tab to mobile',
    contexts: ['action', 'page']
  });

  chrome.contextMenus.create({
    id: 'open_dashboard',
    title: '🔍 QR Code & Settings',
    contexts: ['action']
  });

  chrome.contextMenus.create({
    id: 'open_receiver_page',
    title: '📱 Open Mobile Receiver in Browser',
    contexts: ['action']
  });

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

// 1-Click Action Handler (Fires when clickBehavior === 'one_click')
chrome.action.onClicked.addListener(async (tab) => {
  await pushTabToMobile(tab);
});

// Context Menu Action Handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'push_current_tab' && tab) {
    await pushTabToMobile(tab);
  } else if (info.menuItemId === 'open_dashboard') {
    chrome.runtime.openOptionsPage();
  } else if (info.menuItemId === 'open_receiver_page') {
    const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL });
    try {
      const res = await fetch(`${serverUrl}/api/ip`);
      const data = await res.json();
      const ip = data.primaryIp || 'localhost';
      chrome.tabs.create({ url: `http://${ip}:${data.serverPort || 4567}` });
    } catch {
      chrome.tabs.create({ url: `${serverUrl}` });
    }
  }
});

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

  const { serverUrl, manualIp } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER_URL,
    manualIp: ''
  });

  showBadge('...', '#3b82f6', null, tab.id);

  try {
    // 1. Resolve LAN IP for localhost conversion:
    // If user set an explicit manual IP, use it.
    // If relay server runs on localhost, query server for local interface IP.
    // If relay server runs on a remote homelab machine, leave undefined:
    // the homelab server automatically detects the laptop's IP from the incoming request socket!
    let lanIp = manualIp;
    const isLocalServer = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');
    if (!lanIp && isLocalServer) {
      try {
        const ipRes = await fetch(`${serverUrl}/api/ip`, { signal: AbortSignal.timeout(2000) });
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          lanIp = ipData.primaryIp;
        }
      } catch (e) {
        console.warn('[QwikPreview] Could not fetch LAN IP from server:', e);
      }
    }

    // 2. Dispatch push to server
    const pushRes = await fetch(`${serverUrl}/api/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: tab.url,
        title: tab.title || '',
        lanIp: lanIp || undefined,
        source: 'extension'
      }),
      signal: AbortSignal.timeout(3000)
    });

    if (!pushRes.ok) {
      throw new Error(`Server returned HTTP ${pushRes.status}`);
    }

    const result = await pushRes.json();
    const count = result.receiversNotified || 0;

    // Visual confirmation badge
    showBadge('✓', '#10b981', 2500, tab.id);

    const message = count > 0
      ? `Sent to ${count} active mobile screen(s):\n${result.pushedUrl}`
      : `Queued on server:\n${result.pushedUrl}`;

    notify('⚡ Preview Pushed to Mobile', message);

  } catch (err) {
    console.error('[QwikPreview] Push failed:', err);
    showBadge('!', '#ef4444', 3500, tab.id);
    notify('Push Failed', `Could not reach relay server at ${serverUrl}. Is Docker running?`);
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
