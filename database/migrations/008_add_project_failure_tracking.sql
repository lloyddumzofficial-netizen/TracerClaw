-- ============================================================================
-- ADD FAILURE TRACKING TO public.projects
--
-- Run this once in the Supabase SQL editor. It is idempotent.
-- Run it BEFORE deploying the matching code change.
--
-- WHY
-- /api/refund used to grant a Claw whenever a project was in the state
--   credit_deducted = true AND refunded = false
-- but that is exactly the state a SUCCESSFUL run leaves behind. A user could
-- finish a generation, POST their own projectId, get the Claw back, and keep
-- the output (svg_url / upscaled_image_url were never cleared).
--
-- Refund eligibility now requires positive evidence that the pipeline failed.
-- The server stamps failed_at in its catch blocks; nothing else may set it.
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_step TEXT;

-- Partial index: refund lookups and any "which runs failed" reporting only ever
-- care about the small subset of rows that actually failed.
CREATE INDEX IF NOT EXISTS projects_failed_at_idx
  ON public.projects (failed_at)
  WHERE failed_at IS NOT NULL;

COMMENT ON COLUMN public.projects.failed_at IS
  'Set by the server when a paid pipeline run fails. Refunds require this to be non-null. Cleared when a new run starts.';
COMMENT ON COLUMN public.projects.failed_step IS
  'Which step failed (step1 | step2 | step3 | remove-bg | upscale). Diagnostics only.';

-- Existing rows stay NULL, i.e. not refundable. That is the correct default:
-- historic completed projects must not become eligible for a refund.

NOTIFY pgrst, 'reload schema';
