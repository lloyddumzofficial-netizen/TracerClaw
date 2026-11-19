# DesaynClaw — Critical Reliability and Release Plan

Prepared: 2026-11-18. Status: implementation plan, not a claim that the fixes below have shipped.

## Outcome and boundaries

Users should be able to upload a supported image, close the browser, return to a completed or recoverable project, and export their accepted artwork without accidental public exposure or duplicate Claw deductions. Failures must have a clear status, bounded recovery, and a documented financial outcome.

The objective is fewer defects, smaller failure impact, and early regression detection. Zero future bugs is not a credible release promise.

Keep the existing Next.js application, Supabase ownership/billing records, R2 assets, fal models, shared project manager, editor, and payment integrations. Preserve the approved Obsidian/Carbon/Graphite UI, artwork colors, English interface text, and current access rules. Do not change production AI prompts, replace models, expand public access, enable charging, or deploy merely because this plan exists.

Start with Design Extract, where the critical failures are evidenced. Run cross-product regression checks for Garment Extract, Logo Vectorizer, Pattern Rebuilder, Background Remover, Image Upscale, mobile handoff, project management, and payments. Extend shared changes only where inspection demonstrates the same failure.

## Confirmed baseline

| Evidence | Current result | What it does not prove |
| --- | --- | --- |
| Full unit/API suite in this worktree | 463 tests passed in the preceding review | Live AI quality or deployed behavior |
| Design Extract browser tests | Opening, animation movement, editing, recovery, and PNG/ZIP/PSD structure tested | All providers and authentication are live; browser suites use mocks |
| Live migration 039 | Billing and dispatch columns and exact-signature RPCs verified | Production app environment parity |
| Isolated live billing test | Concurrent claims, one dispatch winner, one-time refunds, prices 2/2/1, insufficient funds and ownership/revision checks passed | Real provider charges or a completed paid user session |
| Live private R2 test | Signed PUT/GET, CORS preflight, anonymous denial, and probe cleanup passed | Existing public links have been revoked |
| Image-size reproduction | A supported 9 MP, 6.66 MiB JPEG normalized to a 25.05 MiB PNG | Every large input will expand by the same amount |
| Processing recovery | `maintenance.js` handles only three active jobs per hourly cleanup run | Browser-closed work meets an acceptable latency target |
| Private storage configuration | New writes can fall back to the public bucket when private configuration is absent | Safe production defaults |
| Runtime/clock | Node 20 fixture tooling needed native WebSocket support; host was approximately 80 seconds behind R2 | Production has the same runtime or clock problem |
| Release lint | Application lint passed when `.tmp/**` was excluded; default lint scanned downloaded temporary dependencies | A clean unmodified release gate |

Source locations: `src/server/designExtract/{service,storage,maintenance,enhancement,billing}.js`, `src/app/api/upload-{url,direct}/route.js`, `src/lib/{uploadLimits,healthChecks}.js`, `vercel.json`, `eslint.config.mjs`, `.github/workflows/release-checks.yml`, and `docs/design-extract-launch-audit.md`.

## Implementation sequence

### 1. Block accidental public writes — critical

**Change**

- Require a separate, valid private bucket for every new Design Extract source, layer, mask, enhancement input, and generated result in all environments. Missing configuration returns a safe 503 before accepting an upload or reserving Claws.
- Remove the public-write fallback from the Design Extract adapter and both generic upload routes' `purpose=design_extract` branches. Other tools retain their existing storage behavior.
- Keep owner-checked, allowlisted legacy reads for existing projects. Copy an owned legacy source into the project's private prefix before a new operation; never send an arbitrary client URL to the provider.
- Check project ownership and expiry on every asset/export/version/mask operation, including immutable base and enhanced variants. Do not route signed private URLs through the public image cache proxy.
- Keep short-lived signed image URLs in user-scoped memory only. On an expired image link, refresh authorized project URLs once; do not start an extraction or discard unsaved editor state.
- New writes must fail closed even in free beta. Free processing is not permission to publish artwork.

