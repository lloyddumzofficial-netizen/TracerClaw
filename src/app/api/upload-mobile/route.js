import { NextResponse } from 'next/server';
import { getUploadUrl } from '@/lib/cloudflare';

export async function POST(request) {
  try {
    const { fileName, contentType, syncSessionId } = await request.json();

    if (!fileName || !contentType || !syncSessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Since this is a mobile upload, the user is not authenticated on their phone.
    // The strong random UUID (syncSessionId) acts as a short-lived capability token.
    if (syncSessionId.length < 16) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
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
