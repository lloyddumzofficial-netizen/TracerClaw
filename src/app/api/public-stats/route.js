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

    // Sort by created_at descending — newest users first, then take the latest 6
    let avatars = [...data.users]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 6)
      .map(u => {
        const meta = u.user_metadata || {};
        let pic = meta.avatar_url || meta.picture;
        if (!pic) {
          // If no Google avatar, generate a colored initials avatar based on their name or email
          const name = meta.name || meta.full_name || u.email || "U";
          pic = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=150`;
        }
        return pic;
      });

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
