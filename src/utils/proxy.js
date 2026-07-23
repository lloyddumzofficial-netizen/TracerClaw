import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─── Rate Limit Config ────────────────────────────────────────────────────────
// Single source of truth for all route limits.
// window: sliding window duration string (Upstash format)
// windowMs: same window in ms (used by in-memory fallback)
// max: max requests per window per IP
const RATE_LIMIT_CONFIG = {
  '/api/trace-step3':   { window: '60 s', windowMs: 60_000, max: 6   },
  '/api/prepare-zip':   { window: '60 s', windowMs: 60_000, max: 10  },
  '/api/save-asset':    { window: '60 s', windowMs: 60_000, max: 30  },
  '/api/upscale':       { window: '60 s', windowMs: 60_000, max: 6   },
  '/api/trace':         { window: '60 s', windowMs: 60_000, max: 10  },
  '/api/upload-mobile': { window: '60 s', windowMs: 60_000, max: 10  },
  '/api/upload':        { window: '60 s', windowMs: 60_000, max: 20  },
  '/api/crop':          { window: '60 s', windowMs: 60_000, max: 30  },
  '/api/remove-bg':     { window: '60 s', windowMs: 60_000, max: 10  },
  '/api/refund':        { window: '60 s', windowMs: 60_000, max: 5   },
  '/api/proxy':         { window: '60 s', windowMs: 60_000, max: 120 },
};

// ─── In-Memory Fallback ───────────────────────────────────────────────────────
// Used when UPSTASH_REDIS_REST_URL is not set (local dev, or Upstash not yet configured).
// NOTE: This is per-instance only — not suitable for production multi-region.
const rateLimitMap = new Map();
let lastCleanup = Date.now();

function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60_000) return;
  lastCleanup = now;
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) rateLimitMap.delete(key);
  }
}

function checkInMemoryRateLimit(key, windowMs, max) {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }
  if (record.count >= max) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }
  record.count++;
  return { allowed: true, remaining: max - record.count, resetAt: record.resetAt };
}

// ─── Upstash Redis Limiters (lazy init, cached per instance) ─────────────────
// Uses sliding window algorithm — more accurate than fixed window under bursts.
// Falls back to null if env vars are absent (in-memory takes over).
let _upstashLimiters = undefined; // undefined = not yet checked

function getUpstashLimiters() {
  if (_upstashLimiters !== undefined) return _upstashLimiters;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('[Rate Limit] UPSTASH_REDIS_REST_URL not set — using in-memory fallback (not suitable for production multi-region).');
    _upstashLimiters = null;
    return null;
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  _upstashLimiters = {};
  for (const [prefix, cfg] of Object.entries(RATE_LIMIT_CONFIG)) {
    _upstashLimiters[prefix] = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.max, cfg.window),
      prefix: `rl${prefix.replace(/\//g, ':')}`, // e.g. rl:api:trace
    });
  }

  console.log('[Rate Limit] Upstash Redis distributed rate limiting active.');
  return _upstashLimiters;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRoutePrefix(pathname) {
  for (const prefix of Object.keys(RATE_LIMIT_CONFIG).sort((a, b) => b.length - a.length)) {
    if (pathname.startsWith(prefix)) return prefix;
  }
  return null;
}

function getClientIP(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export async function proxy(request) {
  const url = request.nextUrl;
  const host = request.headers.get('host');

  // ─── Domain Redirect ────────────────────────────────────────────────────────
  // Redirect anyone using the old vercel.app domain to the new custom domain
  if (host === 'desaynclaw.vercel.app') {
    return NextResponse.redirect(`https://desaynclaw.com${url.pathname}${url.search}`, 301);
  }

  const { pathname } = url;
  const routePrefix = getRoutePrefix(pathname);

  if (!routePrefix) return NextResponse.next(); // Route not rate-limited

  const ip = getClientIP(request);
  const cfg = RATE_LIMIT_CONFIG[routePrefix];
  const limiters = getUpstashLimiters();

  if (limiters) {
    // ── Distributed Upstash Redis rate limiting ────────────────────────────
    const limiter = limiters[routePrefix];
    const { success, remaining, reset } = await limiter.limit(ip);

    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      console.warn(`[Rate Limit/Upstash] Blocked ${ip} on ${pathname}. Retry after ${retryAfter}s`);
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(cfg.max),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(cfg.max));
    response.headers.set('X-RateLimit-Remaining', String(remaining));
    return response;
  }

  // ── In-memory fallback ─────────────────────────────────────────────────────
  maybeCleanup();
  const key = `${ip}:${routePrefix}`;
  const { allowed, remaining, resetAt } = checkInMemoryRateLimit(key, cfg.windowMs, cfg.max);

  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    console.warn(`[Rate Limit/Memory] Blocked ${ip} on ${pathname}. Retry after ${retryAfter}s`);
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(cfg.max),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(cfg.max));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
