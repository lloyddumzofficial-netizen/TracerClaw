# Integration Verification Checklist

## Build-Time

- `npm run build` completes.
- `/sitemap.xml` renders and includes public tool/legal routes.
- `/robots.txt` renders and points to the configured sitemap.
- `/api/health` returns `200` JSON for `GET`.
- `/api/health` returns `200` for `HEAD`.

## Browser Runtime

- Before cookie consent, no GA4, Clarity, PostHog, or Sentry scripts load.
- After accepting cookies, configured services initialize lazily.
- Route changes send `page_view`.
- `?ref=test` sends `affiliate_referral`.
- Login session sends `user_login`; fresh user sessions send `user_signup` once.
- Starting a workspace trace sends `trace_started`.
- Successful SVG generation sends `trace_completed`.
- SVG export sends `download_svg`.
- Selecting a top-up plan sends `checkout_started`.
- Successful payment request submission sends `credits_purchased`.
- Caught product errors send `error_event` and Sentry exceptions when configured.

## Vendor Dashboards

- GA4 Realtime shows page views and custom events.
- Search Console accepts the verification meta tag.
- Clarity shows new sessions and custom events.
- PostHog Activity shows captured events.
- Sentry receives a test browser error.
- UptimeRobot can monitor `https://desaynclaw.com/api/health`.

## Performance Guardrails

- Scripts load after consent and idle time.
- Missing env vars do not throw errors.
- Failed vendor requests do not block app flows.
- No raw image URLs, proof-of-payment files, tokens, or secrets are sent as event properties.
