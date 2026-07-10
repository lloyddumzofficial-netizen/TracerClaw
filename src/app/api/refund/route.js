import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";

export async function POST(request) {
  try {
    const { projectId } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Verify who is making the request
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Fetch project — use shared adminSupabase singleton (no new DB connections per request)
    const { data: proj } = await adminSupabase
      .from('projects')
      .select('generated_image_url, user_id')
      .eq('id', projectId)
      .single();
    
    // Security check: only the project owner can request a refund
    if (!proj || proj.user_id !== user.id) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 403 });
    }

    const { data: updatedProj } = await adminSupabase
      .from('projects')
      .update({ generated_image_url: 'REFUNDED' })
      .eq('id', projectId)
      .neq('generated_image_url', 'REFUNDED')
      .select('user_id');
      
    if (updatedProj && updatedProj.length > 0) {
      await safeRefundCredit(user.id);
    } else {
      console.log(`[Refund API] Project ${projectId} already refunded or invalid.`);
    }

    console.log(`[Refund API] ✅ Successfully processed refund for project ${projectId} (User: ${user.id})`);
    
    return NextResponse.json({ success: true, message: "Refund processed successfully" });

  } catch (error) {
    console.error(`[Refund API Error]:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