**Legacy asset treatment**

Inventory references by owner and project. Copy required files into private storage, update manifests under revision protection, and validate exports. Delete or purge a previous public object/cache only when it is owned, unshared, and covered by the intended deletion policy. Do not delete shared Garment assets when migrating a Design Extract reference. Previously downloaded copies cannot be revoked; do not describe this as retroactive perfect privacy.

**Exit tests**

Missing/malformed/same-as-public bucket; direct and fallback uploads; cross-user source/layer/mask/export access; path traversal; expired project; signed-link expiry while editing; sign-out cache clearing; legacy Garment-to-Design handoff. Assert there is no public `PutObject` or public upload signature for a Design Extract write.

### 2. Separate upload limits from processing limits — critical

**Change**

- Keep the user upload limit at 20 MiB and the current 24 MP decoded-image limit. Validate bytes, decoded format, dimensions, and orientation before a paid claim.
- Introduce one explicit asset policy shared by ingestion, source reading, layers, masks, enhancement inputs/results, and exports. Do not change the global SSRF defaults for unrelated features.
- Initial internal PNG cap: 100 MiB, with the existing 24 MP decoded limit and 8192-pixel enhancement edge limit. This accommodates an 8-bit RGBA 24 MP frame plus PNG overhead; reject unsupported depth/dimension combinations deliberately rather than relying on compression.
- Use the upload cap for unvalidated incoming staging/legacy upload bytes, and the internal cap only for verified project assets or allowlisted provider results. Enforce streamed byte counts even when Content-Length is absent or false.
- Validate normalized output before committing a usable project. A normalization failure leaves a recoverable creation error and cleanup coverage, with no AI submission or Claw reservation.
- Bound per-worker decoding concurrency. Avoid multiple full-resolution raw buffers being decoded concurrently. Measure peak memory in the actual function memory tier before retaining the proposed caps.
- Preserve native dimensions, original RGB for source-pixel cutouts, alpha coverage, and composition offsets. Do not silently downscale artwork to make a limit test pass.
- Preflight browser PSD limits using the existing aggregate-pixel guard. Show the supported export choices before export starts; keep PNG/ZIP available when a PSD exceeds the safe memory budget.

**Exit tests**

Reproduce JPEG-below-20-MiB/PNG-above-20-MiB through project creation, segmentation, mask edits, variants, and exports. Include transparent PNG, EXIF rotation, near-24-MP inputs, malformed/truncated images, invalid depth, decompression bombs, missing/incorrect Content-Length, exactly-at-limit and one-byte-over-limit cases. Rejected inputs cause zero AI calls and zero charges. Run concurrent large-image tests and record peak memory.

### 3. Run processing independently of the browser — critical

**Architecture decision**

Use a Vercel Workflow to orchestrate the existing Design Extract job stages. Keep Supabase as the authoritative document, operation, ownership, and financial store. Workflow persistence owns wakeups and crash recovery; it must not become a second independent billing system.

This change is necessary because one operation has multiple provider waits, storage writes, enhancement stages, and final settlement. Advancing these stages once per hourly cleanup run is insufficient. The browser should display state, not be required to drive computation. Vercel documents Workflows for this kind of multi-step work that must survive crashes and deployments: https://vercel.com/docs/workflows .

Before implementation, confirm the linked Vercel project's runtime, region, product availability, limits and usage budget, pin a compatible Workflow SDK version, and read that installed version's bundled Next.js integration docs. Do not assume beta/experimental APIs are unchanged or provision paid resources silently.

**Durable path**

