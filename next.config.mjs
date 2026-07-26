/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Canonical domain redirect ───────────────────────────────────────────────
  // Any request hitting desaynclaw.vercel.app is permanently redirected to
  // the custom domain desaynclaw.com, preserving path + query string.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'desaynclaw.vercel.app' }],
        destination: 'https://desaynclaw.com/:path*',
        permanent: true, // 308 — browsers + search engines will update their records
      },
    ];
  },

  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          // Prevent clickjacking — stops your site from being embedded in iframes
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Prevent MIME type sniffing — stops browsers from guessing file types
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Minimal referrer info sent to third parties
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS for 1 year (only enable once you're 100% on HTTPS)
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Disable browser features you don't use
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Basic XSS protection header (older browsers)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Baseline CSP. Deliberately permissive on scripts/styles because Next
          // injects inline bootstrap scripts and the app uses inline styles
          // throughout — tightening those needs a nonce pass and would break the
          // app today. The value here is object-src/base-uri/frame-ancestors,
          // which blocks plugin embeds, <base> hijacking and framing outright.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // challenges.cloudflare.com: the Turnstile captcha on the login
              // modal loads its script from there and renders itself in an
              // iframe, so it needs both script-src and frame-src.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "frame-src 'self' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              // Fonts come from next/font/google, which self-hosts them at build
              // time — no external font origin is needed.
              "font-src 'self' data:",
              "img-src 'self' data: blob: https:",
              // wss: is required for the Supabase realtime socket (mobile sync
              // and the admin dashboard). "https:" does NOT cover wss:.
              "connect-src 'self' https: wss:",
              "worker-src 'self' blob:",
              // The directives that actually carry weight and cost nothing:
              // no plugin embeds, no <base> hijacking, no framing, no
              // cross-origin form posts.
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // API routes: prevent caching of auth-sensitive responses
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;

