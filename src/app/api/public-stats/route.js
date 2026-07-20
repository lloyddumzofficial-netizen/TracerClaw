import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export const dynamic = 'force-dynamic'; // Ensures truly real-time updates on every page load
export const revalidate = 0;

const AVATAR_COUNT = 5;
const RECENT_PROFILE_LIMIT = 20;

async function getRecentAvatars() {
  const { data: profiles, error: profilesError } = await adminSupabase
    .from('profiles')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(RECENT_PROFILE_LIMIT);

  if (profilesError) {
    console.error("Failed to fetch recent profiles for avatars", profilesError);
    return [];
  }

  const avatars = [];

  for (const profile of profiles || []) {
    if (avatars.length >= AVATAR_COUNT) break;

    const { data, error } = await adminSupabase.auth.admin.getUserById(profile.id);
    if (error) {
      console.error("Failed to fetch avatar for user", profile.id, error);
      continue;
    }

    const avatarUrl = data?.user?.user_metadata?.avatar_url;
    if (avatarUrl && !avatars.includes(avatarUrl)) {
      avatars.push(avatarUrl);
    }
  }

  if (avatars.length < AVATAR_COUNT) {
    const { data: authData, error: authError } = await adminSupabase.auth.admin.listUsers({
      page: 1,
      perPage: RECENT_PROFILE_LIMIT,
    });

    if (!authError && authData?.users) {
      for (const user of authData.users) {
        if (avatars.length >= AVATAR_COUNT) break;

        const avatarUrl = user.user_metadata?.avatar_url;
        if (avatarUrl && !avatars.includes(avatarUrl)) {
          avatars.push(avatarUrl);
        }
      }
    }
  }

  return avatars;
}

export async function GET() {
  try {
    if (!adminSupabase) {
      return NextResponse.json({ success: false, error: "Server is not configured" }, { status: 500 });
    }

    const { count, error } = await adminSupabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.error("Failed to fetch user stats", error);
      return NextResponse.json({ success: false, error: "Failed to fetch user stats" }, { status: 500 });
    }

    // Show the newest signup avatars first. The old listUsers().slice(0, 5)
    // path could stay stuck on the same earliest users forever.
    const realAvatars = await getRecentAvatars();

    return NextResponse.json({
      success: true,
      totalUsers: count || 0,
      avatars: realAvatars
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: "Failed to fetch user stats" }, { status: 500 });
  }
}