1. Validate access, upload, source ownership, revision, operation limits and acknowledged price.
2. Atomically record the job, its billing reservation where applicable, and an outbox entry in Supabase.
3. Start a workflow using only the operation ID; record the workflow run ID. A leased outbox dispatcher retries a missed start after a crash.
4. Load trusted operation data inside worker steps. Persist the existing dispatch marker before any paid provider POST. Replayed or duplicate workflow starts must not issue another paid request.
5. Poll only a recorded provider receipt with durable waits and bounded backoff. Store assets in R2 before advancing the saved stage.
6. Preserve base previews while enhancing; checkpoint each enhancement independently and retain its fallback behavior.
7. Finalize ready outputs and billing exactly once. Automatically accept only an initial `extract` result; retain explicit review for refinements. A ready refinement can finish its background work without waiting indefinitely for the user to review it.
8. Let the browser read snapshots and request a safe wakeup/reconciliation of the same operation. Refresh/reopen never creates another generation.

**Safety rules**

- Treat delivery/replay as potentially duplicated. A provider POST is not automatically retryable merely because the workflow runtime retries steps. Preserve one-shot generation and enhancement submission markers.
- Retry safe provider-status reads and deterministic storage writes; classify ambiguous POST outcomes as uncertain. Do not manufacture another request to escape uncertainty.
- Use an additive migration after 039 for outbox entries, workflow ownership/lease fields, due time, last progress, and service-only claim/acknowledgement RPCs. Do not edit already-applied 039. Grant no new client-side table privileges.
- Worker and financial locks have different meanings: a processing lease may expire and be reclaimed; a paid-submission marker must never be cleared automatically to permit a second POST.
- Workflow messages, arguments, return values and logs contain IDs/stage summaries only. Do not put pixels, signed image URLs, secrets, or private documents in workflow history.
- Start with bounded per-user fairness and worker concurrency, then validate a staging load of at least ten simultaneous projects. Older stuck jobs must not monopolize every worker slot.
- Proposed whole-operation hard deadline: 45 minutes. Keep the existing per-enhancement 20-minute deadline within that overall budget. At the hard deadline, deliver usable saved base layers with a clear enhancement fallback; if no usable output was saved, close delivery and refund once. Late provider results cannot revive a refunded job or trigger another charge. Validate these thresholds against real provider runs before paid rollout.
- Keep expiry/asset cleanup separate from the processing driver. A scheduled watchdog repairs missed outbox starts, detects abandoned leases and retries settlements; it is not the normal per-stage engine.
- Confirm the hosting plan supports the watchdog cadence. Vercel's documented cron limits differ by plan; do not blindly replace the hourly expression with an unsupported minute schedule: https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing .

**Exit tests**

Close the tab immediately after submit; terminate a worker at every boundary; interrupt the database after reservation; lose the provider receipt; retry identical queue/workflow delivery; interrupt R2 after one layer; restart during enhancement; simulate provider 429/5xx, database outage and deployment replacement. Every case has one bounded terminal/recoverable outcome, at most one paid POST per intended operation, one charge, and at most one refund.

Under the staging baseline, target p95 less than 60 seconds from a provider-completed stage to its persisted next stage, excluding provider queue time and a declared dependency outage. This is a test target, not a current performance claim. A closed browser must not change the outcome.

### 4. Make readiness visible before enabling a feature — high

**Change**

- Extend existing health checks instead of adding a second health system. Add conditional checks for Design Extract private storage, required schema/RPC signatures, billing mode/price version, workflow delivery, last watchdog execution, and outstanding settlement age.
- Keep public health responses non-sensitive. Restrict detailed diagnostics to the existing protected operator surface; return booleans/safe codes, never credentials, signed URLs, balances or private job payloads.
- Separate read/export availability from AI-write readiness. A dependency failure should disable new paid operations while preserving available saved documents.
- Correct local clock synchronization and standardize local, CI and deployment runtimes. Start from CI's existing Node 22 configuration; verify dependency support before pinning production. Do not update every dependency or rewrite authentication as part of this fix.
- Keep short-lived signing lifetimes; diagnose clock skew rather than making links long-lived. Test fresh signing, expiry and safe refresh. R2 signatures are temporary bearer access, not owner checks by themselves: https://developers.cloudflare.com/r2/api/s3/presigned-urls/ .
- Add structured metrics for stage duration, no-progress age, outbox age, active processing, usable/fallback layers, refunds, held reservations and cleanup failures. Reuse the existing logger/Sentry setup and redact sensitive fields.
- Initial alert targets: workflow/outbox without progress for five minutes; watchdog older than two configured intervals; terminal failed job with a held reservation after five minutes; any private-storage readiness failure. Provider queue duration alone must not trigger duplicate submission.

