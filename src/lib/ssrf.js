import dns from 'dns';
import { promisify } from 'util';
import net from 'net';

const lookup = promisify(dns.lookup);

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127 ||
      parts[0] === 169 ||
      parts[0] === 0
    );
  }
  if (net.isIPv6(ip)) {
    return ip.startsWith('fd') || ip.startsWith('fc') || ip.startsWith('fe80') || ip === '::1';
  }
  return false;
}

export async function validateUrlForSSRF(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    
    const { address } = await lookup(parsed.hostname);
    if (isPrivateIP(address)) {
      return false;
    }
    return true;
  } catch (err) {
    return false; // Invalid URL or DNS resolution failed
  }
}
