import { NextResponse } from 'next/server';
import { getUploadUrl } from '@/lib/cloudflare';

export async function POST(request) {
  try {
    const { fileName, contentType, syncSessionId } = await request.json();

    if (!fileName || !contentType || !syncSessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Security: only allow real image types — reject executables, HTML, etc.
    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED_TYPES.includes(contentType.toLowerCase())) {
      return NextResponse.json({ error: 'Invalid file type. Only images are allowed.' }, { status: 400 });
    }

    // Validate syncSessionId is a proper UUID format (prevents brute-force guessing with short tokens)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(syncSessionId)) {
      return NextResponse.json({ error: 'Invalid session ID format.' }, { status: 400 });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fullFileName = `users/mobile_sync/${syncSessionId}/${Date.now()}_${safeName}`;

    const urls = await getUploadUrl(fullFileName, contentType);

    return NextResponse.json(urls);

  } catch (error) {
    console.error('Error generating mobile upload URL:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
