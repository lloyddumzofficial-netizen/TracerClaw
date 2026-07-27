-- ============================================================================
-- ADD THE MISSING INDEXES ON THE HOT QUERY PATHS
--
-- Run this once in the Supabase SQL editor. Idempotent.
--
-- WHY
-- public.projects has no index on user_id, yet EVERY client read and EVERY
-- server-side ownership check filters on it:
--
--   .eq('id', projectId).eq('user_id', user.id)      -- /api/trace, /api/crop,
--   .eq('user_id', userId).order('created_at', ...)  -- /api/prepare-zip, etc.
--
-- At 2,400+ rows that is a sequential scan per check, and the trace pipeline
-- performs 4-6 of them per generation. The same gap exists on payment_requests,
-- which /api/payments/gcash/submit queries twice on every submission.
--
-- The only indexes that exist today are the two partial refund-state ones and
-- the dodo_payments set.
--
-- Plain CREATE INDEX, deliberately NOT CONCURRENTLY.
--
-- The Supabase SQL editor submits a whole script as a single transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block — it fails
-- with "ERROR: 25001". At this data size that trade-off costs nothing:
-- public.projects is ~2.4k rows and public.payment_requests ~400, so each index
-- builds in milliseconds. CREATE INDEX takes a SHARE lock, which blocks writes
-- but not reads, for that brief moment.
--
-- If these tables ever grow to the point where a moment of blocked writes
-- matters, build them with CONCURRENTLY instead — but then you must run each
-- statement separately over a direct psql connection, not through the SQL
-- editor.
-- ============================================================================

-- Ownership checks and "my projects" listings.
CREATE INDEX IF NOT EXISTS projects_user_id_idx
  ON public.projects (user_id);

-- The dashboard and the studio pages page by newest-first within a user.
CREATE INDEX IF NOT EXISTS projects_user_created_idx
  ON public.projects (user_id, created_at DESC);

-- The nightly cron scans oldest-first across the whole table.
CREATE INDEX IF NOT EXISTS projects_created_at_idx
  ON public.projects (created_at);

-- The ZIP cache sweep only cares about rows that actually have a cached ZIP.
CREATE INDEX IF NOT EXISTS projects_zip_generated_at_idx
  ON public.projects (zip_generated_at)
  WHERE zip_url IS NOT NULL;

-- /api/payments/gcash/submit: pending-request check and duplicate-reference
-- check, both scoped to one user.
CREATE INDEX IF NOT EXISTS payment_requests_user_status_idx
  ON public.payment_requests (user_id, status);

-- The admin dashboard pages by status, newest first.
CREATE INDEX IF NOT EXISTS payment_requests_status_created_idx
  ON public.payment_requests (status, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename IN ('projects', 'payment_requests')
--   ORDER BY tablename, indexname;
--
--   EXPLAIN ANALYZE SELECT * FROM public.projects WHERE user_id = '<uuid>';
--     -> must show an Index Scan, not a Seq Scan
-- ============================================================================
