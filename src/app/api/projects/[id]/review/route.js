import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { adminSupabase } from "@/lib/supabase";

export async function POST(request, { params }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const { id: projectId } = resolvedParams;
    const body = await request.json();
    const { rating, feedback_text } = body;

    if (!projectId || rating === undefined) {
      return NextResponse.json({ error: "Missing projectId or rating" }, { status: 400 });
    }

    // Verify ownership
    const { data: project, error: projError } = await adminSupabase
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized to review this project" }, { status: 403 });
    }

    // Extract user profile info
    const reviewer_name = user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0] || "DesaynClaw User";
    const reviewer_avatar = user.user_metadata?.avatar_url || null;

    // Update the rating
    const { error: updateError } = await adminSupabase
      .from("projects")
      .update({ 
        rating, 
        feedback_text: feedback_text || null,
        reviewer_name,
        reviewer_avatar
      })
      .eq("id", projectId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[Review API] Error updating rating:", updateError);
      return NextResponse.json({ error: "Failed to save rating" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Review API] Internal Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
