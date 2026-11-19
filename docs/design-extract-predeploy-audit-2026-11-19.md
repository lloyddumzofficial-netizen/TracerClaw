# Design Extract predeployment audit — 2026-11-19

Status: predeployment audit and authorized configuration work completed. Local
hardening and regression checks passed. Deployment/promotion qualification is a
separate next step; no code was deployed and the server admin gate is unchanged.
This document supersedes the older Design Extract launch/beta notes.

## Fixes verified in the current checkout

- Bounded mutation JSON: object validation, 256 KiB streamed limit, 10-second
  read deadline; malformed/oversized/stalled requests fail cleanly.
- SVG/upscale response serialization is awaited within sanitized error handling.
- Charging and health checks share the paid default. Fixed tariffs remain
  extraction/split 2 Claws and manual cutout 1 Claw; SVG adds no Claw charge.
- Production limits require distributed Redis and fail closed on outages.
  User limits: reads 120/min, writes 60/min, AI submissions 6/min, new SVG and
  upscale requests 3/min each. One active extraction/refinement per project;
  workflow leases additionally bound per-user concurrent work. Cached conversions
  never resubmit a paid provider POST. Local fallback is not distributed.
- Private uploads/downloads have bounded timeouts. R2 direct upload remains the
  production path for 20 MiB files; decoded images remain capped at 24 MP.
- Export downloads (including PSD reference) are capped at 256 MiB. PSD also has
  native-dimension, decoded-pixel and vector-path/knot limits.
- Exports cancel on navigation, sign-out, expiry or access denial. Workers are
  terminated on success, failure, cancellation and a two-minute timeout. A worker
  cannot be created after its initiating download was abandoned.
- Drag undo is capped at 40 edits. Native mask history stores one coverage byte
  per pixel with a 64 MB/12-step bound. Source RGB is not modified by mask history.
- Native grayscale masks avoid RGBA expansion; opaque RGB masks retain 3 channels.
- Frequent watchdog advances recorded legacy jobs without requiring a browser,
  accepts completed initial extractions and leaves refinements for review.
  Legacy and workflow operations share a 45-minute deadline. Available output is
  retained; empty terminal failures use existing idempotent settlement/refunds.
  Uncertain provider submissions remain reserved for explicit reconciliation.
- Refinement composition now includes the moved/scaled parent transform, keeping
  selected cutouts and split layers aligned in the canvas and exports.
- Delayed project-manager responses cannot repopulate private cards after logout
  or account change. Late profile responses cannot restore the old balance.
- Logs omit raw upstream errors that could contain private URLs.
- Exact-version overrides patch only Zod under @vercel/cli-auth 0.0.1 and
  @vercel/cli-config 0.3.1 to 4.6.7. Workflow remains 5.6.1; no payment SDK,
  production prompt, database schema or access expansion was introduced.

## Evidence and its limits

| Check | Current evidence | Limits |
| --- | --- | --- |
| Full unit/API/integration suite | 605 tests / 78 files passed | Automated fixture coverage |
| Lint | Full ESLint passed | Does not prove runtime behavior |
| Production build | Optimized Next 16.4.6 / Node 22 build passed in isolated output directory | No deployment performed |
| Browser sweep | 30/30 Design Extract scenarios passed in one sweep | Auth/provider responses mocked |
| Real export session | User confirmed PNG, ZIP, PSD downloads worked; Photoshop layers, positions and transparency looked correct | User-reported manual verification |
| Migration integrity | 41 ordered migrations passed | No schema changed by audit |
| Isolated SQL checks | Billing/outbox atomicity, duplicates, ownership, revision checks, refund, leases, fencing and privileges passed | Local PostgreSQL/WASM |
| Live billing | 8 claims: one charge; 8 refunds: one refund; 2/2/1 tariffs; owner/revision/no-funds/anonymous denial passed | Disposable account removed; zero existing balances touched; zero provider calls |
| Live model allowlist | SAM2 auto and point-guided models accepted by installed claim RPC | Nonexistent-project probes; no new jobs |
| Live R2 | SDK/signed upload/read, CORS preflight, anonymous denial and probe deletion passed | Object-only key cannot inspect lifecycle/domain configuration |
| Protected local health | HTTP 200, all checks passed; paid, legacy, schema verified | Local environment, not production |
| Local resource case | Native 24 MP, 32 outputs: latest opt-in run about 11.8 seconds, 459 MiB peak RSS | Synthetic solid-color masks; excludes R2 network time and deployed concurrency |
| Private image processing | Native source RGB/alpha and mask/composition tests passed | Does not promise semantic segmentation quality |

The signed-in Brave session was readable but native input/screenshot transport
failed; no agent-driven export success is attributed to that attempt. The user's
subsequent Photoshop confirmation and automated exports are separate evidence.

