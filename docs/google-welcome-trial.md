# Google welcome trial runbook

This optional campaign grants one fungible Claw to new Gmail users signing in
through Google OAuth. Email magic links, existing balances, payments, model
requests and AI prompts are unchanged. The existing Supabase provider stays.

## Deployment order (dark by default)

1. Deploy migration `037_google_welcome_trial.sql` and the matching application.
   Migration 037 replaces referral binding's independent credit increment with
   the unified trial grant. New invitee trial awards pause until campaign launch;
   existing inviter qualification and settlement continue unchanged.
2. Keep `GOOGLE_WELCOME_TRIAL_ENABLED=false`. Configure Redis, the existing
   permanent `REFERRAL_SECURITY_SECRET` (32+ characters), `TURNSTILE_SECRET_KEY`,
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and the comma-separated
   `TURNSTILE_ALLOWED_HOSTNAMES` for each exact deployment hostname. Set up the
   Turnstile widget to allow these hosts. No wildcard or client Host trust.
   Local tests require Cloudflare's test key pair explicitly; never put test
   secrets into production. The UI's existing localhost test site key remains.
3. Verify that deployed `profiles.credits` defaults to zero and
   `public.handle_new_user()` inserts zero. Do not reset existing balances.
4. In a secure operator terminal, run:
   `node --env-file=.env.local scripts/backfill-google-trials.mjs --write`.
   This uses the configured service role, never logs identities, and never
   changes balances. It blocks existing account emails/Google identities and
   historical referral-trial emails from new welcome awards. It is resumable
   before first launch and refuses to run against a launched campaign.
5. In Supabase SQL Editor, run
   `select public.activate_google_trial_campaign();` then enable
   `GOOGLE_WELCOME_TRIAL_ENABLED=true` and redeploy. Activation records a fixed
   launch timestamp once; never replace it to reset eligibility. Accounts
   created before activation cannot earn the welcome bonus.
6. Verify one controlled new Google signup and one existing account. The live
   signup adds a real Claw; no paid AI generation is needed to verify signup.

The database ceiling is 25 awarded trials per UTC day across welcome and
referral invitee trials. This is a grant budget, not a provider spending cap:
users can spend their granted Claw later. Trial Claws use the existing spend
and refund rules and have no new expiration policy.

## Kill switch and recovery

Immediately stop **all new signup-trial awards** with:
`update public.welcome_trial_campaign set enabled = false where id = true;`
Also set the application flag false. Existing paid credits and sign-in remain
available. Re-enable the same campaign without changing its launch timestamp
or signing secret. Do not delete receipts/counters to retry failures.

Missing CAPTCHA/Redis/configuration or identity-verification failures allow
ordinary OAuth but mint no trial proof. A valid proof expires after 20 minutes
and is consumed once by the atomic database transaction. Quota-deferred users
retry through a fresh Google OAuth flow; no credits are reserved or queued.
Bound referral attribution survives the deferred claim and does not require a
new referral link. A wrong/deleted/expired proof never changes credit balance.
If a deferred invitee completes a charged project before receiving the trial,
their durable completion event is checked after the grant; the inviter still
receives the normal full 72-hour security hold and existing settlement cap.

## Interfaces and visibility

- `POST /api/auth/google/start`: same-origin JSON `{captchaToken}`; returns the
  Supabase authorization `url` and `trialVerification: ready|unavailable`.
  Sets HttpOnly, SameSite=Lax proof/device cookies; OAuth PKCE remains Supabase's.
- Existing `/api/auth/callback`: exchanges the code; separately verifies the
  Google UserInfo subject and verified Gmail email, binds a valid referral,
  and calls the unified service-role grant. Callback failures never undo login.
- `GET /api/welcome-trial`: anonymous `{enabled}` only; bearer-authenticated
  caller receives its own status/reason/balance/retry time and receipt metadata.
  All responses are uncached. The GET endpoint never grants credits.
- Logs contain only decision status/reason/account ID. Never include provider
  tokens, CAPTCHA tokens, secret keys, full provider responses, or email values.
- Inspect `welcome_trial_daily`, `welcome_trial_claims`, and receipts using
  admin/service access. Watch daily awards, pending allocation, identity/browser
  denials, and callback failures. Existing authenticated deep health checks the
  campaign configuration/readiness when its application flag is enabled.

## Retention and limits

Receipt account IDs and namespaced HMACs of Google subjects/canonical email
are kept across account deletion solely to prevent repeat trial claims. The
browser limit is 90 days; old browser hashes are cleared by cleanup. Intent
proofs expire and become eligible for daily cleanup one day after expiry,
without retaining access tokens. Retention cleanup also runs when grants are disabled.
No raw IP is added to the trial ledger; referral network risk remains existing
coarse hashing, not a hard IP denial. Do not rotate the referral signing secret
without a deliberate identity/referral migration.

Cookie deletion, several real Gmail accounts, or identities deleted before any
historical records existed cannot be perfectly detected. Google OAuth does not
prove account age, one human per account, or eliminate multi-account abuse.
Do not advertise those guarantees. No invasive fingerprinting vendor is added.

## Verification

Run `node node_modules/vitest/vitest.mjs run`,
`node node_modules/eslint/bin/eslint.js .`, `node scripts/check-migrations.mjs`,
`node node_modules/next/dist/bin/next build`, and Playwright browser tests.
For executable SQL checks, install `@electric-sql/pglite@0.3.14` into the ignored
`.tmp/trial-sql` directory (for example, `pnpm --dir .tmp/trial-sql add
@electric-sql/pglite@0.3.14 --ignore-scripts`). The integration suite detects
this optional engine and executes migration 037 against an in-memory Postgres
fixture. It tests queued competing claims and atomic rollback; PGlite uses one
connection, so production-like multi-connection lock contention should also be
verified in staging. It never connects to Supabase. Without the engine, this
suite is explicitly skipped. Check prompt-file hashes before/after the change.
