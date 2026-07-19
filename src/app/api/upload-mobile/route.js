import { NextResponse } from 'next/server';
import { getUploadUrl } from '@/lib/cloudflare';
import { adminSupabase } from '@/lib/supabase';
import { validateImageUploadRequest } from '@/lib/uploadLimits';

export async function POST(request) {
  try {
    // ─── Auth: require a valid session — prevents unauthenticated R2 uploads ───
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { fileName, contentType, fileSize, syncSessionId } = await request.json();

    if (!fileName || !contentType || !fileSize || !syncSessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validation = validateImageUploadRequest({ contentType, fileSize });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error, maxBytes: validation.maxBytes }, { status: validation.status });
    }

    // Validate syncSessionId is a proper UUID format (prevents brute-force guessing with short tokens)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(syncSessionId)) {
      return NextResponse.json({ error: 'Invalid session ID format.' }, { status: 400 });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    // Store under user's ID so cleanup cron can attribute files to users
    const fullFileName = `users/${user.id}/mobile_sync/${syncSessionId}/${Date.now()}_${safeName}`;

    const urls = await getUploadUrl(fullFileName, validation.contentType, {
      fileSize: validation.fileSize,
      maxBytes: validation.maxBytes,
    });

    return NextResponse.json(urls);

  } catch (error) {
    console.error('Error generating mobile upload URL:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
