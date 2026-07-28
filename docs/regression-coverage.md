# Regression Coverage

This report tracks automated protection for critical DesaynClaw production flows.

## Protected

| Flow | Coverage | Test file |
| --- | --- | --- |
| User sign in | E2E smoke verifies sign-in modal opens and email field renders. | `tests/e2e/critical-flows.spec.js` |
| GCash credit purchase | API integration verifies pending request creation, reference normalization, and duplicate pending block. | `tests/integration/financial-operations.test.js` |
| Dodo credit purchase | API integration verifies GCash-only plans are rejected and Dodo checkout creates local pending payment before provider checkout. | `tests/integration/financial-operations.test.js` |
| Manual payment approval | API integration verifies atomic approval RPC and post-grant email behavior. | `tests/integration/financial-operations.test.js` |
| Credit refund | API integration verifies successful-output refunds are refused and eligible failures use the atomic refund RPC. | `tests/integration/financial-operations.test.js` |
| Project creation | API integration verifies verified user id, trace type mapping, and project name sanitization. | `tests/api/core-endpoints.test.js` |
| Auto Trace | API contract verifies auth gate; charge-boundary test verifies insufficient credits stop before provider work. | `tests/api/core-endpoints.test.js` |
| Precision SVG | API contract verifies auth gate; charge-boundary test verifies insufficient credits stop before vectorizer provider work. | `tests/api/core-endpoints.test.js` |
| Remove Background | API contract verifies auth gate; regression test verifies already-processed work is blocked before charging. | `tests/api/core-endpoints.test.js` |
| Upscale | API contract verifies auth gate; charge-boundary test verifies insufficient credits stop before queueing provider work; E2E smoke verifies tool renders. | `tests/api/core-endpoints.test.js`, `tests/e2e/critical-flows.spec.js` |
| ZIP export | API contract verifies auth gate on ZIP export endpoint. | `tests/api/core-endpoints.test.js` |
| Download | API contract verifies proxy rejects missing URL; smoke tests verify pages render. | `tests/api/core-endpoints.test.js`, `tests/e2e/production-smoke.spec.js` |
| Delete project | API integration verifies owned-row delete and owned R2 cleanup. | `tests/api/core-endpoints.test.js` |
| Production deployment smoke | Playwright smoke checks core public routes render. | `tests/e2e/production-smoke.spec.js` |

## Still Missing

| Flow | Missing protection | Recommended next test |
| --- | --- | --- |
| Auto Trace provider success/failure | Current tests cover auth and insufficient-credit charge boundary, but not FAL success/failure and refund behavior. | Add mocked FAL + R2 integration tests for Step 1 and Step 2 success/failure paths. |
| Precision SVG provider success/failure | Current tests cover auth and insufficient-credit charge boundary, but not Vectorizer/Recraft success/failure responses. | Add mocked `fetchWithRetry`, Sharp, and R2 tests for standard and precision SVG branches. |
| Remove Background provider success/failure | Current tests cover auth and already-processed no-charge behavior, but not FAL/R2 failure refund behavior. | Add mocked FAL + R2 tests for success and refund-on-failure. |
| ZIP export success | Current tests protect auth only. | Add mocked R2 download/upload test for cached and uncached ZIP generation. |
| Browser-authenticated purchase UX | E2E avoids live Supabase/Dodo. | Add a dedicated staging-only Playwright suite with seeded test users and provider sandbox credentials. |
