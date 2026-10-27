import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { getLocalInterfaces, getPrimaryLanIp, setHostIp } from './network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = parseInt(process.env.PORT || '4567', 10);
const HOST = process.env.HOST || '0.0.0.0';

// In-memory state
let latestPreview = null;
const history = [];
const MAX_HISTORY = 30;

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

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Add CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname.replace(/\/+/g, '/');

  // Track LAN IP from incoming client host headers
  getPrimaryLanIp(req);

  // API Routes
  if (pathname === '/api/ip' && req.method === 'GET') {
    const interfaces = getLocalInterfaces();
    const primaryIp = getPrimaryLanIp(req);
    const callerIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ primaryIp, callerIp, interfaces, serverPort: PORT }));
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    const callerIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      connectedClients: wss.clients.size,
      primaryIp: getPrimaryLanIp(req),
      callerIp,
      serverPort: PORT,
      latestPreview
    }));
    return;
  }

  if (pathname === '/api/latest' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ latest: latestPreview }));
    return;
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ history }));
    return;
  }

  if (pathname === '/api/push' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const rawUrl = data.url;

        if (!rawUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL is required' }));
          return;
        }

        // Determine target LAN IP for localhost replacement:
        // 1. Explicit override from payload (if provided by user)
        // 2. Caller's IP (if caller is a laptop on the LAN pushing its own localhost dev server)
        // 3. Relay server's primary LAN IP (fallback when container runs on the laptop itself)
        const callerIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        const isCallerLan = callerIp &&
          callerIp !== '127.0.0.1' &&
          callerIp !== '::1' &&
          callerIp !== 'localhost' &&
          !callerIp.startsWith('172.17.') &&
          !callerIp.startsWith('172.18.');

        const lanIp = data.lanIp || (isCallerLan ? callerIp : getPrimaryLanIp(req));
        if (data.lanIp) {
          setHostIp(data.lanIp);
        }

        // Convert localhost/127.0.0.1 to LAN IP
        let targetUrl = rawUrl;
        try {
          const parsed = new URL(rawUrl);
          if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
            parsed.hostname = lanIp;
            targetUrl = parsed.toString();
          }
        } catch {
          // If URL lacks protocol, prepend http://
          try {
            const parsed = new URL(`http://${rawUrl}`);
            if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
              parsed.hostname = lanIp;
              targetUrl = parsed.toString();
            }
          } catch {
            targetUrl = rawUrl;
          }
        }

        const previewItem = {
          url: targetUrl,
          originalUrl: rawUrl,
          lanIp,
          timestamp: Date.now(),
          title: data.title || '',
          source: data.source || 'extension'
        };

        latestPreview = previewItem;
        history.unshift(previewItem);
        if (history.length > MAX_HISTORY) {
          history.pop();
        }

        // Broadcast to all connected WebSocket receivers
        const broadcastPayload = JSON.stringify({
          type: 'navigate',
          data: previewItem
        });

        let activeReceivers = 0;
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastPayload);
            activeReceivers++;
          }
        }

        console.log(`[PUSH] Dispatched URL to ${activeReceivers} mobile receiver(s): ${targetUrl}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
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

  // Frame Proxy Endpoint: /proxy?url=http://...
  // Strips X-Frame-Options and restrictive frame-ancestors CSP so dev sites display in iframe seamlessly
  if (pathname === '/proxy' && req.method === 'GET') {
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing target url query parameter');
      return;
    }

    try {
      const targetParsed = new URL(target);
      const isHttps = targetParsed.protocol === 'https:';
      const httpModule = isHttps ? await import('node:https') : http;

      const proxyReq = httpModule.request(target, {
        method: 'GET',
        headers: {
          ...req.headers,
          host: targetParsed.host,
          // Remove client caching headers to get fresh content
          'cache-control': 'no-cache'
        }
      }, (proxyRes) => {
        const responseHeaders = { ...proxyRes.headers };
        // Delete frame blocking headers
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['content-security-policy-report-only'];

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          delete responseHeaders['content-length']; // length changes after base injection
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

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA if not found
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

// Create WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${clientIp}. Total connected: ${wss.clients.size}`);

  // Send initial handshake with current state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      serverTime: Date.now(),
      latestPreview,
      primaryIp: getPrimaryLanIp(req),
      serverPort: PORT
    }
  }));

  // Handle client ping/pong
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch {
      // Ignore invalid JSON messages
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected. Total connected: ${wss.clients.size}`);
  });
});

// Periodic heartbeat to clean dead connections
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Start listening
server.listen(PORT, HOST, () => {
  const lanIp = getPrimaryLanIp();
  console.log(`\n======================================================`);
  console.log(`🚀 Qwik Mobile Preview Server running!`);
  console.log(`📡 Local Laptop URL : http://localhost:${PORT}`);
  console.log(`📱 Mobile LAN URL   : http://${lanIp}:${PORT}`);
  console.log(`⚡ WebSocket Hub    : ws://${lanIp}:${PORT}/ws`);
  console.log(`======================================================\n`);
});
