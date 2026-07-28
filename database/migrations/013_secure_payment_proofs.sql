-- ============================================================================
-- LOCK DOWN THE payment_proofs STORAGE BUCKET
--
-- Run this once in the Supabase SQL editor. Idempotent.
-- Run it BEFORE deploying the matching code change to /api/admin/get-dashboard.
--
-- WHAT WAS FOUND
-- database/setup_payments.sql created the bucket as PUBLIC and attached an
-- unrestricted read policy:
--
--   INSERT INTO storage.buckets (id, name, public) VALUES ('payment_proofs', ..., true)
--   CREATE POLICY "Anyone can view payment proofs"
--     ON storage.objects FOR SELECT USING (bucket_id = 'payment_proofs');
--
-- That policy applies to the `anon` role — the key shipped in the browser
-- bundle, readable by anyone who opens devtools. Because it grants SELECT on
-- storage.objects itself (not just object bytes), it also permits LISTING the
-- bucket. So the "filenames contain a UUID, nobody can guess them" argument
-- does not hold: anyone can enumerate every object and download all of them.
--
-- These files are screenshots of GCash payment receipts. They contain full
-- names, mobile numbers, transaction reference numbers and amounts for every
-- paying customer.
--
-- AFTER THIS MIGRATION
--   * The bucket is private. Public object URLs stop resolving.
--   * A user can read only their own proofs (files are named proof_<uid>_<ts>).
--   * The service role bypasses RLS, so the admin dashboard still sees
--     everything — it now mints a short-lived signed URL per row instead of
--     handing out a permanent public one. See
--     src/app/api/admin/get-dashboard/route.js.
--
-- The proof_url column keeps its existing public-format value; it is used only
-- as a stable reference from which the object key is derived. No backfill of
-- existing rows is required.
-- ============================================================================

BEGIN;

-- 1. The actual fix: stop serving this bucket publicly.
UPDATE storage.buckets
SET public = false
WHERE id = 'payment_proofs';

-- 2. Drop EVERY policy on storage.objects that targets this bucket, by name and
--    otherwise. Dropping only the known name would leave any Supabase template
--    policy in place, and Postgres combines policies with OR — one leftover
--    permissive policy re-opens the whole bucket.
DROP POLICY IF EXISTS "Anyone can view payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload payment proofs" ON storage.objects;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') LIKE '%payment_proofs%'
        OR COALESCE(with_check, '') LIKE '%payment_proofs%'
      )
  LOOP
    RAISE NOTICE 'dropping leftover payment_proofs policy: "%"', pol.policyname;
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- 3. Recreate the minimum required access.
--    Upload: any signed-in user, into this bucket only. Unchanged behaviour.
CREATE POLICY "payment_proofs_insert_authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'payment_proofs');

--    Read: only your own proof. TopUpModal names uploads
--    proof_<user_id>_<timestamp>.<ext>, so the owner is the second segment.
CREATE POLICY "payment_proofs_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment_proofs'
    AND name LIKE 'proof_' || auth.uid()::text || '_%'
  );

--    anon has no business here at all.
REVOKE ALL ON storage.objects FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — with the anon key and NO user session:
--
--   curl "$SUPABASE_URL/storage/v1/object/list/payment_proofs" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--        -H "Content-Type: application/json" -d '{"prefix":""}'
--     -> must return [] or an error (it currently returns every receipt)
--
--   Open any existing proof_url in a logged-out browser
--     -> must now 400/404 instead of rendering the receipt
--
-- Then, signed in as the admin: the "View Proof" button in /admin must still
-- open the receipt (it now uses a 10-minute signed URL).
-- ============================================================================
