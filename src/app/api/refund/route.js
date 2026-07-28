import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

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

    // This endpoint mints credits, so it must not be replayable at speed.
    const rateLimit = await enforceRateLimit({
      namespace: "api:refund:user",
      identifier: user.id,
      max: 10,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    // Fetch project — use shared adminSupabase singleton (no new DB connections per request)
    const { data: proj, error: projErr } = await adminSupabase
      .from('projects')
      .select('user_id, credit_deducted, refunded, failed_at, failed_step, generated_image_url, upscaled_image_url, svg_url')
      .eq('id', projectId)
      .single();

    // If failed_at does not exist yet, this select errors and refunds fail
    // CLOSED until database/add_project_failure_tracking.sql has been run.
    // That is the safe direction, but make it diagnosable rather than a
    // mysterious "not found".
    if (projErr && /failed_at/i.test(projErr.message || '')) {
      console.error('[Refund API] Missing failed_at column — run database/add_project_failure_tracking.sql');
      return NextResponse.json({ error: "Refunds are temporarily unavailable. Please contact support." }, { status: 503 });
    }

    // Security check: only the project owner can request a refund
    if (!proj || proj.user_id !== user.id) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 403 });
    }

    if (proj.refunded) {
      return NextResponse.json({ success: true, message: "Refund already processed" });
    }

    if (!proj.credit_deducted) {
      return NextResponse.json({ error: "Project is not eligible for refund" }, { status: 409 });
    }

    // ── Positive evidence of failure is required ──────────────────────────────
    // A SUCCESSFUL run also leaves credit_deducted=true / refunded=false, so
    // those flags alone made this endpoint a "refund me but let me keep the
    // output" button. The server stamps failed_at only from its catch blocks.
    if (!proj.failed_at) {
      return NextResponse.json(
        { error: "Project is not eligible for refund" },
        { status: 409 }
      );
    }

    // ── And there must be nothing usable to keep ──────────────────────────────
    // The old code only blanked generated_image_url and left svg_url and
    // upscaled_image_url downloadable.
    const hasUsableOutput = Boolean(
      proj.svg_url ||
      proj.upscaled_image_url ||
      (proj.generated_image_url && proj.generated_image_url !== 'REFUNDED')
    );
    if (hasUsableOutput) {
      return NextResponse.json(
        { error: "This project produced output and cannot be refunded." },
        { status: 409 }
      );
    }

    // NOTE: the old credit_logs pre-check is gone on purpose. It matched ANY
    // historical -1 row for the user, was never scoped to this project and was
    // never consumed, so a single past charge satisfied it forever — it added
    // no protection. `credit_deducted` on the project row is the authoritative
    // record that this project was charged; credit_logs is a reporting ledger.

    const { data: refundRows, error: refundErr } = await adminSupabase
      .rpc('refund_project_credit', {
        target_user_id: user.id,
        target_project_id: projectId,
        refund_action: 'Refund',
        failed_step_value: proj.failed_step || 'unknown',
        mark_generated_refunded: false,
      });
    const refund = Array.isArray(refundRows) ? refundRows[0] : refundRows;
    if (refundErr) {
      throw refundErr;
    }
    if (refund?.status !== 'refunded') {
      return NextResponse.json({ error: "Project is not eligible for refund" }, { status: 409 });
    }

    logger.info("[Refund API] Refunded project", { projectId, userId: user.id });

    return NextResponse.json({ success: true, message: "Refund processed successfully" });

  } catch (error) {
    console.error(`[Refund API Error]:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
