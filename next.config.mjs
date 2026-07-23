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