**Exit tests**

Remove one feature dependency at a time; verify a useful operator signal and safe user recovery. Simulate clock skew, expired signatures, a missing migration, stopped delivery, expired leases, and failed refund acknowledgement. No secret values appear in public errors, analytics, logs, or screenshots.

### 5. Qualify real output quality and Claw economics — high

- Use a consented dataset covering jerseys, small text/numbers, logos, festival posters, overlapping subjects, transparent art, repeated patterns, tall layouts and high-resolution Garment outputs. Keep fixtures private and scoped to their owners.
- Record source/native/enhanced sizes, alpha validity, layer order, missing/duplicated elements, changed text/logo geometry, composition alignment, total provider cost, enhancement compute billing where available, and completion/failure times.
- Compare original-pixel extraction separately from AI reconstruction. Require exact RGB preservation for source-pixel cutouts and mask edits, verified by pixel tests. Do not call upscaling recovered original detail.
- Review difficult cases at 100% detail. Incorrect text or damaged logos cannot be presented as production-ready editable text; keep raster/version information and correction tools clear. Automatic acceptance of initial layers does not remove quality review or immutable source/base versions.
- Keep the selected 2/2/1 tariff and free manual editing/export policy while measuring. Confirm positive margin from actual receipts, including enhancement failures and platform overhead, before enabling paid rollout. Never silently reprice an operation already reserved.
- Publish qualification results as passed, limited or failed by artwork category. No claim that every flattened design can be perfectly separated. A failed quality gate keeps the feature in beta; prompt/model changes require a separately reviewed, explicitly authorized change.

**Exit tests**

Run a complete real-provider project from Garment output to extraction, refinement, refresh and exported PNG/ZIP/PSD. Inspect PSD in Photoshop or Photopea as well as the parser checks. Measure actual provider receipts; mocked browser success is not a substitute for this gate.

### 6. Make regressions block release — high

- Exclude `.tmp/**` and other generated test artifacts from lint/build packaging; do not disable application lint rules to obtain a green result.
- Keep the existing CI release workflow, and make its successful checks required for the deployment path actually used. `test:release` existing in package.json does not protect a manual deploy that bypasses it.
- Add the reproduced large-image, missing-private-bucket, replay/crash, stale-processing and signing-expiry cases to regression tests. Retain the existing 463-test baseline while adding meaningful failure tests; test count itself is not the release criterion.
- Build the production bundle in a clean checkout/artifact environment so the active localhost:3000 dev server is not disrupted. Verify schema compatibility and deployed build identity; do not deploy an unidentified dirty worktree.
- Keep live fixture tests explicitly opt-in, scoped to disposable non-admin accounts, with cleanup verification. Never touch real balances or disable CAPTCHA to make tests pass. Full authenticated session testing uses the normal login flow.
- Update the launch audit into a current status summary with historical evidence clearly separated, so resolved migration/storage issues are not mistaken for current blockers.

**Cross-product smoke matrix**

| Surface | Required behavior |
| --- | --- |
| Sign-in and mobile upload | Normal CAPTCHA/auth, expired-session recovery, desktop/mobile handoff; no blank screen |
| Project manager | Create, rename, search, open, delete/expiry, correct tool thumbnail labels |
| Garment Extract | Crop, extraction, upscale, SVG, compare, downloads, Design Extract handoff |
| Logo / Pattern | Correct tool guidance, engine selection, costs, palette and SVG export |
| Background Remover / Upscale | Upload limits, usable output, failure recovery, correct Claw/refund behavior |
| Design Extract | Open, browser-closed completion, selection, masks, undo/redo, variants, autosave, cursor zoom/pan, all exports |
| Payments | Existing signed webhook validation, duplicate-event idempotency, expected crediting, failed/cancelled checkout; no checkout rewrite |
| Privacy and retention | Cross-user denials, expired links/projects, cleanup retries, financial evidence retained until settled |
| UI | Approved palette, readable states, visible motion and reduced-motion behavior, keyboard focus, no toolbar clipping |

