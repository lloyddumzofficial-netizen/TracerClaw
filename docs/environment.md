# Environment Variables

All growth and monitoring configuration is environment-driven.

## Required For Each Integration

- `NEXT_PUBLIC_SITE_URL`: canonical production URL used by metadata, sitemap, and robots.
- `NEXT_PUBLIC_GA4_MEASUREMENT_ID`: GA4 measurement ID, for example `G-XXXXXXXXXX`.
- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`: Search Console HTML tag token value.
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`: Microsoft Clarity project ID.
- `NEXT_PUBLIC_POSTHOG_KEY`: PostHog project API key.
- `NEXT_PUBLIC_POSTHOG_HOST`: PostHog capture host, usually `https://us.i.posthog.com` or your project host.
- `NEXT_PUBLIC_SENTRY_DSN`: Sentry browser DSN.

## Optional Sentry Tuning

- `NEXT_PUBLIC_SENTRY_ENVIRONMENT`: defaults to `production` in production builds.
- `NEXT_PUBLIC_SENTRY_RELEASE`: release identifier shown in Sentry.
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`: defaults to `0.05`.
- `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`: defaults to `0`.
- `NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE`: defaults to `0.1`.
- `SENTRY_AUTH_TOKEN`: optional; enables Sentry source map upload when paired with project settings in the deployment environment.

Unset variables are safe. The matching integration simply stays disabled.
