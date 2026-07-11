import { NextResponse } from 'next/server';

// ─── Simple In-Memory Rate Limiter ────────────────────────────────────────────
// Works per-instance on Vercel (good enough for abuse prevention on serverless).
// For multi-region / high-traffic, replace with Upstash Redis rate limiting.

const rateLimitMap = new Map();

/**
 * Rate limit config per route prefix.
 * window: time window in ms
 * max: max requests per window per IP
 */
const RATE_LIMITS = {
  '/api/trace':         { window: 60_000, max: 10  }, // 10 traces per minute
  '/api/upload':        { window: 60_000, max: 20  }, // 20 uploads per minute
  '/api/upload-mobile': { window: 60_000, max: 10  }, // 10 mobile uploads per minute
  '/api/crop':          { window: 60_000, max: 30  }, // 30 crops per minute
  '/api/refund':        { window: 60_000, max: 5   }, // 5 refund attempts per minute
  '/api/proxy':         { window: 60_000, max: 60  }, // 60 proxy requests per minute
};

function getRateLimit(pathname) {
  for (const [prefix, config] of Object.entries(RATE_LIMITS)) {
    if (pathname.startsWith(prefix)) return config;
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

function checkRateLimit(key, window, max) {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetAt) {
    // First request or window expired — start fresh
    rateLimitMap.set(key, { count: 1, resetAt: now + window });
    return { allowed: true, remaining: max - 1 };
  }

  if (record.count >= max) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count++;
  return { allowed: true, remaining: max - record.count };
}

// Cleanup stale entries periodically to avoid memory leaks
// Only runs when a request comes in, not on a timer
let lastCleanup = Date.now();
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60_000) return; // cleanup every 5 minutes max
  lastCleanup = now;
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) rateLimitMap.delete(key);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
export function middleware(request) {
  const { pathname } = request.nextUrl;
  const config = getRateLimit(pathname);

  if (!config) return NextResponse.next(); // No limit for this route

  maybeCleanup();

  const ip = getClientIP(request);
  const key = `${ip}:${pathname.split('/').slice(0, 4).join('/')}`; // group by route
  const { allowed, remaining, resetAt } = checkRateLimit(key, config.window, config.max);

  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    console.warn(`[Rate Limit] Blocked ${ip} on ${pathname}. Retry after ${retryAfter}s`);
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(config.max),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(config.max));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  return response;
}

export const config = {
  matcher: [
    '/api/trace/:path*',
    '/api/upload/:path*',
    '/api/upload-mobile/:path*',
    '/api/crop/:path*',
    '/api/refund/:path*',
    '/api/proxy/:path*',
  ],
};
