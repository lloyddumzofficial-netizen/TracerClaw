import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, validateUrlForSSRF } from "@/lib/ssrf";
import { fal } from "@fal-ai/client";
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const maxDuration = 120; // Enough time for BG removal + R2 upload

export async function POST(request) {
  let userId = null;
  // Declared at function scope, like /api/trace and /api/trace-step3 do. This
  // used to be destructured with const inside the try block, so every reference
  // to it in the catch threw a ReferenceError — which the inner try/catch
  // swallowed, meaning the refund RPC was never reached and a failed removal
  // charged the user a claw that was never returned.
  let projectId;
  let creditDeducted = false;
  try {
    // ─── Auth: verify caller identity server-side ─────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 });
    }
    userId = user.id;

    // Paid fal.ai call — this route had no rate limit at all, and the IP
    // limiter it implicitly relied on (src/utils/proxy.js) never loads.
    const rateLimit = await enforceRateLimit({
      namespace: "api:remove-bg:user",
      identifier: userId,
      max: 6,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;
    // ─────────────────────────────────────────────────────────────────────────────

    const body = await request.json();
    projectId = body.projectId;
    const { keepOriginal } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Fetch project AND verify ownership
    const { data: project, error: projError } = await adminSupabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });
    }

    if (!project.original_image_url) {
      return NextResponse.json({ error: "No image found to process" }, { status: 400 });
    }

    if (!isOwnedStorageUrl(project.original_image_url, { userId: user.id, projectId }) || !(await validateUrlForSSRF(project.original_image_url, { allowedHosts: getAllowedStorageHosts() }))) {
      return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
    }

    // ─── Fix #1: Re-processing guard ─────────────────────────────────────────
    // If BG has already been removed, block the request. Do NOT charge again.
    if (keepOriginal && project.generated_image_url) {
      return NextResponse.json({ error: "ALREADY_PROCESSED" }, { status: 409 });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ============================================================
    // ATOMIC CREDIT DEDUCTION
    // ============================================================
    const { data: claimRows, error: claimErr } = await adminSupabase
      .rpc('claim_project_credit', {
        target_user_id: user.id,
        target_project_id: projectId,
        charge_action: 'Background Removal',
        charge_amount: 1,
      });
    if (claimErr) {
      console.error('[Remove BG] Claim RPC error:', claimErr);
      return NextResponse.json({ error: "Billing error. Please try again." }, { status: 500 });
    }
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (claim?.status === 'insufficient_credits') {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }
    if (claim?.status !== 'charged') {
      return NextResponse.json({ error: "Billing error. Please try again." }, { status: 500 });
    }
    creditDeducted = true;

    // ============================================================
    // PROCESS WITH FAL.AI (BiRefNet)
    // ============================================================
    logger.info("[Remove BG] Sending to Fal.ai BiRefNet", { projectId });
    
    const result = await fal.subscribe("fal-ai/birefnet", {
      input: {
        image_url: project.original_image_url
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs.map((log) => logger.debug("[Remove BG] Provider log", { message: log.message }));
        }
      },
    });

    logger.debug("[fal.ai RAW Response]", result);

    const transparentImageUrl = result?.data?.image?.url || result?.image?.url || result?.data?.image_url;

    if (!transparentImageUrl) {
      throw new Error("Fal.ai returned no image URL. Response: " + JSON.stringify(result));
    }

    logger.debug("[Remove BG] Received transparent image from Fal", { transparentImageUrl });

    // ============================================================
    // DOWNLOAD FROM FAL AND UPLOAD TO R2 (Permanent Storage)
    // ============================================================
    logger.debug("[Remove BG] Downloading from Fal to upload to R2");
    const { response: imageResponse, buffer } = await fetchWithSSRFProtection(transparentImageUrl, {
      allowedHosts: getAllowedProviderHosts(),
      maxBytes: DEFAULT_MAX_IMAGE_BYTES,
      allowedContentTypes: ['image/'],
    });
    if (!imageResponse.ok) throw new Error("Failed to fetch image from Fal.ai");

    const fileName = `projects/${projectId}/bg-removed-${Date.now()}.png`;
    const r2Url = await uploadToR2(buffer, fileName, "image/png");

    logger.info("[Remove BG] Saved to R2", { r2Url });

    // ============================================================
    // UPDATE PROJECT IN SUPABASE
    // ============================================================
    const updatePayload = keepOriginal 
      ? { 
          generated_image_url: r2Url, 
          upscaled_image_url: null, 
          svg_url: null,
          zip_url: null,
          zip_signature: null,
          zip_generated_at: null
        }
      : { 
          original_image_url: r2Url, 
          generated_image_url: null, 
          upscaled_image_url: null, 
          svg_url: null,
          zip_url: null,
          zip_signature: null,
          zip_generated_at: null
        };

    const { error: updateError } = await adminSupabase
      .from('projects')
      .update(updatePayload)
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (updateError) {
      throw new Error("Failed to update project with new image URL");
    }

    return NextResponse.json({ 
      success: true, 
      transparent_image_url: r2Url, 
      original_image_url: keepOriginal ? project.original_image_url : r2Url 
    });

  } catch (error) {
    console.error("[Remove BG] Error:", error);

    // ─── CREDIT REFUND on failure ────────────────────────────────────────────
    // If credit was already deducted but AI/R2/DB failed, refund it.
    if (creditDeducted && userId) {
      try {
        const { data: refundRows, error: refundRpcErr } = await adminSupabase
          .rpc('refund_project_credit', {
            target_user_id: userId,
            target_project_id: projectId,
            refund_action: 'Refund (Error)',
            failed_step_value: 'remove-bg',
            mark_generated_refunded: false,
          });
        const refund = Array.isArray(refundRows) ? refundRows[0] : refundRows;
        if (!refundRpcErr && refund?.status === 'refunded') {
          logger.info("[Remove BG] Refunded credit after processing error", { userId });
        } else {
          console.error(`[Remove BG] CRITICAL: refund_project_credit failed for user ${userId} — left unrefunded for retry.`, refundRpcErr || refund);
        }
      } catch (refundErr) {
        // Non-fatal: log but don't block the error response
        console.error('[Remove BG] CRITICAL: Failed to refund credit:', refundErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ─── Fix #2: Never expose raw internal error messages to the client ─────
    const safeMessage =
      error.message?.toLowerCase().includes('fal') ||
      error.message?.toLowerCase().includes('api') ||
      error.message?.toLowerCase().includes('key')
        ? 'AI processing failed. Your credit has been refunded automatically.'
        : (error.message || 'Failed to remove background');
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
