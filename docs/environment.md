# Environment Variables

All production configuration is environment-driven. Public variables use the
`NEXT_PUBLIC_` prefix and are included in the browser bundle. Secret variables
must never use that prefix.

## Required In Production

- `NEXT_PUBLIC_SITE_URL`: canonical production URL used by metadata, sitemap, redirects, emails, and payment return URLs.
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key used by browser sessions.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only Supabase service-role key for API routes, admin operations, health checks, and schema verification.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID for R2 storage.
- `CLOUDFLARE_ACCESS_KEY_ID`: R2 access key ID.
- `CLOUDFLARE_SECRET_ACCESS_KEY`: R2 secret access key.
- `CLOUDFLARE_BUCKET_NAME`: R2 bucket name.
- `CLOUDFLARE_PUBLIC_URL`: public base URL for files stored in R2.
- `FAL_KEY`: Fal.ai API key for trace, background removal, and upscaling jobs.

Production startup validation checks these required variables in `src/instrumentation.js`.
If any are missing in production, startup fails before the app can serve partial functionality.

## Recommended In Production

- `UPSTASH_REDIS_REST_URL`: Upstash Redis URL for distributed rate limiting.
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis token for distributed rate limiting.
- `CRON_SECRET`: bearer token for `/api/cron/cleanup` and authenticated deep health checks.
- `ADMIN_EMAIL`: the only email address allowed to use admin APIs.
- `DODO_PAYMENTS_API_KEY`: Dodo Payments API key.
- `DODO_PAYMENTS_ENVIRONMENT`: Dodo environment, usually `live_mode`.
- `DODO_PAYMENTS_WEBHOOK_SECRET`: Dodo webhook signing secret.
- `PAYMONGO_SECRET_KEY`: PayMongo secret key used by the QRPh hosted checkout route.
- `PAYMONGO_WEBHOOK_SECRET`: PayMongo webhook signing secret for automatic QRPh crediting.
- `DODO_PRODUCT_TINGI`: Dodo product ID for the Tingi package.
- `DODO_PRODUCT_BASIC`: Dodo product ID for the Basic package.
- `DODO_PRODUCT_STARTER`: Dodo product ID for the Starter package.
- `DODO_PRODUCT_PRO`: Dodo product ID for the Pro package.
- `RESEND_API_KEY`: Resend API key for payment notification emails.
- `OPENROUTER_API_KEY`: optional SVG semantic segmentation provider key.
- `VECTORIZER_API_ID`: Vectorizer.AI API ID for precision SVG output.
- `VECTORIZER_API_SECRET`: Vectorizer.AI API secret.
- `RECRAFT_API_KEY`: Recraft fallback vectorization API key.
- `LOG_LEVEL`: set to `debug` to emit debug logs; defaults to `info`.
- `NEXT_PUBLIC_MAINTENANCE_MODE`: set to `true` for the emergency maintenance screen.

## Growth And Monitoring

- `NEXT_PUBLIC_GA4_MEASUREMENT_ID`: GA4 measurement ID, for example `G-XXXXXXXXXX`.
- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`: Search Console HTML tag token value.
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`: Microsoft Clarity project ID.
- `NEXT_PUBLIC_POSTHOG_KEY`: PostHog project API key.
- `NEXT_PUBLIC_POSTHOG_HOST`: PostHog capture host, usually `https://us.i.posthog.com`.
- `NEXT_PUBLIC_SENTRY_DSN`: Sentry browser/server DSN.
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT`: defaults to `production` in production builds.
- `NEXT_PUBLIC_SENTRY_RELEASE`: release identifier shown in Sentry.
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`: defaults to `0.05`.
- `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`: defaults to `0`.
- `NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE`: defaults to `0.1`.
- `SENTRY_AUTH_TOKEN`: optional; enables Sentry source map upload when paired with project settings in the deployment environment.

Sentry browser monitoring initializes independently from cookie consent so error
monitoring works immediately when `NEXT_PUBLIC_SENTRY_DSN` is present. GA4,
Microsoft Clarity, and PostHog remain consent-gated and initialize only after
`localStorage.cookie_consent` is set to `accepted`.
