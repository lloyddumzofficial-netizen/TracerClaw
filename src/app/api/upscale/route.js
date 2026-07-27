import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
  fetchWithSSRFProtection,
  getAllowedProviderHosts,
  getAllowedStorageHosts,
  isOwnedStorageUrl,
  normalizeUserImageUrl,
  validateUrlForSSRF,
} from "@/lib/ssrf";
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
// 60s, not 30s: the completed result is now downloaded from the provider and
// re-uploaded to R2 before it is recorded, which needs headroom on a 4K image.
export const maxDuration = 60;

const UPSCALE_ENDPOINT = "fal-ai/aura-sr";

async function getAuthenticatedUser(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 }) };
  }

  return { user };
}

/**
 * Move a finished provider image into our own bucket.
 *
 * fal.media URLs are temporary. Storing one directly — which is what this route
 * used to do — means the user's paid 4K upscale becomes a dead link once the
 * provider expires it, with no recovery path and no refund eligibility (the
 * project counts as delivered). Every other pipeline step already persists to
 * R2; this brings the standalone upscale in line.
 *
 * Best-effort on purpose: if the copy fails we fall back to the provider URL
 * rather than failing a run the user has already paid for. /api/proxy still
 * allows provider hosts, so that fallback keeps working exactly as before.
 */
async function persistUpscaleToR2(providerUrl, projectId) {
  try {
    const { response, buffer } = await fetchWithSSRFProtection(providerUrl, {
      allowedHosts: getAllowedProviderHosts(),
      maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
      allowedContentTypes: ['image/', 'application/octet-stream'],
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);

    const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    const ext = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] || 'png');
    return await uploadToR2(buffer, `projects/${projectId}/upscaled_${Date.now()}.${ext}`, contentType);
  } catch (err) {
    console.error(`[Upscale] Could not persist result to R2 for project ${projectId}, keeping provider URL:`, err.message);
    return null;
  }
}

async function refundQueuedUpscale(projectId, userId) {
  const { data: project } = await adminSupabase
    .from('projects')
    .select('credit_deducted, refunded, generated_image_url')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (!project?.credit_deducted || project.refunded || project.generated_image_url) {
    return false;
  }

  const credited = await safeRefundCredit(userId);
  if (!credited) return false;

  await adminSupabase
    .from('projects')
    .update({
      generated_image_url: 'REFUNDED',
      refunded: true,
      failed_at: new Date().toISOString(),
      failed_step: "upscale",
    })
    .eq('id', projectId)
    .eq('user_id', userId)
    .eq('refunded', false);

  await adminSupabase.from('credit_logs').insert({
    user_id: userId,
    action: 'Refund (Upscale Error)',
    amount: 1,
  });

  return true;
}

