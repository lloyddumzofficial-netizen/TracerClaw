# DesaynClaw

DesaynClaw is a Next.js production workspace for AI artwork extraction, image
upscaling, background removal, SVG vectorization, mockup rendering, and paid
Claw credit fulfillment.

## Local development

Use Node.js 22 LTS. Copy `.env.example` to `.env.local`, replace the placeholder
values, then install and run the app:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The main homepage is implemented in
`src/app/page.js`; API routes live under `src/app/api`.

## Release verification

Before deploying, run:

```bash
npm run test:release
```

This runs lint, the Vitest suite, ordered migration integrity checks, the
production build, and Playwright critical-flow tests. Install the Playwright
browser once on a new machine with:

```bash
npx playwright install chromium
```

GitHub Actions runs the same release checks for pull requests and pushes to
`main`.

## Database migrations

Ordered SQL migrations are in `database/migrations`. Apply them in numeric
order and run `npm run migrations:check` to catch missing or misnumbered files.
The authenticated deep-health endpoint validates the production schema, RLS,
database connection, required environment, and AI provider readiness.

## Environment and operations

- Environment reference: `docs/environment.md`
- Regression coverage: `docs/regression-coverage.md`
- Public liveness: `GET /api/health`
- Authenticated readiness: `GET /api/health?deep=1` with
  `Authorization: Bearer $CRON_SECRET`
- Scheduled readiness: `GET /api/cron/health` through Vercel Cron

Never expose service-role, provider, payment, or webhook secrets through a
`NEXT_PUBLIC_` variable.
