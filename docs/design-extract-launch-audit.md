# Design Extract pricing and launch audit

> Design Extract configuration/status below includes historical checkpoints. Use [the current predeployment audit](design-extract-predeploy-audit-2026-11-19.md) for current paid billing, processors, security fixes and release gates.

Current status: migrations 039 and 040 are verified live; admin-only beta remains free. See [the current reliability verification](desaynclaw-reliability-verification.md) for the latest checks and remaining release gates. Older dated sections below are historical checkpoints and may describe blockers subsequently resolved. The tariff below is selected policy, not a claim that user billing is already enabled.

## Selected tariff

| Action | Claws | Included |
| --- | ---: | --- |
| Generate layers | 2 | One four-layer decomposition, automatic enhancement of its outputs, all export formats |
| Split further | 2 | One selected-layer decomposition, enhancement of its outputs |
| Extract original element | 1 | One explicitly submitted SAM selection, including all Include/Exclude points |
| Manual masks, arranging, version selection, saving, reopening, PNG/ZIP/PSD downloads | 0 | No AI call |

Do not charge separately for automatic enhancement. A discarded successful refinement still consumes its operation price; its provider work was performed. A confirmed unusable/failed operation is refundable exactly once. An uncertain submission keeps its reservation until reconciled; never issue a second generation automatically. A successful base output with enhancement fallback is usable, not a failed extraction.

## Price evidence (checked 2026-11-18)

- https://fal.ai/models/fal-ai/qwen-image-layered lists $0.05 per image. Until actual receipts establish the multi-layer billing unit, budget conservatively for four billed images: $0.20.
- https://fal.ai/models/fal-ai/esrgan lists $0.00111 per compute second. Four enhancements are not a fixed per-request fee. Wall-clock queue duration is not billable compute duration.
- https://fal.ai/models/fal-ai/sam-3/image lists $0.005 per request.
- Existing paymentPlans.js: international Professional is $15.49/35 Claws ($0.44257/Claw); Philippine Professional is PHP899/35 (PHP25.6857/Claw). No exchange-rate assumption is used.
- Two Claws generate about $0.885 before payment fees/taxes in the lowest international unit-price pack. Under the conservative Qwen assumption, enhancement cost is $0.00111 times aggregate billed compute seconds. At a hypothetical 10-second compute time per enhancement, provider cost is $0.2444; at 30 seconds each, $0.3332. These are scenarios, not measured billing.
- One Claw for four-layer generation leaves too little headroom under the conservative output-billing assumption. Two is the initial fixed tariff. Measure actual billed compute, failures, storage, processor fees and taxes before public release. Do not silently change the price of an existing job.

## Verified hardening in this checkout

- Single-attempt HTTP submission for Qwen and SAM, bounded timeout, fixed endpoint allowlist, no redirects. Lost receipts retain the durable submitting claim.
- Enhancements already use single-attempt submission and durable compare-and-swap checkpoints.
- Job request-key reuse across kinds or selected layers is rejected.
- API access still requires the configured admin and enabled flag, with owner-checked project queries, expiry, rate limits, SSRF-protected asset reads and revision-checked edits.
- Untrusted upstream error messages are not returned to clients; raw submission messages are no longer logged.
- Read-only opening remains distinct from job synchronization. Existing tests cover automatic acceptance and PNG/ZIP/PSD exports.

## Work still required for the full goal

1. Implemented in migration 039 and server billing module: owner/project lock, server-set tariff/version, profile balance lock, deduction + credit log + job insert in one transaction. Paid mode fails closed on RPC failures. Migration is NOT applied to a live database. Existing checkout integrations are unchanged.
2. Implemented one-time settlement/refund and lost-receipt reservation semantics. Local SQL execution verifies ownership, duplicate claims, insufficient funds, revision conflicts, refunds and permissions. Still required: maintenance recovery after an interrupted refund, expiry/deletion behavior for held reservations, and true multi-session database contention tests. Explicit beta mode remains free and admin-only; paid mode never falls back to beta.
3. Display the operation price before submission and keep the displayed balance synchronized. Enable authenticated-user access only after paid claims fail closed. Keep provider-request reconciliation admin-only.
4. Protect stored originals/layers/masks with private object access or expiring signed access. Current R2 public URLs remain accessible to someone who obtains the URL; an owner-checked API alone does not fix that. Audit the shared proxy before changing public rollout.
5. Add failure-injection and concurrency tests for balance conservation and one-charge/one-refund invariants; verify the applied database schema and complete browser flow. Test owner isolation across all project, source, mask and export variants. Measure provider receipts without publishing credentials or private image URLs.

No claim of zero bugs, zero leaks, deployed schema changes, or enabled public billing is made by this audit.

## Local billing SQL verification

Run `node scripts/verify-design-extract-billing.mjs` with a local PGlite 0.5.16 module. This audit used a temporary package extracted at `.tmp/design-extract-db/package/dist/index.js`; it is not committed. Alternatively install `@electric-sql/pglite@0.5.16` into a temporary directory and set `PGLITE_TEST_MODULE` to its `dist/index.js`. The script creates an isolated in-memory PostgreSQL instance, executes migrations 038/039, and checks balance/log invariants; it never reads environment database credentials. Its overlapping-call test uses one connection and is not a substitute for a multi-session PostgreSQL test.

