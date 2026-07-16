import { NextResponse } from "next/server";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, DEFAULT_MAX_ZIP_BYTES, fetchWithSSRFProtection, validateUrlForSSRF } from "@/lib/ssrf";

// SSRF Protection: only allow proxying from our own Cloudflare R2 domains.
// Never fetch arbitrary URLs from the server — that opens internal metadata attacks.
const R2_PUBLIC_HOST = process.env.CLOUDFLARE_PUBLIC_URL
  ? new URL(process.env.CLOUDFLARE_PUBLIC_URL).hostname
  : "pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev";

const R2_STORAGE_HOST = process.env.CLOUDFLARE_ACCOUNT_ID
  ? `${process.env.CLOUDFLARE_BUCKET_NAME}.${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : null;

const ALLOWED_HOSTS = [
  R2_PUBLIC_HOST,
  // R2 S3-compatible endpoint — images uploaded via presigned URLs may have this as source
  ...(R2_STORAGE_HOST ? [R2_STORAGE_HOST] : []),
];

export async function GET(request) {
  try {
    // NOTE: This route intentionally has no auth check.
    // It is used in browser <img src="..."> tags which cannot send auth headers.
    // Security is provided by:
    // 1. Host allowlist below (SSRF protection — only R2 URLs allowed)
    // 2. Rate limiting in middleware (60 req/min per IP)
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const downloadName = searchParams.get('download');

    if (!url) {
      return new NextResponse('Missing URL parameter', { status: 400 });
    }

    // Validate the URL is from an allowed host
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return new NextResponse('Invalid URL', { status: 400 });
    }

    if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
      console.warn(`[Proxy] Blocked request to unauthorized host: ${parsedUrl.hostname}`);
      return new NextResponse('Forbidden: URL not from an allowed host', { status: 403 });
    }

    const lowerPath = parsedUrl.pathname.toLowerCase();
    const maxBytes = lowerPath.endsWith('.svg')
      ? DEFAULT_MAX_SVG_BYTES
      : lowerPath.endsWith('.zip')
        ? DEFAULT_MAX_ZIP_BYTES
      : lowerPath.includes('/upscaled_')
        ? DEFAULT_MAX_UPSCALED_IMAGE_BYTES
        : DEFAULT_MAX_IMAGE_BYTES;
    const isSvg = parsedUrl.pathname.toLowerCase().endsWith('.svg');

    if (!isSvg) {
      if (!(await validateUrlForSSRF(url, { allowedHosts: ALLOWED_HOSTS }))) {
        return new NextResponse('Forbidden', { status: 403 });
      }

      const upstream = await fetch(url, { redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        return new NextResponse('Redirects are not allowed', { status: 403 });
      }
      if (!upstream.ok) {
        return new NextResponse(`Failed to fetch image: ${upstream.statusText}`, { status: upstream.status });
      }

      const contentLength = Number(upstream.headers.get('content-length') || '0');
      if (contentLength && contentLength > maxBytes) {
        return new NextResponse('File too large', { status: 413 });
      }

      const upstreamType = upstream.headers.get('content-type') || '';
      const contentType = lowerPath.endsWith('.zip')
        ? 'application/zip'
        : upstreamType.startsWith('image/')
          ? upstreamType
          : 'image/png';

      return new NextResponse(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          ...(downloadName ? { 'Content-Disposition': `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"` } : {}),
          'Cache-Control': 'public, max-age=86400, no-transform'
        }
      });
    }

    const { response: res, buffer: fetchedBuffer } = await fetchWithSSRFProtection(url, {
      allowedHosts: ALLOWED_HOSTS,
      maxBytes,
      allowedContentTypes: ['image/', 'application/octet-stream'],
    });

    if (!res.ok) {
      return new NextResponse(`Failed to fetch image: ${res.statusText}`, { status: res.status });
    }

    let buffer = fetchedBuffer;
    
    // Force correct Content-Type for SVG files — R2 sometimes returns
    // application/octet-stream for .svg which breaks <img> rendering
    const contentType = 'image/svg+xml';

    // FIX FOR OLD SVGs: Strip invalid inkscape:label that causes Adobe Illustrator to crash
    if (isSvg) {
      let svgText = Buffer.from(buffer).toString('utf8');
      if (svgText.includes('inkscape:label=')) {
        svgText = svgText.replace(/\sinkscape:label=["'][^"']*["']/g, '');
        buffer = Buffer.from(svgText, 'utf8');
      }
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(downloadName ? { 'Content-Disposition': `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"` } : {}),
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    console.error('[Proxy Error]:', error);
    if (error.message === 'Remote file is too large') {
      return new NextResponse('File too large', { status: 413 });
    }
    if (error.message === 'Remote file has an invalid content type') {
      return new NextResponse('Invalid content type', { status: 415 });
    }
    if (error.message === 'Invalid or unauthorized URL') {
      return new NextResponse('Forbidden', { status: 403 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