## Deployment qualifications and explicit decisions

1. The global live workflow canary remains guarded by real jobs. Read-only checks
   found a six-hour-old free-beta initial extraction with four saved layers and
   a separate manual cutout awaiting review. The user explicitly chose to leave
   the project unchanged. No repair, charge or fixture creation occurred; do not
   rerun the global canary by bypassing this isolation guard. Optional workflow
   rollout remains separate from the configured legacy release path.
2. The user explicitly approved the four preview/production settings. Vercel
   creation succeeded with zero failed entries, and a separate readback verified
   every value and both targets. No existing secret was overwritten. These
   settings take effect on future deployments; no deployment was created.
3. Vercel project settings report Node 24. Package engines constrain Node 22,
   which Vercel documents as overriding project settings for new deployments.
   Verify the actual release runtime, region, frequent-cron eligibility and
   memory tier on a protected preview. No account-plan upgrade is authorized.
4. Moderate dependency findings remain. The refreshed npm report is stored at
   output/design-extract-dependency-audit-final.json. High/critical findings were
   removed by the scoped Zod fix. The remaining findings include build/CLI paths:
   Sentry glob uses build artifacts; queue minimatch uses local route patterns
   with default optimization level 1. No direct glob/minimatch imports were found
   in application source. This is a reachability assessment, not a universal
   declaration of safety. Do not force Workflow 5-to-2 or incompatible overrides.
5. Local host clock remains about 82 seconds behind R2. Actual five-minute signed
   links passed. Correct OS time normally; do not lengthen private link lifetimes.
   Production clock skew has not been established.
6. SAM2 segmentation can still group or fragment artwork, particularly text and
   connected shapes. Preserving/recomposing source pixels is not proof of perfect
   recovery of every original design layer. Keep existing review/refinement tools.

## Verified future-deployment configuration

The following server-only settings were saved and independently read back for
both production and preview after explicit user approval:

| Variable | Release value |
| --- | --- |
| DESIGN_EXTRACT_ENABLED | true (effective with a future deployment) |
| DESIGN_EXTRACT_PRIVATE_BUCKET | desaynclaw-design-extract-private |
| DESIGN_EXTRACT_BILLING_MODE | paid |
| DESIGN_EXTRACT_PROCESSOR | legacy for this qualified path; workflow remains a separate qualified switch |

Retain ADMIN_EMAIL, FAL_KEY, RECRAFT_API_KEY, CRON_SECRET and both Upstash Redis
settings. Retain existing Cloudflare settings; the deployed application key must
have object read/write access to both its existing bucket and the dedicated
private bucket. Do not expose r2.dev or custom-domain access on the private bucket.
Never put credentials in this document, chat, NEXT_PUBLIC variables or git.

After an authorized preview deployment: check protected deep health, runtime and
cron recovery; repeat private upload and real generation/refresh/export; inspect
resource headroom and known-receipt recovery. Promote only that verified build.
Rollback stops new feature submissions while recorded jobs retain their original
processor and financial evidence; it never replays uncertain provider requests.

Primary references:
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/advisories/GHSA-3g3m-2fjr-6pw4
- https://github.com/advisories/GHSA-g3hv-75wg-m249

## Reproducing the optional native-size resource check

This test creates synthetic source/masks in memory and calls no provider, R2 or
database. It runs separately so ordinary CI does not repeatedly allocate the
maximum image size. Peak RSS includes the local test process and is not a
portable production threshold.

PowerShell (from the repository, Node 22):

    $env:DESIGN_RESOURCE_CHECK='1'
    npx vitest run tests/integration/design-extract-resources.test.js --maxWorkers=1

Result: output/design-extract-resources.json. Remove DESIGN_RESOURCE_CHECK from
the environment afterward if running the ordinary suite in the same terminal.

## Additional privacy/export verification

- Delayed project cards are discarded after account changes; the normal project
  manager still opens/uploads/renames its Design Extract documents.
- A navigation-during-download test confirms the request is aborted and no
  exporter starts afterward. A stalled-worker test confirms the two-minute
  timeout terminates the worker and unlocks editor actions.
- Refinement API tests confirm manual cutout and automatic split retain a parent
  at (70,90), scale 2: a native element at (2,1) stays at (74,92), scale 2.

No production prompt, payment integration or database migration was modified.

Final configuration verification: DESIGN_EXTRACT_ENABLED=true,
DESIGN_EXTRACT_PRIVATE_BUCKET=desaynclaw-design-extract-private,
DESIGN_EXTRACT_BILLING_MODE=paid, DESIGN_EXTRACT_PROCESSOR=legacy.
The declined old-project repair remains unperformed. Neither setting variables
nor finishing this predeployment audit deploys code or asserts that a new
production runtime has already been exercised.