Paid mode requires `DESIGN_EXTRACT_BILLING_MODE=paid` and migration 039. Until price disclosure is wired in the workspace, the server also requires a matching `priceVersion`, so the existing UI cannot silently start charging users. Leave paid mode off until the remaining audit items are complete.

## Latest implementation checkpoint

- Workspace price labels and acknowledged amount/version are wired. Paid server submissions require the expected tariff, private source ownership, and configured separate private storage. Paid balance updates use the confirmed reservation and subsequent server snapshots. Browser paid-price flow passed.
- Interrupted terminal settlements are retried by maintenance. Expiry removes assets but retains financial evidence if settlement fails; explicit deletion refuses to drop held reservations. Retention/refund tests pass.
- Private storage adapter, owned staging uploads, bounded S3 reads, five-minute image links, one-hour provider input links, response redaction, and private cleanup are implemented and unit-tested. Design Extract thumbnails bypass the public cache proxy. Legacy beta/public assets remain compatible but are not made private by this code alone.
- Read-only live R2 metadata check found the dedicated bucket absent (404). The setup script then received Cloudflare AccessDenied (403) while attempting to create it. No private bucket setting was written locally and no public bucket configuration was changed. A bucket administrator must provision/grant access before private delivery can be verified live.
- Critical recovery item still open: an atomic paid claim whose HTTP receipt is lost may commit before provider dispatch. Add a durable dispatch-start marker and recovery that can distinguish not-yet-submitted work from an uncertain provider submission; verify no duplicate HTTP POST.
- Migration 039 remains unapplied to the live database. Public-user access and paid mode remain disabled. Existing public files require migration/expiry and cache treatment before claiming privacy for legacy URLs.

## Latest verification — 2026-11-18

- Private bucket now exists. Cloudflare dashboard verified r2.dev disabled and no custom domain. Saved CORS for production origins and localhost:3000; approved lifecycle rules staging/design-extract/ after one day and users/ after three days. Default seven-day multipart-abort rule remains unchanged.
- Live app-key object probe PASSED: SDK upload/read, signed PUT, real CORS OPTIONS preflight, five-minute signed GET, anonymous denial, and probe deletion. Object-only keys cannot inspect bucket configuration (HeadBucket/GetBucketCors returned 403). This does not imply object access is unavailable.
- Anonymous S3 returns HTTP400 InvalidArgument without authentication; it does not return object data. Private-domain configuration was independently checked in the dashboard.
- Local machine clock measured about 81 seconds behind R2. A 60-second diagnostic link expired immediately; the app's actual five-minute links passed. Correct host clock synchronization before production deployment; do not extend private URL lifetimes to mask clock problems.
- Verified private bucket name appended to ignored .env.local. Existing public bucket and credentials unchanged. Local billing mode remains beta/free; production configuration was not changed.
- Live REST schema probes confirmed migration039 is missing: charge_amount/billing_state select returned42703 and billing RPCs returned PGRST202. User has been asked to apply the prepared migration. Paid mode remains OFF.
-039 now includes dispatch_started_at. Paid jobs persist a compare-and-set marker before provider POST. Sync can resume committed reservations with no dispatch marker; started/uncertain submissions never POST again. Beta legacy jobs are never automatically resubmitted. Tests verify lost claim receipts, one winner, metadata stripping and no second debit.
-Header shows current billing mode, operation prices and balance when paid; beta explicitly says zero Claws. Buttons display generation/split/selection prices before submission. Manual editing/exports remain free.
-Opening upload transition uses Carbon/Graphite, a continuously rotating neutral ring and moving progress bar; browser test checks actual frame movement and real stage text.
-Selection refinement now focuses the selected layer before point selection, avoiding an inspector overlap found in browser verification.
-Local suite verifies raster alpha, ZIP manifest, PSD layer names/order/visibility/placement and refresh recovery. Browser providers/auth are mocked; this is not evidence of a newly run live fal generation or live balance deduction.
-Remaining release gates: apply039; verify live billing/refund flow and multi-session database locking; measure actual fal receipts; explicitly decide public rollout. No claim of production readiness or bug-free behavior.

## Live migration and billing verification — 2026-11-18

- Migration039 now verified live: charge_amount, billing_state and dispatch_started_at are queryable. Exact-signature claim/settle RPC probes returned not_found with nonexistent IDs. Empty-argument RPC probes returning PGRST202 were not reliable evidence of absence; corrected the verification approach.
- Live isolated non-admin fixture test passed: eight concurrent same-key claims produced one charge; eight dispatch-marker updates produced one winner; eight concurrent refunds restored the fixture balance exactly once. Extract/split cost2, segment cost1, repeat settlement, active-job conflicts, insufficient balance, owner/revision checks and anonymous RPC denial passed.
- No fal requests were issued and no existing user's balance was touched. Temporary test account, projects, ledger entries and credit logs were removed by scoped cleanup.
- A fixture sign-in attempt was rejected by the existing CAPTCHA protection. It was not bypassed. Live financial checks completed without signing in; authenticated-role execution privileges remain covered by the isolated PostgreSQL schema test rather than a live authenticated-session test.
- Reproduce with: node --experimental-websocket scripts/verify-design-extract-live-billing.mjs --allow-test-fixtures (Node20 needs the WebSocket flag; newer runtimes provide it natively). This explicitly creates/deletes only its own temporary fixtures.
- Paid mode remains beta/off locally; migration application itself does not enable charging. Production environment and public-user rollout have not been changed. Actual provider receipts and a complete real-provider run remain separate verification gates before claiming production readiness.
