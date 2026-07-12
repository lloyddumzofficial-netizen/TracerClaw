import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { validateUrlForSSRF } from "@/lib/ssrf";

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request) {
  let userId;
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

    const body = await request.json();
    const { imageUrl } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
    }

    if (!(await validateUrlForSSRF(imageUrl))) {
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

    // Process via fal.ai
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");

    let finalImageUrl = decodeURIComponent(imageUrl);
    const httpMatches = finalImageUrl.match(/https?:\/\/[^\s"']+/g);
    if (httpMatches && httpMatches.length > 0) {
      finalImageUrl = httpMatches[httpMatches.length - 1];
    }

    console.log("[API Upscale] Using fal-ai/clarity-upscaler for high-end upscale on:", finalImageUrl);

    const result = await fal.subscribe("fal-ai/clarity-upscaler", {
      input: {
        image_url: finalImageUrl,
        scale: 4, // 4x Upscale
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs.map((log) => log.message).forEach(console.log);
        }
      },
    });

    if (!result || !result.data || !result.data.image || !result.data.image.url) {
      throw new Error("Upscaler failed to return a valid image URL.");
    }

    const upscaledUrl = result.data.image.url;

    // Save to projects table (history)
    const { error: insertErr } = await adminSupabase
      .from('projects')
      .insert({
        user_id: userId,
        name: "Clarity Upscale",
        trace_type: "upscale",
        original_image_url: finalImageUrl,
        generated_image_url: upscaledUrl
      });

    if (insertErr) {
      console.error("Failed to save to history:", insertErr);
    }

    return NextResponse.json({ success: true, upscaledUrl });

  } catch (error) {
    console.error(`[Upscale API Error]:`, error.message);
    if (userId) {
      await safeRefundCredit(userId);
    }
    const safeMessage = error.message?.includes('fal') ? 'AI processing failed. Your credit has been refunded.' : (error.message || 'Failed to process upscale');
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
