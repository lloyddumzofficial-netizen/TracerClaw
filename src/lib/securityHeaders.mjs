const STATIC_SCRIPT_ORIGINS = [
  "https://challenges.cloudflare.com",
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://www.clarity.ms",
  "https://scripts.clarity.ms",
  "https://*.i.posthog.com",
  "https://browser.sentry-cdn.com",
];

export function buildContentSecurityPolicy({ isDevelopment = false } = {}) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ...STATIC_SCRIPT_ORIGINS,
  ];

  const directives = [
    ["default-src", "'self'"],
    ["script-src", ...scriptSources],
    ["script-src-attr", "'none'"],
    ["frame-src", "'self'", "https://challenges.cloudflare.com"],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["font-src", "'self'", "data:"],
    ["img-src", "'self'", "data:", "blob:", "https:"],
    ["media-src", "'self'", "data:", "blob:", "https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev", "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev"],
    ["connect-src", "'self'", "https:", "wss:"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ...(isDevelopment ? [] : [["upgrade-insecure-requests"]]),
  ];

  return directives.map((directive) => directive.join(" ")).join("; ");
}

export function getSecurityHeaders(options = {}) {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-XSS-Protection", value: "0" },
  ];
}
