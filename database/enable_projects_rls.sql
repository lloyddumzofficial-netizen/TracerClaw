-- ============================================================================
-- URGENT: ENABLE ROW LEVEL SECURITY ON public.projects
--
-- Run this FOURTH. Idempotent. This is the most important of the four.
--
-- WHAT WAS FOUND
-- A live probe with the PUBLIC anon key (the one shipped in the browser bundle,
-- readable by anyone who opens devtools) returned:
--
--   projects          anon sees 2440 rows / 2440 total   <-- RLS OFF
--   profiles          anon sees    0 rows / 1764 total       RLS on
--   credit_logs       anon sees    0 rows /  374 total       RLS on
--   payment_requests  anon sees    0 rows /  406 total       RLS on
--   dodo_payments     anon sees    0 rows /   46 total       RLS on
--
-- RLS is enabled on every table EXCEPT projects. So today, with no account at
-- all, anyone can:
--   * read all 2,440 projects — names, user_ids and every R2 image URL
--   * DELETE any project row (a probe DELETE returned 204, i.e. permitted;
--     it matched nothing only because a non-existent id was used)
--
-- WHY THE EARLIER MIGRATION DID NOT CATCH IT
-- harden_projects_rls.sql rewrote the POLICIES and revoked UPDATE. Policies are
-- inert while RLS is disabled on the table, so only the UPDATE revoke took
-- effect — which is exactly what the probe showed (UPDATE denied with 42501,
-- SELECT and DELETE wide open). It assumed setup_auth.sql had already run
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. It had not, the same way
-- setup_refunds.sql had never been applied.
--
-- SAFE TO RUN
-- Nothing depends on anonymous reads of projects:
--   * every client read carries the user's session, so auth.uid() is set and
--     the "view own projects" policy matches
--   * every server route uses the service role, which bypasses RLS
--   * /api/public-stats counts projects via adminSupabase (service role)
-- ============================================================================

BEGIN;

-- The actual fix. Everything else here is defence in depth.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Re-assert the policies so this file is self-sufficient even if
-- harden_projects_rls.sql was not applied.
DROP POLICY IF EXISTS "Users can view own projects"   ON public.projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;

CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

-- No UPDATE policy: all updates are service-role only.
REVOKE UPDATE ON public.projects FROM authenticated, anon;

-- An unauthenticated visitor never has a legitimate reason to write here.
REVOKE INSERT, DELETE ON public.projects FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — with the anon key and NO user session:
--
--   curl "$SUPABASE_URL/rest/v1/projects?select=id&limit=5" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--     -> must return []   (it currently returns real rows)
--
-- Then, signed in as a normal user in the app: your own projects must still
-- load in the dashboard and the workspace.
-- ============================================================================
