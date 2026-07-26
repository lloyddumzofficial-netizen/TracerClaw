-- ============================================================================
-- FIX: anon can still SELECT every project
--
-- Run this FIFTH. Idempotent. Read the NOTICE output it prints.
--
-- STATE AFTER enable_projects_rls.sql (verified with the public anon key):
--   anon UPDATE  -> 42501 permission denied   (fixed)
--   anon DELETE  -> 42501 permission denied   (fixed)
--   anon SELECT  -> still returns all 2,442 rows   (NOT fixed)
--
-- The UPDATE/DELETE revokes landed, so the previous script definitely ran and
-- committed — which means RLS is enabled and something is still permitting the
-- read. Postgres combines policies with OR, so a single leftover permissive
-- SELECT policy (for example Supabase's "Enable read access for all users"
-- template, USING (true)) overrides the restrictive one. The previous script
-- dropped policies BY NAME, so any policy with a different name survived.
--
-- This script drops EVERY policy on public.projects regardless of name, then
-- recreates only the three correct ones.
--
-- Safe: nothing needs anonymous read access to projects. /api/reviews — the one
-- feature that surfaces other users' project rows publicly — goes through
-- adminSupabase (service role), which bypasses RLS entirely.
-- ============================================================================

DO $$
DECLARE
  pol record;
  rls_on boolean;
BEGIN
  SELECT relrowsecurity INTO rls_on
  FROM pg_class WHERE oid = 'public.projects'::regclass;
  RAISE NOTICE 'RLS enabled before: %', rls_on;

  FOR pol IN
    SELECT policyname, cmd, roles, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects'
  LOOP
    RAISE NOTICE 'dropping policy: "%"  cmd=%  roles=%  using=%',
      pol.policyname, pol.cmd, pol.roles, pol.qual;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.projects', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_own"
  ON public.projects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "projects_insert_own"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "projects_delete_own"
  ON public.projects FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- No UPDATE policy: updates are service-role only.
REVOKE UPDATE ON public.projects FROM authenticated, anon;
REVOKE INSERT, DELETE, SELECT ON public.projects FROM anon;

NOTIFY pgrst, 'reload schema';

-- Report the final state.
DO $$
DECLARE
  pol record;
  rls_on boolean;
BEGIN
  SELECT relrowsecurity INTO rls_on
  FROM pg_class WHERE oid = 'public.projects'::regclass;
  RAISE NOTICE '--- final state ---';
  RAISE NOTICE 'RLS enabled: %', rls_on;
  FOR pol IN
    SELECT policyname, cmd, roles FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects'
    ORDER BY policyname
  LOOP
    RAISE NOTICE 'policy: "%"  cmd=%  roles=%', pol.policyname, pol.cmd, pol.roles;
  END LOOP;
END $$;

-- ============================================================================
-- Please paste the NOTICE output back — the "dropping policy" lines identify
-- exactly which policy was leaking, which is worth knowing.
--
-- VERIFY afterwards: anon SELECT must return [], and a signed-in user must
-- still see their own projects in the dashboard and workspace.
-- ============================================================================
