import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const MEMORY_LIMITS = new Map();
let lastCleanup = Date.now();
let redisClient;
const upstashLimiters = new Map();

export function getRedisClient() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }

  return redisClient;
}

function getUpstashLimiter({ namespace, max, window }) {
  const redis = getRedisClient();
  if (!redis) return null;

  const limiterKey = `${namespace}:${max}:${window}`;
  if (!upstashLimiters.has(limiterKey)) {
    upstashLimiters.set(
      limiterKey,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(max, window),
        prefix: `rl:${namespace}`,
      })
    );
  }

  return upstashLimiters.get(limiterKey);
}

function cleanupMemoryLimits() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60_000) return;
  lastCleanup = now;

  for (const [key, record] of MEMORY_LIMITS.entries()) {
    if (now > record.resetAt) {
      MEMORY_LIMITS.delete(key);
    }
  }
}

function checkMemoryLimit({ key, max, windowMs }) {
  cleanupMemoryLimits();

  const now = Date.now();
  const record = MEMORY_LIMITS.get(key);
  if (!record || now > record.resetAt) {
    MEMORY_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: max - 1, reset: now + windowMs };
  }

  if (record.count >= max) {
    return { success: false, remaining: 0, reset: record.resetAt };
  }

  record.count += 1;
  return { success: true, remaining: max - record.count, reset: record.resetAt };
}

function rateLimitResponse({ max, remaining, reset }) {
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(max),
        "X-RateLimit-Remaining": String(Math.max(0, remaining)),
      },
    }
  );
}

export async function enforceRateLimit({
  namespace,
  identifier,
  max,
  window = "60 s",
  windowMs = 60_000,
  // Legacy aliases for namespace/max. Defaulted rather than bare so TypeScript
  // callers are not forced to pass them — every current call site omits both.
  key = undefined,
  limit = undefined,
}) {
  const resolvedNamespace = String(namespace || key || "general").replace(/[^a-zA-Z0-9:_-]/g, "_");
  const resolvedMax = Number(max ?? limit);

  if (!Number.isFinite(resolvedMax) || resolvedMax <= 0) {
    console.warn("[Rate Limit] Invalid limit config:", { namespace, key, max, limit });
    return { success: true, headers: {} };
  }

  const safeIdentifier = String(identifier || key || "anonymous").replace(/[^a-zA-Z0-9:._@-]/g, "_");
  const limiter = getUpstashLimiter({ namespace: resolvedNamespace, max: resolvedMax, window });

  const result = limiter
    ? await limiter.limit(safeIdentifier)
    : checkMemoryLimit({ key: `${resolvedNamespace}:${safeIdentifier}`, max: resolvedMax, windowMs });

  if (!result.success) {
    return {
      success: false,
      response: rateLimitResponse({ max: resolvedMax, remaining: result.remaining, reset: result.reset }),
    };
  }

  return {
    success: true,
    headers: {
      "X-RateLimit-Limit": String(resolvedMax),
      "X-RateLimit-Remaining": String(result.remaining),
    },
  };
}

/**
 * Resolve the caller's IP for IP-keyed limits.
 *
 * Order matters. `x-forwarded-for` is client-supplied and its leftmost entry is
 * whatever the caller put there — reading that first is the classic spoofable
 * pattern. It happens to be safe on Vercel today because the edge overwrites the
 * header (verified: 65 rotating-XFF requests to a 60/min limit still produced 5
 * × 429), but that is a platform guarantee, not a property of this code. Behind
 * a different proxy, self-hosted, or if Vercel changes behaviour, both IP limits
 * would become bypassable with a single header.
 *
 * `x-vercel-forwarded-for` and `x-real-ip` are set by the platform and cannot be
 * overridden by the client, so prefer those. The original read is kept last so
 * behaviour is unchanged anywhere those headers are absent.
 */
export function getClientIp(request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
