import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
      return new NextResponse('Missing URL parameter', { status: 400 });
    }

    const res = await fetch(url);
    
    if (!res.ok) {
      return new NextResponse(`Failed to fetch image: ${res.statusText}`, { status: res.status });
    }

    const buffer = await res.arrayBuffer();
    
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    console.error('[Proxy Error]:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
