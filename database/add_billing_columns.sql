-- ============================================================================
-- ADD THE MISSING BILLING COLUMNS TO public.projects
--
-- Run this THIRD, after add_project_failure_tracking.sql and
-- harden_projects_rls.sql. Idempotent.
--
-- WHY THIS EXISTS
-- A live check against the database found that `credit_deducted` and `refunded`
-- DO NOT EXIST on public.projects. database/setup_refunds.sql was written but
-- never applied to this project.
--
-- Consequences of them being missing (the current state):
--   * Every `.update({ credit_deducted: true })` in the API silently failed.
--   * Every refund guard `.eq('credit_deducted', true)` matched zero rows.
--   * /api/refund's SELECT errored, so it returned 403 for everything.
--     -> Refunds have never actually worked. Users whose runs failed were
--        charged and never refunded, which matches the reports.
--
-- DO NOT run the old database/setup_refunds.sql instead of this file.
-- That script also creates a SECURITY DEFINER function `refund_credit(uuid,uuid)`
-- with NO revoke, which PostgREST would expose as an RPC to every authenticated
-- user — i.e. a one-call unlimited-credits endpoint. The application does not
-- use that function at all (verified: no reference anywhere in src/).
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS credit_deducted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded        boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.projects.credit_deducted IS
  'True once a claw has been charged for this project. Service-role writes only.';
COMMENT ON COLUMN public.projects.refunded IS
  'True once that charge has been returned. Reset when a new charge is taken.';

-- Refund eligibility is queried as (credit_deducted, refunded, failed_at).
CREATE INDEX IF NOT EXISTS projects_refund_state_idx
  ON public.projects (credit_deducted, refunded)
  WHERE credit_deducted = true;

-- Make sure the dangerous RPC from setup_refunds.sql is not present, in case it
-- was ever applied to another environment. The app never calls it.
DROP FUNCTION IF EXISTS public.refund_credit(uuid, uuid);

-- Existing rows default to credit_deducted = false, i.e. not refundable.
-- That is correct: historical projects must not become eligible for a refund.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
--   SELECT credit_deducted, refunded, failed_at FROM public.projects LIMIT 1;
--     -> should succeed
--
--   SELECT count(*) FROM public.projects WHERE credit_deducted = true;
--     -> expect 0 on first run; the flag starts being set from the next run
-- ============================================================================