export async function POST(request) {
  let userId;
  let creditDeducted = false;
  try {
    const { user, error: authResponse } = await getAuthenticatedUser(request);
    if (authResponse) return authResponse;
    userId = user.id;

    const rateLimit = await enforceRateLimit({
      namespace: "api:upscale:user",
      identifier: userId,
      max: 3,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const body = await request.json();
    const { imageUrl } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    const finalImageUrl = normalizeUserImageUrl(imageUrl, new URL(request.url).origin);
    if (!isOwnedStorageUrl(finalImageUrl, { userId }) || !(await validateUrlForSSRF(finalImageUrl, { allowedHosts: getAllowedStorageHosts() }))) {
      return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
    }

    // Check Credits
    const { data: profile, error: profileErr } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileErr || !profile || profile.credits <= 0) {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }

    // Deduct 1 Credit
    const { error: deductErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select();

    if (deductErr || !updatedData || updatedData.length === 0) {
      return NextResponse.json({ error: "Conflict updating credits. Please try again." }, { status: 409 });
    }
    creditDeducted = true;

    // Log the transaction
    await adminSupabase.from('credit_logs').insert({
      user_id: userId,
      action: 'AI AuraSR Upscale (4K)',
      amount: -1
    });

    // Process via fal.ai
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");

    logger.info("[API Upscale] Queueing fal-ai/aura-sr", { finalImageUrl });

    const queued = await fal.queue.submit(UPSCALE_ENDPOINT, {
      input: {
        image_url: finalImageUrl
      },
    });

    if (!queued?.request_id) {
      throw new Error("Upscaler failed to queue the request.");
    }

    const { data: project, error: insertErr } = await adminSupabase
      .from('projects')
      .insert({
        user_id: userId,
        name: "AuraSR Upscale 4K",
        trace_type: "upscale",
        original_image_url: finalImageUrl,
        ai_prompt: `fal:aura-sr:${queued.request_id}`,
        generated_image_url: null,
        credit_deducted: true,
        refunded: false
      })
      .select('id')
      .single();

    if (insertErr) {
      throw new Error("Failed to save upscale request.");
    }

    return NextResponse.json({
      success: true,
      status: queued.status || "IN_QUEUE",
      requestId: queued.request_id,
      projectId: project.id,
    });

  } catch (error) {
    console.error(`[Upscale API Error]:`, error.message);
    let didRefund = false;
    if (creditDeducted && userId) {
      // Check the result — this used to be fire-and-forget, so a failed transfer
      // silently left the user out of pocket while the message claimed a refund.
      didRefund = await safeRefundCredit(userId);
      if (didRefund) {
        await adminSupabase.from('credit_logs').insert({
          user_id: userId,
          action: 'Refund (Upscale Error)',
          amount: 1,
        });
      } else {
        console.error(`[Upscale] CRITICAL: safeRefundCredit failed for user ${userId} — left unrefunded for retry.`);
      }
    }
    const safeMessage = error.message?.includes('fal')
      ? (didRefund
          ? 'AI processing failed. Your claw has been refunded.'
          : 'AI processing failed. Please try again.')
      : (error.message || 'Failed to process upscale');
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const { user, error: authResponse } = await getAuthenticatedUser(request);
    if (authResponse) return authResponse;

    // The client polls this endpoint up to 120 times per job at 3s intervals,
    // and each call costs an auth round trip, a DB read and a provider status
    // call. Only POST was limited, so this was a free amplifier onto a paid API.
    // The ceiling is well above what the normal poll loop needs.
    const rateLimit = await enforceRateLimit({
      namespace: "api:upscale-status:user",
      identifier: user.id,
      max: 60,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId');
    const projectId = searchParams.get('projectId');
    if (!requestId || !projectId) {
      return NextResponse.json({ error: "Missing requestId or projectId" }, { status: 400 });
    }

    const { data: project, error: projectErr } = await adminSupabase
      .from('projects')
      .select('id, user_id, ai_prompt, generated_image_url, refunded')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectErr || !project || project.ai_prompt !== `fal:aura-sr:${requestId}`) {
      return NextResponse.json({ error: "Upscale request not found" }, { status: 404 });
    }

    if (project.generated_image_url && project.generated_image_url !== 'REFUNDED') {
      return NextResponse.json({ success: true, status: "COMPLETED", upscaledUrl: project.generated_image_url });
    }

    if (project.refunded || project.generated_image_url === 'REFUNDED') {
      return NextResponse.json({ error: "Upscale failed and was refunded" }, { status: 500 });
    }

    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");
    const status = await fal.queue.status(UPSCALE_ENDPOINT, { requestId, logs: true });

    if (status.status !== "COMPLETED") {
      if (status.status === "FAILED") {
        const didRefund = await refundQueuedUpscale(projectId, user.id);
        return NextResponse.json({
          error: didRefund
            ? "AI processing failed. Your claw has been refunded."
            : "AI processing failed. Please try again.",
        }, { status: 500 });
      }
      return NextResponse.json({ success: true, status: status.status, logs: status.logs || [] });
    }

    const result = await fal.queue.result(UPSCALE_ENDPOINT, { requestId });
    const providerUrl = result?.data?.image?.url;
    if (!providerUrl) {
      const didRefund = await refundQueuedUpscale(projectId, user.id);
      return NextResponse.json({
        error: didRefund
          ? "AI processing failed. Your claw has been refunded."
          : "AI processing failed. Please try again.",
      }, { status: 500 });
    }

    const upscaledUrl = (await persistUpscaleToR2(providerUrl, projectId)) || providerUrl;

    await adminSupabase
      .from('projects')
      .update({ generated_image_url: upscaledUrl })
      .eq('id', projectId)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, status: "COMPLETED", upscaledUrl });
  } catch (error) {
    logger.error("[Upscale Poll Error]", error);
    return NextResponse.json({ error: error.message || "Failed to check upscale status" }, { status: 500 });
  }
}
