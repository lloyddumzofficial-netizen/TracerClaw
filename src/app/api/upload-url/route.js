import { NextResponse } from 'next/server';
import { getUploadUrl } from '@/lib/cloudflare';
import { adminSupabase } from '@/lib/supabase';
import { validateImageUploadRequest } from '@/lib/uploadLimits';
import { enforceRateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  try {
    const { fileName, contentType, fileSize, purpose } = await request.json();

    if (!fileName || !contentType || !fileSize) {
      return NextResponse.json({ error: 'Missing fileName, contentType, or fileSize' }, { status: 400 });
    }

    const validation = validateImageUploadRequest({ contentType, fileSize, purpose });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error, maxBytes: validation.maxBytes }, { status: validation.status });
    }
    
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      console.log("[Upload URL] Missing auth header");
      return NextResponse.json({ error: 'Unauthorized - Missing auth header' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (token === 'undefined') {
      console.log("[Upload URL] Token is literal 'undefined'");
      return NextResponse.json({ error: 'Unauthorized - Invalid token format' }, { status: 401 });
    }
    
    // Fix #3: Use adminSupabase (service role) for consistent server-side auth validation
    const { data: { user }, error } = await adminSupabase.auth.getUser(token);

    if (error || !user) {
      console.error("[Upload URL] Supabase auth error:", error);
      return NextResponse.json({ error: `Unauthorized: ${error?.message || 'User not found'}` }, { status: 401 });
    }

    // Presigned-URL minting was unthrottled (the middleware that was meant to
    // cover it never loads — see src/utils/proxy.js).
    const rateLimit = await enforceRateLimit({
      namespace: "api:upload-url:user",
      identifier: user.id,
      max: 30,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    // Include user ID in the path to keep things organized.
    // The stored extension must agree with the validated content type: /api/proxy
    // decides how to serve a file by its EXTENSION, so a ".svg" key holding a
    // PNG-declared upload would be served back as executable image/svg+xml.
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    // Mirrors the allowlist in validateImageUploadRequest (uploadLimits.js).
    // SVG is deliberately absent there and must stay absent here.
    const expectedExt = ({
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/avif': 'avif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
    })[validation.contentType] || 'bin';

    const baseName = safeName.replace(/\.[^.]*$/, '') || 'upload';
    const normalizedName = `${baseName}.${expectedExt}`;
    const fullFileName = `users/${user.id}/${Date.now()}_${normalizedName}`;

    const urls = await getUploadUrl(fullFileName, validation.contentType, {
      fileSize: validation.fileSize,
      maxBytes: validation.maxBytes,
    });

    return NextResponse.json(urls);

  } catch (error) {
    console.error('Error generating upload URL:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
