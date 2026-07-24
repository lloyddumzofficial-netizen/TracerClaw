import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { isAllowedStorageUrl, normalizeUserImageUrl } from "@/lib/ssrf";

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
          trace_type: traceType === 'bg_remover' ? 'bg_remover' : (String(traceType || '').startsWith('mockup') ? 'mockup' : 'logo'),
          user_id: user.id,
          ai_prompt: traceType === 'mockup_erase' ? 'ERASE_LOGOS' 
                   : traceType === 'mockup_preserve' ? 'PRESERVE_LOGOS'
                   : traceType === 'logo' ? 'LOGO_FLATTEN'
                   : null
        }
      ])
      .select('id')
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      throw new Error(`Failed to save project to database: ${error.message || JSON.stringify(error)}`);
    }

    // Return the project ID to the frontend
    return NextResponse.json({ success: true, projectId: data.id });

  } catch (error) {
    console.error("Error in upload route:", error);
    return NextResponse.json(
      { error: "Failed to create project." },
      { status: 500 }
    );
  }
}
