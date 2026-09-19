-- Repair ambiguous output-column references in the premium mockup billing claim.
-- PostgreSQL exposes RETURNS TABLE column names as PL/pgSQL variables, so every
-- table column used by this function is qualified explicitly.

CREATE OR REPLACE FUNCTION public.claim_mockup_render(
  target_user_id uuid,
  target_project_id uuid,
  attempt_request_key text,
  requested_charge integer DEFAULT 2
)
RETURNS TABLE(status text, job_id uuid, job_status text, credits_remaining integer) AS $$
DECLARE
  inserted_job_id uuid;
  existing_job public.mockup_jobs%ROWTYPE;
  active_job public.mockup_jobs%ROWTYPE;
  current_credits integer;
  project_exists boolean;
BEGIN
  IF requested_charge <= 0 THEN RAISE EXCEPTION 'requested_charge must be positive'; END IF;
  IF attempt_request_key IS NULL OR attempt_request_key !~ '^[A-Za-z0-9_-]{16,100}$' THEN
    RAISE EXCEPTION 'invalid attempt_request_key';
  END IF;

  SELECT true INTO project_exists
  FROM public.mockup_projects AS mp
  WHERE mp.id = target_project_id AND mp.user_id = target_user_id
  FOR UPDATE;
  IF project_exists IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT mj.* INTO active_job
  FROM public.mockup_jobs AS mj
  WHERE mj.user_id = target_user_id
    AND mj.project_id = target_project_id
    AND mj.status IN ('queueing', 'queued', 'processing')
  ORDER BY mj.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    SELECT p.credits INTO current_credits FROM public.profiles AS p WHERE p.id = target_user_id;
    RETURN QUERY SELECT 'already_claimed'::text, active_job.id, active_job.status, current_credits;
    RETURN;
  END IF;

  INSERT INTO public.mockup_jobs (project_id, user_id, request_key, charge_amount)
  VALUES (target_project_id, target_user_id, attempt_request_key, requested_charge)
  ON CONFLICT (user_id, project_id, request_key) DO NOTHING
  RETURNING mockup_jobs.id INTO inserted_job_id;

  IF inserted_job_id IS NULL THEN
    SELECT mj.* INTO existing_job
    FROM public.mockup_jobs AS mj
    WHERE mj.user_id = target_user_id
      AND mj.project_id = target_project_id
      AND mj.request_key = attempt_request_key;
    SELECT p.credits INTO current_credits FROM public.profiles AS p WHERE p.id = target_user_id;
    RETURN QUERY SELECT 'already_claimed'::text, existing_job.id, existing_job.status, current_credits;
    RETURN;
  END IF;

  SELECT p.credits INTO current_credits
  FROM public.profiles AS p
  WHERE p.id = target_user_id
  FOR UPDATE;
  IF current_credits IS NULL OR current_credits < requested_charge THEN
    DELETE FROM public.mockup_jobs AS mj WHERE mj.id = inserted_job_id;
    RETURN QUERY SELECT 'insufficient_credits'::text, NULL::uuid, NULL::text, COALESCE(current_credits, 0);
    RETURN;
  END IF;

  UPDATE public.profiles AS p
  SET credits = p.credits - requested_charge
  WHERE p.id = target_user_id;
  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, 'Premium Mockup Set', -requested_charge);
  UPDATE public.mockup_projects AS mp
  SET status = 'queueing', updated_at = now()
  WHERE mp.id = target_project_id AND mp.user_id = target_user_id;

  RETURN QUERY SELECT 'charged'::text, inserted_job_id, 'queueing'::text, current_credits - requested_charge;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_mockup_render(uuid, uuid, text, integer)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_mockup_render(uuid, uuid, text, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
