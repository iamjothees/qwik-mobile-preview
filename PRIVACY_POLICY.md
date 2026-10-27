# Privacy Policy for Qwik Mobile Preview

**Last Updated**: October 28, 2026

**Publisher**: Joe Codes (`iamjothees@gmail.com`)  
**Website**: [https://joecodes.in](https://joecodes.in)

---

### 1. Overview
Qwik Mobile Preview is a developer utility designed to preview local web development environments (`localhost`) on mobile devices connected to the same local area network (LAN).

Your privacy is paramount. **Qwik Mobile Preview does not collect, store, sell, or transmit any personally identifiable information, browsing history, or analytics to any third-party servers.**

---

### 2. Data Collected & Stored Locally
All extension preferences are stored strictly on your local device via Chrome's local storage APIs (`chrome.storage.sync` / `chrome.storage.local`):
- **User Settings**: Your preferred relay server URL (default `http://localhost:4567`) and any manual IP overrides.
- **Click Behavior**: Your choice between 1-click instant push or opening the popup dashboard.

This data is never sent to any external analytics, tracking, or telemetry services.

---

### 3. Network Transmission
When you explicitly click the extension action icon or use the keyboard shortcut (`Cmd+Shift+Q`):
- The extension reads the URL and title of your currently active tab.
- If the URL is `localhost` or `127.0.0.1`, it substitutes the hostname with your machine's local network IP.
- The URL is dispatched via an HTTP `POST` request **solely to your designated relay server** (such as your local container or private homelab server).
- No data is transmitted to Google, the extension author, or any third parties.

---

### 4. Third-Party Services
This extension does not utilize any third-party analytics (e.g. Google Analytics, Mixpanel), advertising networks, or external tracking scripts.

---

### 5. Data Retention & Deletion
You can clear all stored preferences at any time by uninstalling the extension or clearing extension data via `chrome://extensions`.

---

### 6. Contact
If you have any questions or concerns regarding this privacy policy, please open an issue on GitHub or contact:
- **Email**: `iamjothees@gmail.com`
- **GitHub**: [https://github.com/iamjothees/qwik-mobile-preview](https://github.com/iamjothees/qwik-mobile-preview)
