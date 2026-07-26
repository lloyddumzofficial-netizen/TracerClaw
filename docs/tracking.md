# DesaynClaw Tracking

All analytics code lives in `src/lib/analytics.js` and is started by `src/components/AnalyticsProvider.js`.

Analytics loads only after the user accepts the existing cookie banner. If a required `NEXT_PUBLIC_*` key is missing, that provider is skipped and no script or network call is made for it.

## Services

- Google Analytics 4: page views and custom events through `gtag`.
- Google Search Console: verification meta tag through Next metadata.
- Microsoft Clarity: lazy-loaded Clarity script plus custom event calls.
- PostHog Free Cloud: capture API calls for page views, identity, and custom events.
- Sentry Free: lazy-loaded browser bundle for error capture and breadcrumbs.
- UptimeRobot: `GET` or `HEAD /api/health`.

## Event Map

- Page View: automatic on route changes.
- User Signup: automatic for fresh Supabase users, deduped in local storage.
- User Login: automatic for authenticated sessions, deduped per browser session.
- Trace Started: when workspace tracing begins.
- Trace Completed: after SVG vectorization succeeds.
- Download SVG: when SVG export starts.
- Checkout Started: when a credit plan is selected.
- Credits Purchased: when a payment request is submitted.
- Affiliate Referral: when `?ref=` or `?affiliate=` is present in the URL.
- Error Events: caught product errors via `analytics.error(...)`.

## Adding Events

Use the helper instead of calling vendors directly:

```js
import { analytics } from "@/lib/analytics";

analytics.trackEvent("example_event", { project_id: project.id });
analytics.error(error, { area: "example_area" });
```

Keep event properties small, avoid raw image URLs, and never send secrets or payment proof details.
