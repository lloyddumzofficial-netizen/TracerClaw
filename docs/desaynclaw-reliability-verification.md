# DesaynClaw reliability verification

> Design Extract configuration/status below includes historical checkpoints. Use [the current predeployment audit](design-extract-predeploy-audit-2026-11-19.md) for current paid billing, processors, security fixes and release gates.

Date: 2026-11-18. Implementation is in the local checkout. No deployment, paid-mode activation, or public-access expansion has been performed.

## Implemented

- Private-only Design Extract writes in beta and paid modes. Missing, malformed, or shared-public bucket configuration fails closed before signing uploads or reserving Claws. Owned legacy reads remain compatible; AI inputs copied from owned legacy storage use the private project prefix.
- Separate 20 MiB upload and 100 MiB internal-asset caps, with 24 MP/8-bit validation. The supported JPEG-to-PNG expansion case succeeds without reducing dimensions. Source masks, manual masks, enhancement validation, and provider outputs use the image policy.
- Bounded per-process decoded-image work, bounded waiting queue, safe overload response, sequential layer processing, and per-user workflow leases. These are safeguards, not a production memory-tier measurement.
- Read-only document snapshots; workflow jobs are advanced by server steps, not browser polling. The legacy driver continues to own preexisting jobs.
- Additive migration 040: transactional outbox, leased delivery, per-user step limit, stale-run replacement generations, service-role-only functions. Migration 039 remains the authoritative fixed-price ledger.
- Deterministic workflow start tokens, generation/token/expiry-fenced checkpoints, single-attempt provider submissions, enhancement compare-and-swap checkpoints, terminal settlement recovery, and a 45-minute overall deadline. Unusable outputs refund; saved usable base layers survive enhancement failure. Initial extraction autoaccepts; refinements retain explicit review.
- Dedicated bounded watchdog at `/api/cron/design-extract`, scheduled every two minutes. It is independent of asset cleanup. Frequent-cron eligibility still needs verification for the deployment's Vercel plan.
- Shared PSD preflight before downloading layer files; PNG and ZIP remain available above the PSD budget. The export worker repeats the guard.
- Conditional protected health checks for private configuration, schema, overdue settlements, pending starts, and stale worker heartbeats.
- Node 22 runtime pins, temporary/generated lint exclusions, and `prebuild` lint/unit/API/migration/PostgreSQL checks. CI browser tests use `next start` after a production build.
- Fixed the shared panel style overriding Edit Artwork's existing animated outline. Updated stale browser fixtures to respect the crop guide, current privacy setup, and the requested Mary S. name.

## Evidence

| Check | Result | Limits |
| --- | --- | --- |
| Unit/API suite | 511 tests across 68 files passed | Providers and external authorization are mocked where indicated |
| Local PostgreSQL execution | Migrations 038–040 passed billing/outbox/lease/generation/privilege checks | In-memory PostgreSQL; not a production load test |
| Live migration 040 | Job/outbox columns queried; exact-signature nonexistent-job claim returned `obsolete` | No provider call or real-job mutation |
| Live background canary | Ten isolated workflows completed through local Workflow runtime + live Supabase in about 20 seconds, without a browser | Fixtures already contained usable output; zero fal POSTs and zero Claws |
| Canary cleanup | Temporary account/projects/jobs/outbox removed | No existing accounts or balances touched |
| Private R2 recheck | Signed PUT/GET, actual CORS preflight, anonymous denial, and probe cleanup passed | Public-domain/lifecycle settings were verified separately in the earlier dashboard audit |
| Release build | Node 22 production build passed, including compiled workflow routes and 80 pages | Not a deployed Vercel smoke test |
| Browser regression | Production-build sweep: 115/117 passed; the two failed scenarios passed targeted rechecks after deterministic privacy/keyboard setup | This is an aggregate result, not a single all-green sweep; mocked auth/provider flows do not prove live paid-session behavior |
| Live billing after 040 | Eight concurrent claims: one charge; eight refunds: one refund; prices 2/2/1, owner/revision/no-funds checks and cleanup passed | No fal calls and no existing balances touched |
| Protected local deep health | HTTP 200; all dependency checks passed after user restored fal balance | The earlier fal 403/exhausted-balance blocker is resolved; this is not a new generation receipt |

