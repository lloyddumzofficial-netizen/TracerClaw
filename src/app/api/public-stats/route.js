import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit, getClientIp, getRedisClient } from "@/lib/rateLimit";

export const dynamic = 'force-dynamic';

const CACHE_KEY = "public-stats:v2";
const CACHE_TTL_SECONDS = 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
let cachedStats = null;

async function getProfileCount() {
  const { count, error } = await adminSupabase
    .from('profiles')
    .select('id', { count: 'exact', head: true });

  if (error) {
    console.error("Failed to fetch user stats", error);
    throw new Error("Failed to fetch user stats");
  }

  return count || 0;
}

async function getCompletedExtractionCount() {
  const { count, error } = await adminSupabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .not('svg_url', 'is', null);

  if (error) {
    console.error("Failed to fetch completed extraction stats", error);
    throw new Error("Failed to fetch completed extraction stats");
  }

  return count || 0;
}

async function getReviewCount() {
  const { count, error } = await adminSupabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .not('rating', 'is', null);

  if (error) {
    console.error("Failed to fetch review stats", error);
    throw new Error("Failed to fetch review stats");
  }

  return count || 0;
}

async function getLatestProfileAvatars() {
  const { data, error } = await adminSupabase
    .from('profiles')
    .select('avatar_url')
    .not('avatar_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn("[Public Stats] Profile avatars unavailable; using review avatars:", error.message);
    return [];
  }

  return [...new Set((data || []).map((row) => row.avatar_url).filter(Boolean))].slice(0, 5);
}

async function getReviewAvatars() {
  const { data, error } = await adminSupabase
    .from('projects')
    .select('reviewer_avatar')
    .not('reviewer_avatar', 'is', null)
    .gte('rating', 4)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn("Failed to fetch public avatar stats", error);
    return [];
  }

  return [...new Set((data || []).map((row) => row.reviewer_avatar).filter(Boolean))].slice(0, 5);
}

async function getStatsFromRpc() {
  const { data, error } = await adminSupabase.rpc('get_public_homepage_stats');
  if (error) {
    console.warn("[Public Stats] Stats RPC unavailable; using compatibility fallback:", error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const avatars = Array.isArray(row?.avatars) ? row.avatars : [];
  return {
    success: true,
    totalUsers: Number(row?.total_users || 0),
    completedExtractions: Number(row?.completed_extractions || 0),
    reviewCount: Number(row?.review_count || 0),
    avatars: [...new Set(avatars.filter(Boolean))].slice(0, 5),
  };
}

async function readCachedStats() {
  const redis = getRedisClient();
  if (redis) {
    try {
      const payload = await redis.get(CACHE_KEY);
      if (payload) return { payload, source: "redis" };
    } catch (cacheErr) {
      console.warn("[Public Stats] Redis cache read failed:", cacheErr.message);
    }
  }

  if (cachedStats && Date.now() < cachedStats.expiresAt) {
    return { payload: cachedStats.payload, source: "memory" };
  }

  return null;
}

async function writeCachedStats(payload) {
  cachedStats = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload,
  };

  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(CACHE_KEY, payload, { ex: CACHE_TTL_SECONDS });
  } catch (cacheErr) {
    console.warn("[Public Stats] Redis cache write failed:", cacheErr.message);
  }
}

export async function GET(request) {
  try {
    // Unauthenticated. The in-memory cache below only helps a warm instance —
    // a cold or scaled-out one re-runs four count queries — so the endpoint
    // still needs a ceiling. IP is the only available key. The homepage refetches
    // on load, focus and visibilitychange, so 60/min leaves plenty of headroom.
    const rateLimit = await enforceRateLimit({
      namespace: "api:public-stats:ip",
      identifier: getClientIp(request),
      max: 60,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const cached = await readCachedStats();
    if (cached) {
      return NextResponse.json(cached.payload, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=240",
          "X-DesaynClaw-Stats-Cache": cached.source,
        },
      });
    }

    const rpcPayload = await getStatsFromRpc();
    if (rpcPayload) {
      const profileAvatars = await getLatestProfileAvatars();
      const payload = {
        ...rpcPayload,
        avatars: profileAvatars.length > 0 ? profileAvatars : rpcPayload.avatars,
      };
      await writeCachedStats(payload);
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=240",
          "X-DesaynClaw-Stats-Cache": "miss",
        },
      });
    }

    const [totalUsers, completedExtractions, reviewCount, profileAvatars, reviewAvatars] = await Promise.all([
      getProfileCount(),
      getCompletedExtractionCount(),
      getReviewCount(),
      getLatestProfileAvatars(),
      getReviewAvatars(),
    ]);

    const payload = {
      success: true,
      totalUsers,
      completedExtractions,
      reviewCount,
      avatars: profileAvatars.length > 0 ? profileAvatars : reviewAvatars
    };

    await writeCachedStats(payload);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=240",
        "X-DesaynClaw-Stats-Cache": "miss",
      },
    });
  } catch (err) {
    console.warn("[Public Stats] Falling back to unavailable stats:", err?.message || err);
    return NextResponse.json(
      { success: false, totalUsers: 0, completedExtractions: null, reviewCount: 0, avatars: [] },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-DesaynClaw-Stats-Cache": "unavailable",
        },
      },
    );
  }
}
