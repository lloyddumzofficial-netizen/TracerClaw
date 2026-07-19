import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedStats = null;

export async function GET() {
  try {
    if (cachedStats && Date.now() < cachedStats.expiresAt) {
      return NextResponse.json(cachedStats.payload);
    }

    const { count, error } = await adminSupabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.error("Failed to fetch user stats", error);
      return NextResponse.json({ success: false, error: "Failed to fetch user stats" }, { status: 500 });
    }

    const { data: reviewedProjects, error: avatarError } = await adminSupabase
      .from('projects')
      .select('reviewer_avatar')
      .not('reviewer_avatar', 'is', null)
      .gte('rating', 4)
      .order('created_at', { ascending: false })
      .limit(20);

    if (avatarError) {
      console.warn("Failed to fetch public avatar stats", avatarError);
    }

    const realAvatars = [...new Set((reviewedProjects || []).map((row) => row.reviewer_avatar).filter(Boolean))].slice(0, 5);

    const payload = {
      success: true,
      totalUsers: count || 0,
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
