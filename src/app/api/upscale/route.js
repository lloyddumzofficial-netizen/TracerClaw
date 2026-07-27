import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { uploadToR2 } from "@/lib/cloudflare";
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
export const maxDuration = 120;

export async function POST(request) {
  let userId;
  let creditDeducted = false;
  try {
    // Auth
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

    logger.info("[API Upscale] Using fal-ai/aura-sr", { finalImageUrl });

    const result = await fal.subscribe("fal-ai/aura-sr", {
      input: {
        image_url: finalImageUrl
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs.map((log) => log.message).forEach((message) => logger.debug("[API Upscale] Provider log", { message }));
        }
      },
    });

    if (!result || !result.data || !result.data.image || !result.data.image.url) {
      throw new Error("Upscaler failed to return a valid image URL.");
    }

    const providerUpscaledUrl = result.data.image.url;
    const { response: upscaledResponse, buffer: upscaledBuffer, finalUrl } = await fetchWithSSRFProtection(providerUpscaledUrl, {
      allowedHosts: getAllowedProviderHosts(),
      maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
      allowedContentTypes: ['image/', 'application/octet-stream'],
      timeoutMs: 60_000,
    });

    if (!upscaledResponse.ok) {
      throw new Error("Failed to download upscaled image from provider.");
    }

    const contentType = upscaledResponse.headers.get('content-type')?.split(';')[0] || result.data.image.content_type || "image/png";
    const providerExt = new URL(finalUrl).pathname.split('.').pop() || "png";
    const ext = providerExt.length <= 4 && !providerExt.includes("?") ? providerExt : "png";
    const upscaledUrl = await uploadToR2(
      upscaledBuffer,
      `users/${userId}/upscaled_${Date.now()}.${ext}`,
      contentType
    );

    // Save to projects table (history)
    const { error: insertErr } = await adminSupabase
      .from('projects')
      .insert({
        user_id: userId,
        name: "AuraSR Upscale 4K",
        trace_type: "upscale",
        original_image_url: finalImageUrl,
        generated_image_url: upscaledUrl,
        credit_deducted: true,
        refunded: false
      });

    if (insertErr) {
      console.error("Failed to save to history:", insertErr);
    }

    return NextResponse.json({ success: true, upscaledUrl });

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
