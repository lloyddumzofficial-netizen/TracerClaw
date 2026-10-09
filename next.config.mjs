import { withSentryConfig } from "@sentry/nextjs";
import { execSync } from 'node:child_process';
import { getSecurityHeaders } from './src/lib/securityHeaders.mjs';

/**
 * Build-time commit stamp.
 *
 * Deploys here run `vercel --prod` from a local working directory rather than
 * through the Git integration, so Vercel does not populate
 * VERCEL_GIT_COMMIT_SHA. Without a stamp there is no way to tell what is
 * actually running in production — which is how production and the repository
 * silently drifted apart before.
 *
 * Prefer Vercel's own value when a Git-integrated deploy is used; otherwise
 * read the local HEAD at build time.
 */
function resolveBuildCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

function resolveBuildDirty() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return 'false';
  try {
    const out = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.length > 0 ? 'true' : 'false';
  } catch {
    return 'unknown';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/api/mockups/*/render': ['./public/mockup-studio/templates/**/*'],
  },
  env: {
    BUILD_COMMIT: resolveBuildCommit(),
    // "true" means the deploy was built from a working tree with uncommitted
    // changes, i.e. production does NOT match any commit in the repository.
    BUILD_DIRTY: resolveBuildDirty(),
    BUILD_TIME: new Date().toISOString(),
  },

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
    const isDevelopment = process.env.NODE_ENV !== 'production';

    return [
      {
        source: '/(.*)',
        headers: getSecurityHeaders({ isDevelopment }),
      },
      {
        // Auth-sensitive API responses must never be cached or framed.
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
