import os from 'node:os';

let cachedHostIp = process.env.HOST_IP || null;

/**
 * Checks if an IP is an internal loopback, link-local, or virtual container bridge
 * (e.g., Docker Desktop for Mac VM bridge 192.168.65.x, Multipass 192.168.64.x, or Docker 172.16-31.x).
 */
export function isInternalBridgeIp(ip) {
  if (!ip) return true;
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('169.254.')) return true; // Link-local
  if (ip.startsWith('192.168.65.') || ip.startsWith('192.168.64.')) return true; // Docker Desktop for Mac VM / Multipass
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // Docker bridges 172.16.x.x - 172.31.x.x
  if (ip.startsWith('10.0.2.')) return true; // VirtualBox NAT
  return false;
}

/**
 * Discovers available IPv4 network interfaces on the machine.
 * Filters out internal/loopback and common virtual bridge adapters.
 */
export function getLocalInterfaces() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Exclude docker default bridge IPs unless nothing else exists
        const isVirtual = name.startsWith('docker') ||
          name.startsWith('br-') ||
          name.startsWith('veth') ||
          isInternalBridgeIp(addr.address);
        results.push({
          interface: name,
          address: addr.address,
          isVirtual
        });
      }
    }
  }

  // Sort physical/Wi-Fi interfaces first
  results.sort((a, b) => {
    if (a.isVirtual && !b.isVirtual) return 1;
    if (!a.isVirtual && b.isVirtual) return -1;
    // Prefer Wi-Fi / en0 / eth0
    const priority = ['en0', 'wlan0', 'eth0', 'wi-fi', 'en1'];
    const pA = priority.indexOf(a.interface.toLowerCase());
    const pB = priority.indexOf(b.interface.toLowerCase());
    if (pA !== -1 && pB === -1) return -1;
    if (pA === -1 && pB !== -1) return 1;
    if (pA !== -1 && pB !== -1) return pA - pB;
    return 0;
  });

  return results;
}

/**
 * Returns the best estimated LAN IP for the host machine.
 * Can be overridden by environment variable or updated dynamically from incoming client requests.
 */
export function getPrimaryLanIp(req = null) {
  if (process.env.HOST_IP && !isInternalBridgeIp(process.env.HOST_IP)) {
    return process.env.HOST_IP;
  }

  // If a request was provided and Host header contains a LAN IP (not a domain or container bridge)
  if (req && req.headers && req.headers.host) {
    const hostWithoutPort = req.headers.host.split(':')[0];
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostWithoutPort);
    if (isIpv4 && !isInternalBridgeIp(hostWithoutPort)) {
      cachedHostIp = hostWithoutPort;
      return cachedHostIp;
    }
  }

  if (cachedHostIp && !isInternalBridgeIp(cachedHostIp)) {
    return cachedHostIp;
  }

  const list = getLocalInterfaces();
  // Filter out Docker container bridges if possible
  const nonBridge = list.filter(item => !item.isVirtual && !isInternalBridgeIp(item.address));
  if (nonBridge.length > 0) {
    return nonBridge[0].address;
  }

  return list.length > 0 ? list[0].address : '127.0.0.1';
}

/**
 * Sets or updates the detected host IP.
 */
export function setHostIp(ip) {
  if (ip && !isInternalBridgeIp(ip)) {
    cachedHostIp = ip;
  }
}
