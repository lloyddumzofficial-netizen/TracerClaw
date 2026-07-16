import dns from 'dns';
import { promisify } from 'util';
import net from 'net';

const lookup = promisify(dns.lookup);

export const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const DEFAULT_MAX_UPSCALED_IMAGE_BYTES = 60 * 1024 * 1024;
export const DEFAULT_MAX_SVG_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_ZIP_BYTES = 120 * 1024 * 1024;

function configuredR2Hosts() {
  const hosts = new Set();

  if (process.env.CLOUDFLARE_PUBLIC_URL) {
    try {
      hosts.add(new URL(process.env.CLOUDFLARE_PUBLIC_URL).hostname.toLowerCase());
    } catch {}
  }

  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_BUCKET_NAME) {
    hosts.add(`${process.env.CLOUDFLARE_BUCKET_NAME}.${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`.toLowerCase());
  }

  hosts.add('pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev');
  return [...hosts];
}

export function getAllowedStorageHosts() {
  return configuredR2Hosts();
}

export function getAllowedProviderHosts() {
  return [
    'fal.media',
    'v2.fal.media',
    'v3.fal.media',
    'queue.fal.run',
    'storage.googleapis.com',
    'img.recraft.ai',
  ];
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127 ||
      parts[0] === 169 ||
      parts[0] === 0 ||
      parts[0] >= 224 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4) {
      return isPrivateIP(mappedIpv4[1]);
    }
    return (
      normalized.startsWith('fd') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fe80') ||
      normalized === '::1' ||
      normalized === '::'
    );
  }
  return false;
}

export function normalizeUserImageUrl(urlString, requestOrigin) {
  if (typeof urlString !== 'string') return null;
  const trimmed = urlString.trim();
  if (!trimmed || trimmed.length > 4096) return null;

  try {
    const base = requestOrigin || process.env.NEXT_PUBLIC_SITE_URL || 'https://localhost';
    const parsed = new URL(trimmed, base);
    if (parsed.pathname === '/api/proxy' && parsed.searchParams.get('url')) {
      return parsed.searchParams.get('url');
    }
  } catch {}

  return trimmed;
}

export function isAllowedStorageUrl(urlString, { userId, projectId } = {}) {
  try {
    const parsed = new URL(urlString);
    const allowedHosts = getAllowedStorageHosts();
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (!allowedHosts.includes(parsed.hostname.toLowerCase())) return false;

    const decodedPath = decodeURIComponent(parsed.pathname);
    if (userId && !decodedPath.startsWith(`/users/${userId}/`)) return false;
    if (projectId && !decodedPath.startsWith(`/projects/${projectId}/`)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isOwnedStorageUrl(urlString, { userId, projectId } = {}) {
  return (
    (userId && isAllowedStorageUrl(urlString, { userId })) ||
    (projectId && isAllowedStorageUrl(urlString, { projectId }))
  );
}

export async function validateUrlForSSRF(urlString, options = {}) {
  try {
    const parsed = new URL(urlString);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const allowedHosts = options.allowedHosts || getAllowedStorageHosts();
    if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
      return false;
    }

    // For strict allowlisted storage hosts, the hostname is the security boundary.
    // Avoid production false-negatives from transient DNS resolution issues while
    // still applying DNS/private-IP checks to arbitrary provider URLs.
    if (allowedHosts && allowedHosts.length > 0) {
      return true;
    }

    const addresses = await lookup(parsed.hostname, { all: true, verbatim: false });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIP(address))) {
      return false;
    }
    return true;
  } catch (err) {
    return false; // Invalid URL or DNS resolution failed
  }
}

export async function fetchWithSSRFProtection(urlString, options = {}) {
  const {
    allowedHosts = getAllowedStorageHosts(),
    maxBytes = DEFAULT_MAX_IMAGE_BYTES,
    timeoutMs = 15000,
    maxRedirects = 3,
    allowedContentTypes,
    fetchOptions = {},
  } = options;

  let currentUrl = urlString;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    if (!(await validateUrlForSSRF(currentUrl, { allowedHosts }))) {
      throw new Error('Invalid or unauthorized URL');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(currentUrl, {
        ...fetchOptions,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect missing Location header');
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength && contentLength > maxBytes) {
      throw new Error('Remote file is too large');
    }

    const contentType = response.headers.get('content-type') || '';
    if (allowedContentTypes?.length && !allowedContentTypes.some((type) => contentType.toLowerCase().startsWith(type))) {
      throw new Error('Remote file has an invalid content type');
    }

    const buffer = await responseToLimitedBuffer(response, maxBytes);
    return { response, buffer, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

export async function responseToLimitedBuffer(response, maxBytes = DEFAULT_MAX_IMAGE_BYTES) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Remote file is too large');
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      throw new Error('Remote file is too large');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
