import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { DEFAULT_MAX_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedStorageHosts, isOwnedStorageUrl, validateUrlForSSRF } from "@/lib/ssrf";
import { fal } from "@fal-ai/client";

export const runtime = 'nodejs';
export const maxDuration = 120; // Enough time for BG removal + R2 upload

export async function POST(request) {
  let userId = null;
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
    // ─────────────────────────────────────────────────────────────────────────────

    const { projectId, keepOriginal } = await request.json();

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
    const { data: profile, error: profileErr } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "Could not fetch profile" }, { status: 403 });
    }

    if (profile.credits <= 0) {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }

    // Deduct immediately using optimistic lock
    const { error: deductErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', user.id)
      .eq('credits', profile.credits)
      .select();

    if (deductErr || !updatedData || updatedData.length === 0) {
      return NextResponse.json({ error: "Conflict updating credits. Please try again." }, { status: 409 });
    }

    // Track that credits were deducted so we can refund on failure
    creditDeducted = true;

    // Log the transaction
    await adminSupabase.from('credit_logs').insert({
      user_id: user.id,
      action: 'Background Removal',
      amount: -1
    });

    await adminSupabase
      .from('projects')
      .update({ credit_deducted: true })
      .eq('id', projectId)
      .eq('user_id', user.id);

    // ============================================================
    // PROCESS WITH FAL.AI (BiRefNet)
    // ============================================================
    console.log(`[Remove BG] Sending to Fal.ai BiRefNet for project ${projectId}...`);
    
    const result = await fal.subscribe("fal-ai/birefnet", {
      input: {
        image_url: project.original_image_url
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs.map((log) => console.log(log.message));
        }
      },
    });

    console.log("[fal.ai RAW Response]:", JSON.stringify(result, null, 2));

    const transparentImageUrl = result?.data?.image?.url || result?.image?.url || result?.data?.image_url;

    if (!transparentImageUrl) {
      throw new Error("Fal.ai returned no image URL. Response: " + JSON.stringify(result));
    }

    console.log("[Remove BG] Received transparent image from Fal:", transparentImageUrl);

    // ============================================================
    // DOWNLOAD FROM FAL AND UPLOAD TO R2 (Permanent Storage)
    // ============================================================
    console.log("[Remove BG] Downloading from Fal to upload to R2...");
    const { response: imageResponse, buffer } = await fetchWithSSRFProtection(transparentImageUrl, {
      allowedHosts: [], // Trusted API response, allow any public host
      maxBytes: DEFAULT_MAX_IMAGE_BYTES,
      allowedContentTypes: ['image/'],
    });
    if (!imageResponse.ok) throw new Error("Failed to fetch image from Fal.ai");

    const fileName = `projects/${projectId}/bg-removed-${Date.now()}.png`;
    const r2Url = await uploadToR2(buffer, fileName, "image/png");

    console.log("[Remove BG] Saved to R2:", r2Url);

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
        await adminSupabase.rpc('increment_credits', { user_id: userId, amount: 1 });
        await adminSupabase.from('credit_logs').insert({ user_id: userId, action: 'Refund (Error)', amount: 1 });
        console.log(`[Remove BG] Refunded 1 credit to user ${userId} due to processing error.`);
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
