import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export const dynamic = 'force-dynamic'; // Ensures truly real-time updates on every page load

export async function GET() {
  try {
    // Fetch users using the admin SDK
    const { data, error } = await adminSupabase.auth.admin.listUsers({
      page: 1,
      perPage: 500 // Fetch a large batch to ensure we find real avatars
    });

    if (error) {
      console.error("Failed to fetch user stats", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Extract real avatars or generate initials for all users
    let avatars = data.users
      .map(u => {
        const meta = u.user_metadata || {};
        let pic = meta.avatar_url || meta.picture;
        if (!pic) {
          // If no Google avatar, generate a real initial avatar based on their name or email
          const name = meta.name || meta.full_name || u.email || "U";
          pic = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=150`;
        }
        return pic;
      })
      .reverse() // Get the most recently active/created users
      .slice(0, 6); // Take the latest 6 real users

    // Some Supabase versions return 'total' in data, otherwise we fallback
    const totalUsers = data.total || data.users.length;

    return NextResponse.json({
      success: true,
      totalUsers,
      avatars
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
