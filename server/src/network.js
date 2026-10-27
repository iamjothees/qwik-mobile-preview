import os from 'node:os';

let cachedHostIp = process.env.HOST_IP || null;

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
        // Exclude docker default bridge IPs like 172.17.x.x unless nothing else exists
        const isVirtual = name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth');
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
  if (process.env.HOST_IP) {
    return process.env.HOST_IP;
  }

  // If a request was provided and Host header contains a LAN IP (not localhost or container IP)
  if (req && req.headers && req.headers.host) {
    const hostWithoutPort = req.headers.host.split(':')[0];
    if (
      hostWithoutPort !== 'localhost' &&
      hostWithoutPort !== '127.0.0.1' &&
      !hostWithoutPort.startsWith('172.17.') &&
      !hostWithoutPort.startsWith('172.18.')
    ) {
      cachedHostIp = hostWithoutPort;
      return cachedHostIp;
    }
  }

  if (cachedHostIp) {
    return cachedHostIp;
  }

  const list = getLocalInterfaces();
  // Filter out Docker container bridges if possible
  const nonBridge = list.filter(item => !item.isVirtual && !item.address.startsWith('172.17.') && !item.address.startsWith('172.18.'));
  if (nonBridge.length > 0) {
    return nonBridge[0].address;
  }

  return list.length > 0 ? list[0].address : '127.0.0.1';
}

/**
 * Sets or updates the detected host IP.
 */
export function setHostIp(ip) {
  if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
    cachedHostIp = ip;
  }
}
