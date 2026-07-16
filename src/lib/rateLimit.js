import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const MEMORY_LIMITS = new Map();
let lastCleanup = Date.now();
let redisClient;
const upstashLimiters = new Map();

function getRedisClient() {
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

export async function enforceRateLimit({ namespace, identifier, max, window = "60 s", windowMs = 60_000 }) {
  const safeIdentifier = identifier || "anonymous";
  const limiter = getUpstashLimiter({ namespace, max, window });

  const result = limiter
    ? await limiter.limit(safeIdentifier)
    : checkMemoryLimit({ key: `${namespace}:${safeIdentifier}`, max, windowMs });

  if (!result.success) {
    return {
      success: false,
      response: rateLimitResponse({ max, remaining: result.remaining, reset: result.reset }),
    };
  }

  return {
    success: true,
    headers: {
      "X-RateLimit-Limit": String(max),
      "X-RateLimit-Remaining": String(result.remaining),
    },
  };
}

export function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
