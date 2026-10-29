import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { getLocalInterfaces, getPrimaryLanIp, setHostIp, isInternalBridgeIp } from './network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = parseInt(process.env.PORT || '4567', 10);
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_KEY = (process.env.AUTH_KEY || '').trim();

// ==========================================
// 1. Multi-Tenant Room State Management
// ==========================================
const roomPreviews = new Map();   // pairKey -> latest preview object
const roomHistories = new Map();  // pairKey -> array of history objects (max 30)
const roomLastActive = new Map(); // pairKey -> timestamp
const MAX_ROOM_HISTORY = 30;

function sanitizePairKey(raw) {
  if (!raw || typeof raw !== 'string') return 'default';
  const trimmed = raw.trim();
  // Alphanumeric with dashes and underscores, between 3 and 48 chars
  if (!/^[a-zA-Z0-9_-]{3,48}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function getPairKeyFromReq(req, reqUrl) {
  const headerKey = req.headers['x-pair-key'] || req.headers['x-room-key'] || req.headers['x-auth-key'];
  if (headerKey) {
    const sanitized = sanitizePairKey(headerKey);
    if (sanitized) return sanitized;
  }
  if (reqUrl) {
    const qPair = reqUrl.searchParams.get('pair') || reqUrl.searchParams.get('room') || reqUrl.searchParams.get('key');
    if (qPair) {
      const sanitized = sanitizePairKey(qPair);
      if (sanitized) return sanitized;
    }
  }
  return 'default';
}

function touchRoom(pairKey) {
  roomLastActive.set(pairKey, Date.now());
}

// Clean up inactive rooms after 24 hours of inactivity
setInterval(() => {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  for (const [key, lastTime] of roomLastActive.entries()) {
    if (key === 'default') continue;
    if (now - lastTime > ONE_DAY) {
      let inUse = false;
      for (const client of wss.clients) {
        if (client.pairKey === key) {
          inUse = true;
          break;
        }
      }
      if (!inUse) {
        roomPreviews.delete(key);
        roomHistories.delete(key);
        roomLastActive.delete(key);
      }
    }
  }
}, 60 * 60 * 1000);

// ==========================================
// 2. Rate Limiting & Security Guardrails
// ==========================================
const LIMITS = {
  PUSH_PER_MINUTE: 20,       // Max 20 pushes/minute per IP
  API_PER_MINUTE: 100,       // Max 100 requests/minute per IP
  MAX_WS_PER_IP: 10,         // Max 10 simultaneous WebSockets per IP
  MAX_GLOBAL_WS: 500,        // Max 500 total active WebSockets across server
  MAX_CLIENTS_PER_ROOM: 10,  // Max 10 mobile receivers per pairing key
  MAX_BODY_SIZE_BYTES: 10240 // 10 KB body limit
};

const rateLimits = new Map(); // ip -> { pushTimes: [], apiTimes: [], wsCount: 0 }

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim().replace(/^::ffff:/, '');
  }
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return cfIp.trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function checkRateLimit(ip, type = 'api') {
  const now = Date.now();
  const windowMs = 60 * 1000;
  let record = rateLimits.get(ip);
  if (!record) {
    record = { pushTimes: [], apiTimes: [], wsCount: 0 };
    rateLimits.set(ip, record);
  }

  const times = type === 'push' ? record.pushTimes : record.apiTimes;
  const max = type === 'push' ? LIMITS.PUSH_PER_MINUTE : LIMITS.API_PER_MINUTE;

  while (times.length > 0 && times[0] < now - windowMs) {
    times.shift();
  }

  if (times.length >= max) {
    const oldest = times[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  times.push(now);
  return { allowed: true };
}

// Cleanup rate-limit map every 10 minutes
setInterval(() => {
  for (const [ip, record] of rateLimits.entries()) {
    if (record.wsCount <= 0 && record.pushTimes.length === 0 && record.apiTimes.length === 0) {
      rateLimits.delete(ip);
    }
  }
}, 10 * 60 * 1000);

// MIME type map for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

// ==========================================
// 3. HTTP Server & API Dispatch
// ==========================================
const server = http.createServer(async (req, res) => {
  const clientIp = getClientIp(req);

  // Set Security & CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Key, X-Pair-Key, X-Room-Key');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname.replace(/\/+/g, '/');

  // Track LAN IP from incoming client host headers
  getPrimaryLanIp(req);

  // Apply general API rate limiting
  if (pathname.startsWith('/api/')) {
    const apiCheck = checkRateLimit(clientIp, 'api');
    if (!apiCheck.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': apiCheck.retryAfterSec
      });
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: `API rate limit exceeded. Please retry after ${apiCheck.retryAfterSec} seconds.`,
        retryAfter: apiCheck.retryAfterSec
      }));
      return;
    }
  }

  // 1. IP & Discovery Endpoint
  if (pathname === '/api/ip' && req.method === 'GET') {
    const interfaces = getLocalInterfaces();
    const primaryIp = getPrimaryLanIp(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ primaryIp, callerIp: clientIp, interfaces, serverPort: PORT }));
    return;
  }

  // 2. Hub Status Endpoint
  if (pathname === '/api/status' && req.method === 'GET') {
    const pairKey = getPairKeyFromReq(req, reqUrl);
    const roomPreview = roomPreviews.get(pairKey) || null;
    let roomClients = 0;
    for (const client of wss.clients) {
      if (client.pairKey === pairKey && client.readyState === WebSocket.OPEN) {
        roomClients++;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      pairKey,
      roomClients,
      connectedClients: wss.clients.size,
      primaryIp: getPrimaryLanIp(req),
      callerIp: clientIp,
      serverPort: PORT,
      latestPreview: roomPreview
    }));
    return;
  }

  // 3. Latest Preview for Specific Pair Key
  if (pathname === '/api/latest' && req.method === 'GET') {
    const pairKey = getPairKeyFromReq(req, reqUrl);
    touchRoom(pairKey);
    const latest = roomPreviews.get(pairKey) || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pairKey, latest }));
    return;
  }

  // 4. History for Specific Pair Key
  if (pathname === '/api/history' && req.method === 'GET') {
    const pairKey = getPairKeyFromReq(req, reqUrl);
    touchRoom(pairKey);
    const history = roomHistories.get(pairKey) || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pairKey, history }));
    return;
  }

  // 5. Scoped Push Endpoint
  if (pathname === '/api/push' && req.method === 'POST') {
    // Check push-specific rate limit
    const pushCheck = checkRateLimit(clientIp, 'push');
    if (!pushCheck.allowed) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': pushCheck.retryAfterSec
      });
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: `Push rate limit exceeded (max ${LIMITS.PUSH_PER_MINUTE}/min). Retry in ${pushCheck.retryAfterSec}s.`,
        retryAfter: pushCheck.retryAfterSec
      }));
      return;
    }

    let body = '';
    let bodyTooLarge = false;

    req.on('data', chunk => {
      body += chunk;
      if (body.length > LIMITS.MAX_BODY_SIZE_BYTES) {
        bodyTooLarge = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (bodyTooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large: Max size is 10 KB' }));
        return;
      }

      try {
        const data = JSON.parse(body || '{}');
        const rawUrl = (data.url || '').trim();

        if (!rawUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL is required' }));
          return;
        }

        if (rawUrl.length > 2048) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL exceeds maximum length of 2048 characters' }));
          return;
        }

        // Validate protocol - strictly allow only http: and https:
        let parsedCheck;
        try {
          parsedCheck = new URL(rawUrl.includes('://') ? rawUrl : `http://${rawUrl}`);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid URL format' }));
          return;
        }

        if (parsedCheck.protocol !== 'http:' && parsedCheck.protocol !== 'https:') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Prohibited protocol. Only http:// and https:// URLs are permitted.' }));
          return;
        }

        // Resolve Pairing Key
        const rawPairKey = data.pairKey || data.room || req.headers['x-pair-key'] || reqUrl.searchParams.get('pair') || 'default';
        const pairKey = sanitizePairKey(rawPairKey);

        if (!pairKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid pairing key format. Use 3-48 alphanumeric characters, hyphens, or underscores.' }));
          return;
        }

        // Determine target LAN IP for localhost replacement
        const isCallerRealLan = clientIp &&
          !isInternalBridgeIp(clientIp) &&
          !clientIp.startsWith('127.');

        const primaryIp = getPrimaryLanIp(req);
        let lanIp = data.lanIp;
        if (!lanIp || lanIp === 'localhost' || isInternalBridgeIp(lanIp)) {
          lanIp = (!isInternalBridgeIp(primaryIp) && primaryIp !== '127.0.0.1')
            ? primaryIp
            : (isCallerRealLan ? clientIp : '127.0.0.1');
        }

        if (lanIp && !isInternalBridgeIp(lanIp)) {
          setHostIp(lanIp);
        }

        // Convert localhost/127.0.0.1 to LAN IP
        let targetUrl = parsedCheck.toString();
        if (parsedCheck.hostname === 'localhost' || parsedCheck.hostname === '127.0.0.1') {
          parsedCheck.hostname = lanIp;
          targetUrl = parsedCheck.toString();
        }

        const previewItem = {
          url: targetUrl,
          originalUrl: rawUrl,
          lanIp,
          pairKey,
          timestamp: Date.now(),
          title: String(data.title || '').slice(0, 255),
          source: data.source || 'extension'
        };

        // Save to Room State
        roomPreviews.set(pairKey, previewItem);
        let roomHist = roomHistories.get(pairKey);
        if (!roomHist) {
          roomHist = [];
          roomHistories.set(pairKey, roomHist);
        }
        roomHist.unshift(previewItem);
        if (roomHist.length > MAX_ROOM_HISTORY) {
          roomHist.pop();
        }
        touchRoom(pairKey);

        // Broadcast ONLY to connected WebSockets in this pairing room
        const broadcastPayload = JSON.stringify({
          type: 'navigate',
          data: previewItem
        });

        let activeReceivers = 0;
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN && client.pairKey === pairKey) {
            client.send(broadcastPayload);
            activeReceivers++;
          }
        }

        console.log(`[PUSH] Dispatched URL to ${activeReceivers} device(s) in room [${pairKey}]: ${targetUrl}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          pairKey,
          pushedUrl: targetUrl,
          receiversNotified: activeReceivers,
          timestamp: previewItem.timestamp
        }));
      } catch (err) {
        console.error('[PUSH ERROR]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 6. Reverse Frame Proxy: /proxy?url=http://...
  if (pathname === '/proxy' && req.method === 'GET') {
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing target url query parameter');
      return;
    }

    try {
      const targetParsed = new URL(target);
      if (targetParsed.protocol !== 'http:' && targetParsed.protocol !== 'https:') {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Forbidden protocol in proxy');
        return;
      }

      const isHttps = targetParsed.protocol === 'https:';
      const httpModule = isHttps ? await import('node:https') : http;

      const proxyReq = httpModule.request(target, {
        method: 'GET',
        headers: {
          ...req.headers,
          host: targetParsed.host,
          'cache-control': 'no-cache'
        }
      }, (proxyRes) => {
        const responseHeaders = { ...proxyRes.headers };
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['content-security-policy-report-only'];

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          delete responseHeaders['content-length'];
          let body = '';
          proxyRes.setEncoding('utf8');
          proxyRes.on('data', chunk => { body += chunk; });
          proxyRes.on('end', () => {
            const baseTag = `<base href="${target}">`;
            let modified = body;
            if (body.includes('<head>')) {
              modified = body.replace('<head>', `<head>${baseTag}`);
            } else if (body.includes('<head ')) {
              modified = body.replace(/<head[^>]*>/i, `$&${baseTag}`);
            } else {
              modified = `${baseTag}${body}`;
            }
            res.writeHead(proxyRes.statusCode || 200, responseHeaders);
            res.end(modified);
          });
        } else {
          res.writeHead(proxyRes.statusCode || 200, responseHeaders);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h3>Proxy Error: Could not reach ${target}</h3><p>${err.message}</p>`);
      });

      proxyReq.end();
      return;
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Invalid target URL: ${err.message}`);
      return;
    }
  }

  // 7. Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      };
      if (pathname === '/sw.js') {
        headers['Service-Worker-Allowed'] = '/';
      }
      res.writeHead(200, headers);
      res.end(content);
    });
  });
});

// ==========================================
// 4. WebSocket Hub with Room Scoping & Caps
// ==========================================
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const clientIp = getClientIp(req);
  const wsUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 1. Check Global Server WebSocket Cap
  if (wss.clients.size > LIMITS.MAX_GLOBAL_WS) {
    console.warn(`[WS] Connection rejected: Global server capacity reached (${LIMITS.MAX_GLOBAL_WS})`);
    ws.close(4429, 'Server capacity reached');
    return;
  }

  // 2. Check Per-IP WebSocket Cap
  let ipRecord = rateLimits.get(clientIp);
  if (!ipRecord) {
    ipRecord = { pushTimes: [], apiTimes: [], wsCount: 0 };
    rateLimits.set(clientIp, ipRecord);
  }

  if (ipRecord.wsCount >= LIMITS.MAX_WS_PER_IP) {
    console.warn(`[WS] Connection rejected: IP ${clientIp} exceeded max connections (${LIMITS.MAX_WS_PER_IP})`);
    ws.close(4429, 'Too many connections from your IP');
    return;
  }

  // 3. Resolve & Sanitize Pairing Key
  const pairKey = getPairKeyFromReq(req, wsUrl);

  // 4. Check Per-Room Device Limit
  let devicesInRoom = 0;
  for (const client of wss.clients) {
    if (client.pairKey === pairKey && client.readyState === WebSocket.OPEN) {
      devicesInRoom++;
    }
  }

  if (devicesInRoom >= LIMITS.MAX_CLIENTS_PER_ROOM) {
    console.warn(`[WS] Room [${pairKey}] reached device limit (${LIMITS.MAX_CLIENTS_PER_ROOM})`);
    ws.send(JSON.stringify({
      type: 'error',
      message: `Room device limit reached (max ${LIMITS.MAX_CLIENTS_PER_ROOM} devices per pairing key)`
    }));
    ws.close(4403, 'Room capacity reached');
    return;
  }

  // Bind WebSocket to Room & Client IP
  ws.pairKey = pairKey;
  ws.clientIp = clientIp;
  ipRecord.wsCount++;
  touchRoom(pairKey);

  console.log(`[WS] Client joined room [${pairKey}] from ${clientIp}. Total connected: ${wss.clients.size}`);

  // Send initial handshake with current state of THIS room
  const currentRoomPreview = roomPreviews.get(pairKey) || null;
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      serverTime: Date.now(),
      pairKey,
      latestPreview: currentRoomPreview,
      primaryIp: getPrimaryLanIp(req),
      serverPort: PORT
    }
  }));

  // Handle client messages (e.g. ping/pong, pair key change)
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      } else if (msg.type === 'switch_room') {
        const newKey = sanitizePairKey(msg.pairKey);
        if (newKey) {
          ws.pairKey = newKey;
          touchRoom(newKey);
          const newPreview = roomPreviews.get(newKey) || null;
          ws.send(JSON.stringify({
            type: 'init',
            data: {
              serverTime: Date.now(),
              pairKey: newKey,
              latestPreview: newPreview,
              primaryIp: getPrimaryLanIp(req),
              serverPort: PORT
            }
          }));
          console.log(`[WS] Client from ${clientIp} switched to room [${newKey}]`);
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    if (ipRecord.wsCount > 0) ipRecord.wsCount--;
    console.log(`[WS] Client disconnected from room [${ws.pairKey}]. Total connected: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.warn(`[WS] Socket error in room [${ws.pairKey}]:`, err.message);
  });
});

// Start listening
server.listen(PORT, HOST, () => {
  const lanIp = getPrimaryLanIp();
  console.log(`\n======================================================`);
  console.log(`🚀 Qwik Mobile Preview Server running (Multi-Tenant)!`);
  console.log(`📡 Local Laptop URL : http://localhost:${PORT}`);
  console.log(`📱 Mobile LAN URL   : http://${lanIp}:${PORT}`);
  console.log(`⚡ WebSocket Hub    : ws://${lanIp}:${PORT}/ws`);
  console.log(`🔒 Room Isolation   : ACTIVE (Ephemeral Channels)`);
  console.log(`🛡️ Rate Limiting    : ${LIMITS.PUSH_PER_MINUTE} pushes/min, ${LIMITS.API_PER_MINUTE} reqs/min`);
  console.log(`======================================================\n`);
});
