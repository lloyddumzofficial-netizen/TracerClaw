import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { isAllowedStorageUrl, normalizeUserImageUrl } from "@/lib/ssrf";
import { enforceRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

function resolveProjectTraceType(traceType) {
  if (traceType === "mockup_erase" || traceType === "mockup_preserve") return "mockup";
  if (traceType === "logo") return "logo";
  if (traceType === "bg_remover") return "bg_remover";
  return "logo";
}

function resolveAiPromptMode(traceType) {
  if (traceType === "mockup_erase") return "ERASE_LOGOS";
  if (traceType === "mockup_preserve") return "PRESERVE_LOGOS";
  if (traceType === "logo") return "LOGO_FLATTEN";
  return null;
}

export async function POST(request) {
  try {
    // ─── Auth: verify token from the request header ───────────────────────────
    // NEVER trust userId from the request body — always verify server-side.
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === 'undefined') {
      return NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 401 });
    }
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const rateLimit = await enforceRateLimit({
      namespace: "api:upload:user",
      identifier: user.id,
      max: 30,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { imageUrl, traceType, projectName } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "No image URL provided" }, { status: 400 });
    }

    const normalizedImageUrl = normalizeUserImageUrl(imageUrl, new URL(request.url).origin);
    if (!isAllowedStorageUrl(normalizedImageUrl, { userId: user.id })) {
      return NextResponse.json({ error: "Invalid image URL: must be from your upload storage." }, { status: 400 });
    }

    // Fix #4: Sanitize projectName — prevent XSS and oversized DB entries
    const safeName = ((projectName || 'Untitled Project').toString())
      .replace(/<[^>]*>/g, '')  // strip any HTML tags
      .replace(/[^\w\s.\-()[\]]/g, '') // allow only safe printable chars
      .trim()
      .slice(0, 100) || 'Untitled Project';

    // Save to Supabase database — use verified user.id, NOT body userId
    const { data, error } = await adminSupabase
      .from('projects')
      .insert([
        { 
          name: safeName, 
          original_image_url: normalizedImageUrl,
          trace_type: resolveProjectTraceType(traceType),
          user_id: user.id,
          ai_prompt: resolveAiPromptMode(traceType)
        }
      ])
      .select('id')
      .single();

    if (error) {
      logger.error("[Upload] Project insert failed", error);
      throw new Error(`Failed to save project to database: ${error.message || JSON.stringify(error)}`);
    }

    // Return the project ID to the frontend
    return NextResponse.json({ success: true, projectId: data.id });

  } catch (error) {
    logger.error("[Upload] Request failed", error);
    return NextResponse.json(
      { error: "Failed to create project." },
      { status: 500 }
    );
  }
}
