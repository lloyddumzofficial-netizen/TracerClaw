import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5 * 60 * 1000;
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

export async function GET() {
  try {
    if (cachedStats && Date.now() < cachedStats.expiresAt) {
      return NextResponse.json(cachedStats.payload);
    }

    const [totalUsers, completedExtractions, reviewCount, avatarResult] = await Promise.all([
      getProfileCount(),
      getCompletedExtractionCount(),
      getReviewCount(),
      adminSupabase
        .from('projects')
        .select('reviewer_avatar')
        .not('reviewer_avatar', 'is', null)
        .gte('rating', 4)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (avatarResult.error) {
      console.warn("Failed to fetch public avatar stats", avatarResult.error);
    }

    const realAvatars = [...new Set((avatarResult.data || []).map((row) => row.reviewer_avatar).filter(Boolean))].slice(0, 5);

    const payload = {
      success: true,
      totalUsers,
      completedExtractions,
      reviewCount,
      avatars: realAvatars
    };

    cachedStats = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    };

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ success: false, error: "Failed to fetch user stats" }, { status: 500 });
  }
}
