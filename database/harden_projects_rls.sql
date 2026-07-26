-- ============================================================================
-- HARDEN ROW LEVEL SECURITY ON public.projects
--
-- Run this once in the Supabase SQL editor. It is idempotent.
--
-- WHY
-- The original policies in setup_auth.sql had three defects:
--
--   CREATE POLICY "Users can update own projects" ON public.projects FOR UPDATE
--     USING (auth.uid() = user_id OR user_id IS NULL);
--
--   1. No column restriction. The browser holds the anon key, so a user could
--      run  update({ refunded: false, credit_deducted: true })  on their own
--      project and replay /api/refund for unlimited free Claws.
--   2. No WITH CHECK. A user could rewrite user_id — claiming an orphaned row,
--      or handing their own row to someone else.
--   3. "OR user_id IS NULL" let ANY authenticated user read, update and DELETE
--      every orphaned project in the table.
--
-- AFTER THIS MIGRATION
-- Clients may still read and delete their own projects, and insert new ones,
-- but may no longer UPDATE the table at all.
--
-- Checked before writing this: every "use client" file that touches `projects`
-- only ever calls .select() — src/app/workspace/[id]/page.js:99,
-- src/app/bg-remover/[id]/page.js:49,95, src/app/page.js:332,
-- src/app/upscale/page.js:85. There is no client-side update/insert/delete.
-- All writes go through server routes using the service role key, which
-- bypasses RLS: /api/save-asset, /api/trace, /api/trace-step3, /api/crop,
-- /api/project, /api/refund, /api/remove-bg, /api/prepare-zip, /api/upload.
-- ============================================================================

BEGIN;

-- ── Replace the four permissive policies ────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own projects"   ON public.projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;

-- Read: own rows only. The "OR user_id IS NULL" escape hatch is gone.
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

-- Insert: may only create rows owned by yourself.
CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Delete: own rows only.
CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

-- Update: intentionally NO policy. With RLS enabled and no UPDATE policy,
-- every client UPDATE is denied. Belt and braces at the grant level too:
REVOKE UPDATE ON public.projects FROM authenticated, anon;

COMMIT;

-- ── Orphaned rows ───────────────────────────────────────────────────────────
-- Rows with user_id IS NULL are now invisible to every client (service role can
-- still see them). Check whether any exist before assuming this is a no-op:
--
--   SELECT count(*) FROM public.projects WHERE user_id IS NULL;
--
-- If that returns 0, nothing further is needed. If it returns more than 0,
-- those are legacy rows from before user_id was required; they were previously
-- readable and deletable by ANY logged-in user, which is precisely the hole
-- being closed. Decide whether to reassign or delete them.

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (run as a normal logged-in user, from the browser console)
--
--   await supabase.from('projects').update({ refunded: false }).eq('id', '<own-id>')
--     -> expect an error / zero rows affected
--
--   await supabase.from('projects').update({ user_id: '<other-uuid>' }).eq('id', '<own-id>')
--     -> expect an error / zero rows affected
--
--   await supabase.from('projects').select('*')
--     -> still returns your own projects
-- ============================================================================
