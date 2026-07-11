import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    const adminEmail = process.env.ADMIN_EMAIL;
    if (authErr || !user || user.email !== adminEmail) {
      return NextResponse.json({ error: "Forbidden. Admin access required." }, { status: 403 });
    }

    // Fetch all payment requests (Bypasses RLS using Service Role Key)
    const { data: requests, error: reqError } = await adminSupabase
      .from('payment_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (reqError) {
      throw reqError;
    }

    // Fetch total generations (projects) count
    const { count: projCount, error: projError } = await adminSupabase
      .from('projects')
      .select('*', { count: 'exact', head: true });

    if (projError) {
      throw projError;
    }

    return NextResponse.json({
      success: true,
      requests: requests || [],
      totalProjects: projCount || 0
    });
  } catch (error) {
    console.error("Admin Dashboard Fetch Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
