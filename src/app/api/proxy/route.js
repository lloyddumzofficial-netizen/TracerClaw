import { NextResponse } from "next/server";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, DEFAULT_MAX_ZIP_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, validateUrlForSSRF } from "@/lib/ssrf";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";

// SSRF Protection: only allow proxying from our own Cloudflare R2 domains and
// known AI provider media hosts. Never fetch arbitrary URLs from the server —
// that opens internal metadata attacks.
const R2_PUBLIC_HOST = process.env.CLOUDFLARE_PUBLIC_URL
  ? new URL(process.env.CLOUDFLARE_PUBLIC_URL).hostname
  : "pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev";

const R2_STORAGE_HOST = process.env.CLOUDFLARE_ACCOUNT_ID
  ? `${process.env.CLOUDFLARE_BUCKET_NAME}.${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : null;

const PROVIDER_HOSTS = getAllowedProviderHosts();
const ALLOWED_HOSTS = [
  R2_PUBLIC_HOST,
  // R2 S3-compatible endpoint — images uploaded via presigned URLs may have this as source
  ...(R2_STORAGE_HOST ? [R2_STORAGE_HOST] : []),
  // Legacy standalone upscales were saved as provider URLs before the API moved
  // them into R2. Keep downloads working while new outputs are stored in R2.
  ...PROVIDER_HOSTS,
];

function matchesAllowedHost(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const allowed = String(allowedHost || '').toLowerCase();
    if (!allowed) return false;
    if (allowed.startsWith('.')) {
      const suffix = allowed.slice(1);
      return host === suffix || host.endsWith(allowed);
    }
    return host === allowed;
  });
}

export async function GET(request) {
  try {
    // NOTE: This route intentionally has no auth check.
    // It is used in browser <img src="..."> tags which cannot send auth headers.
    // Security is provided by:
    // 1. Host allowlist below (SSRF protection — only R2 URLs allowed)
    // 2. The per-IP limit right here. This used to say "rate limiting in
    //    middleware", but src/utils/proxy.js is never loaded by Next (wrong
    //    directory), so that layer did not exist and this route was an
    //    unthrottled public read proxy over the whole bucket.
    // 3. SVG responses are sent as sandboxed attachments — see below.
    const ipLimit = await enforceRateLimit({
      namespace: "api:proxy:ip",
      identifier: getClientIp(request),
      max: 120,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!ipLimit.success) return ipLimit.response;

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

    if (!(await validateUrlForSSRF(url, { allowedHosts: ALLOWED_HOSTS }))) {
      console.warn(`[Proxy] Blocked request to unauthorized host: ${parsedUrl.hostname}`);
      return new NextResponse('Forbidden: URL not from an allowed host', { status: 403 });
    }

    const lowerPath = parsedUrl.pathname.toLowerCase();
    const isProviderMedia = matchesAllowedHost(parsedUrl.hostname, PROVIDER_HOSTS);
    const isUpscaledDownload = isProviderMedia || lowerPath.includes('/upscaled_') || downloadName?.toLowerCase().includes('upscaled');
    const maxBytes = lowerPath.endsWith('.svg')
      ? DEFAULT_MAX_SVG_BYTES
      : lowerPath.endsWith('.zip')
        ? DEFAULT_MAX_ZIP_BYTES
      : isUpscaledDownload
        ? DEFAULT_MAX_UPSCALED_IMAGE_BYTES
        : DEFAULT_MAX_IMAGE_BYTES;
    const isSvg = parsedUrl.pathname.toLowerCase().endsWith('.svg');

    if (!isSvg) {
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
          // Stop the browser sniffing a mislabelled upload back into HTML/SVG.
          'X-Content-Type-Options': 'nosniff',
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

    // SVG served from our own origin is executable content. If a user is
    // navigated to this URL the browser would run any script inside it as
    // desaynclaw.com, exposing the Supabase session token in localStorage.
    //
    // Always send it as an attachment and sandbox it. Neither affects the app:
    // every SVG consumer reads this endpoint with fetch() (SafeInlineSVG,
    // PalettePreviewModal), and fetch ignores both headers. No <img> renders an
    // SVG through the proxy.
    const svgFilename = downloadName
      ? downloadName.replace(/[^a-zA-Z0-9_.-]/g, '_')
      : (parsedUrl.pathname.split('/').pop() || 'vector.svg').replace(/[^a-zA-Z0-9_.-]/g, '_');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${svgFilename}"`,
        'Content-Security-Policy': "sandbox; default-src 'none'; script-src 'none'; style-src 'none'",
        'X-Content-Type-Options': 'nosniff',
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