Reproduce local checks with Node 22:

```text
npm run build
PLAYWRIGHT_PRODUCTION=1 npm run test:e2e
node scripts/verify-design-extract-live-processing.mjs --allow-test-fixtures
node scripts/verify-design-extract-live-billing.mjs --allow-test-fixtures
node scripts/setup-design-extract-private-storage.mjs --objects-only
```

The environment assignment above uses POSIX notation; in PowerShell use `$env:PLAYWRIGHT_PRODUCTION='1'`. Live fixture scripts require the existing ignored local credentials, never print them, and delete only their own fixtures. The workflow canary targets localhost and refuses to run while other active workflow jobs exist. Do not run it against production.

## Remaining release gates

1. **Production runtime/configuration:** the linked Vercel project reported Node 24; this checkout was validated on Node 22. Confirm the runtime of the actual release, system deployment ID availability, workflow region/limits, frequent-cron eligibility, usage budget, private bucket configuration, and protected deep health. Do not upgrade an account plan or deploy automatically.
2. **Real provider pipeline and cost:** historical Qwen qualification files contain four RGBA outputs each, but poster examples kept most content grouped and included screenshot UI fragments. They fail the claim of reliably extracting every design element. Requalify clean artwork through the assembled workflow, inspect source/result and exports, and attach actual fal billing receipts. Old sample reports do not prove current pipeline quality or billed cost. No prompts/models were changed in this reliability work.
3. **Normal authenticated session:** the user completed normal admin sign-in in the live-test browser; account/project-manager access was observed without bypassing CAPTCHA. The browser tool captured the Design Extract file chooser, but its local-file transfer failed twice with an expired tool continuation, leaving the homepage with no completed new upload observed. A new signed-in upload → provider → refresh → export flow therefore remains unverified. Do not count the failed transfer as an application extraction failure or as a successful provider test.
4. **Production resources:** measure 24 MP ingestion, segmentation, masks, enhancement, and PSD preparation within the deployed memory tier, including concurrent work. Local queue limits are not equivalent evidence.
5. **Security advisories:** after compatible Vitest/coverage/ESLint patches, npm audit still reports 34 dependency advisories (26 high, 8 moderate, zero critical), including propagated dependency findings. Remaining root causes include glob/minimatch, picomatch, and nested Zod. The latest checked picomatch is still in the reported affected range. Do not force npm's suggested Workflow downgrade from 5.x to 2.x or silently override Zod major versions. Review reachability and verified upstream fixes before public release. See the [picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), and [patched Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
6. **Device clock:** this Windows host is approximately 81 seconds behind R2; Windows Time is stopped and service start was denied by the OS. Correct normal Windows time synchronization with device-admin access. Do not extend signed-link lifetimes to hide skew. Production clock has not been shown to share this issue.
7. **Observation and rollback:** rehearse deployed workflow interruption/recovery and processor rollback while retaining submission markers and financial evidence, then perform the planned representative internal observation period before a separate paid/public decision.

## Safe activation and rollback

Keep `DESIGN_EXTRACT_BILLING_MODE=beta` and current admin-only access. The ignored local configuration now explicitly sets `DESIGN_EXTRACT_PROCESSOR=legacy`; migration application alone does not switch it. The temporary, credential-free `.env.development.local` used for internal live qualification was removed after the browser transfer failure. Protected health confirmed HTTP 200, beta billing, and the legacy driver afterward. Enable workflow for normal use only after its environment-specific gates pass. Existing jobs retain their recorded processor. A rollback stops routing new jobs to workflow while letting recorded workflow jobs reconcile, even if new submissions are disabled; it must not erase dispatch markers, drop the additive schema, revert to public writes, or replay uncertain paid requests.

Temporary production-test server cleanup could not be independently confirmed: an elevated process/listener verification was not executed because automatic approval review hit its usage limit. This was a review-service failure, not a safety rejection. The existing development server on port 3000 was not intentionally stopped.