## Change packages and dependencies

| Package | Scope | Gate before merging |
| --- | --- | --- |
| A | Private-write fail-closed behavior and legacy-read compatibility | No Design Extract public writes; existing other-tool uploads unchanged |
| B | Shared image policy and large-file/export preflight | Reproduced 6.66-to-25.05-MiB case works end to end within memory budget |
| C | Conditional health checks, runtime/clock checks, lint exclusions | Missing dependencies detected safely; clean release lint/build |
| D | Workflow/outbox migration and processor adapter | Crash/replay/load tests pass; billing remains idempotent |
| E | Browser read/wakeup integration, watchdog fairness and deadlines | Closed-tab/deployment recovery passes; no second provider POST |
| F | Real AI qualification, production configuration and smoke report | Receipt/quality evidence, rollback rehearsal, no unresolved critical failures |

A and B are the first production-risk fixes. C supplies monitoring before D/E are enabled. D/E must run behind a processing-driver flag until verified. F validates the assembled system. Do not bundle unrelated UI redesigns, payment changes or model experiments into these packages.

## Rollout and rollback

1. Apply additive schema changes and deploy backward-compatible readers first. Verify RPC signatures and privileges against the deployed database.
2. Deploy the code with charging/public access unchanged. Readiness must fail closed for new AI work if private storage or worker delivery is unavailable.
3. Assign a processor version/driver when each operation is claimed. Exactly one driver owns a job. Initially route only new internal/admin test jobs to the workflow; do not simultaneously let browser, cron and workflow drive the same state machine.
4. Keep legacy in-flight jobs on their recorded driver until terminal, or transfer them under an atomic lease/version handoff. Never infer that an existing paid provider request should be submitted again.
5. Test at least ten simultaneous projects, all failure scenarios above, and one production-equivalent real-provider flow. Target a 48-hour internal observation period containing representative work before broader access; elapsed time without work is not verification.
6. Enable broader access or paid mode only as explicit release decisions after the relevant gates pass. Do not combine those decisions with a visual deployment.
7. On a regression, stop accepting new affected AI work, keep readable/exportable documents available, and let already-submitted jobs reconcile through their recorded receipts. Retain ledger, outbox and private data needed for recovery.
8. Roll back the processor code/flag using the recorded compatible driver. Do not roll back to public writes, remove billing evidence, clear submission markers or apply destructive schema downgrades. Preserve safe refunds and ownership rules.

## Definition of ready

All of the following require attached evidence, not an assertion that the code looks correct:

- New Design Extract assets remain private even when configuration is missing or broken.
- Supported inputs below the upload limit can be normalized, processed and exported within documented resource limits.
- Closing the browser or restarting a worker does not strand a valid job or duplicate a paid provider request.
- Every operation has one recorded charge outcome and at most one refund; deadlines and late results have a deterministic policy.
- Missing dependencies, stale work, settlement problems and cleanup failures are visible to operators without exposing private content.
- Regression tests, production build, live storage checks, live isolated billing checks, normal authenticated-session tests and the cross-product smoke matrix pass.
- Real AI quality, export usability and actual provider-cost evidence pass the qualification gate.
- Deployment configuration, runtime, applied schema and build identity match the verified release.
- Rollback has been rehearsed without exposing assets, deleting financial evidence or resubmitting uncertain jobs.

This plan is complete when those implementation and verification tasks are unambiguous. The product is ready only when their evidence exists. Preparing the plan does not mark the underlying fixes complete.
