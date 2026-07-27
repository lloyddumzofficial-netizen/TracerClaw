import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

const MAX_FEEDBACK_LENGTH = 500;
const MAX_REVIEWER_NAME_LENGTH = 60;

// feedback_text and reviewer_name are surfaced publicly by /api/reviews on the
// marketing homepage, so they get the same treatment as the project name in
// /api/upload rather than being stored raw.
function sanitizePublicText(value, maxLength) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

export async function POST(request, { params }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // This endpoint writes content that /api/reviews publishes on the public
    // homepage, so it must not be replayable at speed.
    const rateLimit = await enforceRateLimit({
      namespace: "api:project-review:user",
      identifier: user.id,
      max: 10,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const resolvedParams = await params;
    const { id: projectId } = resolvedParams;
    const body = await request.json();
    const { rating, feedback_text } = body;

    if (!projectId || rating === undefined) {
      return NextResponse.json({ error: "Missing projectId or rating" }, { status: 400 });
    }

    // rating was only checked for !== undefined, so any type or magnitude was
    // stored — which corrupts the `>= 4` testimonial filter and the admin
    // averages that read this column.
    const parsedRating = Number(rating);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return NextResponse.json({ error: "Rating must be a whole number between 1 and 5" }, { status: 400 });
    }

    const safeFeedback = sanitizePublicText(feedback_text, MAX_FEEDBACK_LENGTH);

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

    // Extract user profile info. full_name comes from the OAuth profile, i.e.
    // it is user-controlled, and it is rendered publicly — so sanitize it too.
    const rawReviewerName = user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0] || "DesaynClaw User";
    const reviewer_name = sanitizePublicText(rawReviewerName, MAX_REVIEWER_NAME_LENGTH) || "DesaynClaw User";
    const reviewer_avatar = user.user_metadata?.avatar_url || null;

    // Update the rating
    const { error: updateError } = await adminSupabase
      .from("projects")
      .update({
        rating: parsedRating,
        feedback_text: safeFeedback || null,
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
