# ⚡ Qwik Mobile Preview

> Preview any `localhost` or web page from your laptop to mobile in LAN in **one click**.

Designed for developers who want instant, frictionless mobile testing without typing IP addresses, scanning QR codes repeatedly, or dealing with screen timeout.

---

## 🌟 Highlights

- **⚡ 1-Click Push**: Click the extension icon in Chrome (or hit `Cmd+Shift+Q` / `Ctrl+Shift+Q`). Your active tab appears on your phone in `< 100ms`.
- **📱 Mobile Always-Ready**:
  - **Screen Wake Lock API**: Keeps your mobile screen awake on your desk stand — no dimming or auto-locking while you code.
  - **Persistent WebSocket**: Auto-reconnects with exponential backoff and catch-up sync.
  - **Live Viewport Shell**: Loads pushed links instantly with collapsible floating controls (Reload, Open Native Tab, History).
- **🐳 Dockerized Relay Hub**: Runs seamlessly in your local network with a lightweight Node.js container (`~60MB`).
- **🔍 QR Code Fallback**: Offline-generated QR codes available anytime right in the extension popup.
- **🔄 Localhost to LAN IP Auto-Rewrite**: Automatically maps `http://localhost:3000` to `http://192.168.x.x:3000`.

---

## 🚀 Quick Start

### Step 1: Start the Docker Relay Server

**Option A — Using Pre-built Docker Hub Image (Instant on Homelab / Laptop):**
```bash
docker run -d \
  --name qwik-mobile-preview \
  --restart unless-stopped \
  -p 4567:4567 \
  iamjothees/qwik-mobile-preview:latest
```

**Option B — Using Docker Compose from Source:**
```bash
docker compose up -d
```

Verify it is running:
- Open `http://localhost:4567` in your laptop browser.
- The server will display your LAN IP (e.g. `http://192.168.29.10:4567`).

---

### Step 2: Open Mobile Receiver (Once)

On your mobile phone (connected to the same Wi-Fi / LAN):
1. Open Safari (iOS) or Chrome (Android) and navigate to:
   ```
   http://<YOUR_LAPTOP_LAN_IP>:4567
   ```
   *(e.g., `http://192.168.29.10:4567`)*
2. Tap **"⚡ Enable Stay-Awake (Desk Mode)"** to keep the screen active.
3. *(Optional)* Tap **"Add to Home Screen"** to launch it as a full-screen standalone PWA without browser address bars!
4. Place the phone on your desk stand.

---

### Step 3: Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **"Developer mode"** (top right toggle).
3. Click **"Load unpacked"** (top left).
4. Select the `extension/` folder inside this repository:
   ```
   /Users/jotheeswaran/workspace/qwik-utils/qwik-mobile-preview/extension
   ```
5. Pin the **Qwik Mobile Preview** icon to your Chrome toolbar.

---

### Step 4: Preview in 1 Click!

- While browsing any local app on your laptop (`http://localhost:3000`, `http://localhost:5173`, etc.):
- **Click the extension icon** in your toolbar (or press `Cmd+Shift+Q` on Mac, `Ctrl+Shift+Q` on Windows/Linux).
- The extension icon will flash a green **`✓`** badge.
- **Your phone screen instantly updates to the exact page and URL!**

---

## 🛠 Advanced Controls & Settings

- **Right-Click Extension Icon**:
  - `⚡ Push this tab to mobile`: Manually push.
  - `🔍 QR Code & Settings`: Opens the dashboard to view the QR code, change LAN interfaces, or switch click behavior.
  - `📱 Open Mobile Receiver in Browser`: Quick link to open the receiver.
- **Custom Port or IP Override**:
  - If you are using custom subnets or Docker host overrides, specify `HOST_IP=192.168.x.x` in your environment or `docker-compose.yml`.

---

## 📁 Repository Structure

```
qwik-mobile-preview/
├── docker/
│   └── Dockerfile              # Minimal Node 22 Alpine image
├── docker-compose.yml          # Container configuration (port 4567)
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── server.js           # HTTP + WebSocket relay & proxy
│   │   ├── network.js          # Host LAN IP auto-detection
│   │   └── public/             # Mobile Receiver Web App (PWA + WakeLock)
├── extension/                  # Manifest V3 Chrome Extension
│   ├── manifest.json
│   ├── service-worker.js       # 1-click action listener & push dispatcher
│   ├── popup/                  # Dashboard & offline QR code generator
│   ├── lib/qrcode.min.js       # Bundled offline QR code library
│   └── icons/                  # 16, 32, 48, 128px icons
└── README.md
```
