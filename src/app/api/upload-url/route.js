import { NextResponse } from 'next/server';
import { getUploadUrl } from '@/lib/cloudflare';
import { adminSupabase } from '@/lib/supabase';
import { validateImageUploadRequest } from '@/lib/uploadLimits';

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

    // Include user ID in the path to keep things organized
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fullFileName = `users/${user.id}/${Date.now()}_${safeName}`;

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
