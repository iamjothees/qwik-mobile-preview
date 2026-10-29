# Chrome Web Store Listing — Qwik Mobile Preview

> Last Updated: 2026-10-28

---

## Store Listing Metadata

**Extension Name** [REQUIRED]
```
Qwik Mobile Preview
```

**Short Description** [REQUIRED]
```
Preview any localhost tab on your mobile device in your local network in 1 click. No IP typing, no QR scanning required.
```

**Detailed Description** [REQUIRED]
```
Qwik Mobile Preview lets web developers instantly preview any localhost or active tab from their laptop directly on their mobile device in one click.

Say goodbye to manually looking up your laptop's Wi-Fi IP address, typing lengthy URLs with query params on a mobile keyboard, or repeatedly scanning camera QR codes!

⚡ KEY FEATURES
• True 1-Click Push: Click the toolbar icon (or hit Option+Shift+Q / Alt+Shift+Q) to instantly display the active tab on your mobile phone in under 50ms.
• Automatic Localhost Translation: Automatically transforms http://localhost:PORT to your machine's LAN IP (http://192.168.x.x:PORT).
• 24/7 Desk Standby Mode: Designed to pair with the companion Mobile Receiver PWA. Uses the Screen Wake Lock API and persistent WebSockets so your docked mobile screen stays awake on your desk 24/7.
• Instant QR Code Fallback: Built-in offline QR code generator in the popup dashboard when you need to preview on an unpaired device.
• Multi-Network Auto-Detection: Automatically detects your primary Wi-Fi, Ethernet, or custom Cloudflare/homelab domain.
• 100% Private & Local: All preview events and tab URLs stay strictly within your local network or private self-hosted relay hub.

🚀 HOW TO USE
1. Start the companion relay server on your laptop or homelab server (docker run -d -p 4567:4567 iamjothees/qwik-mobile-preview:latest).
2. Open the receiver web app on your phone once (e.g. http://<YOUR_LAN_IP>:4567 or your secured domain) and place it on your desk stand.
3. While developing on your laptop, click the Qwik Mobile Preview extension icon (or press Option+Shift+Q).
4. Your phone screen immediately updates to the exact page and URL!

🔒 PRIVACY & PERMISSIONS
Qwik Mobile Preview collects zero personal data, browsing history, or analytics. Your tab URL is only transmitted to your own self-hosted relay server upon an explicit user click or shortcut trigger.
```

**Category** [REQUIRED]
```
Developer Tools
```

**Single Purpose** [REQUIRED]
```
Transfers the active browser tab URL to a mobile device on the local network for instant responsive preview.
```

**Primary Language** [REQUIRED]
```
English
```

---

## Permissions Justification

| Permission | Type | Justification |
| :--- | :--- | :--- |
| `tabs` | `permissions` | Required to read the URL and title of the active tab to convert `localhost` to the laptop's LAN IP when the user clicks the push action. |
| `activeTab` | `permissions` | Grants immediate temporary access to the active tab upon clicking the extension icon or executing the shortcut. |
| `storage` | `permissions` | Used to save user preferences locally, including the relay server URL (default `http://localhost:4567`) and manual network IP overrides. |
| `notifications` | `permissions` | Displays brief desktop confirmation toasts when a link is successfully pushed to paired mobile devices. |
| `contextMenus` | `permissions` | Adds right-click options to the extension icon ("Push this tab", "QR Code & Settings", "Open Mobile Receiver"). |
| `http://*/*`, `https://*/*` | `host_permissions` | Required so the background service worker can send HTTP POST push requests to the user-configured local relay server (e.g. localhost, local LAN IPs, or private self-hosted domain). |

---

## Privacy & Data Use Disclosures

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL**:
```
https://joecodes.in/privacy/qwik-mobile-preview
```
*(Template provided in PRIVACY_POLICY.md)*

---

## Distribution

- **Visibility**: Public
- **Regions**: All regions
- **Pricing**: Free

---

## Developer Info

- **Publisher Name**: Joe Codes
- **Contact Email**: iamjothees@gmail.com
- **Homepage URL**: https://joecodes.in
- **Support URL**: https://github.com/iamjothees/qwik-mobile-preview/issues

---

## Version History

| Version | Date | Changes | Status |
| :--- | :--- | :--- | :--- |
| `1.0.0` | 2026-10-28 | Initial release with 1-click push, shortcut trigger, and offline QR code. | Ready to Submit |
