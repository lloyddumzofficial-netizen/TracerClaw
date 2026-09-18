-- Idempotent billing and recovery records for paid project generations.
-- Apply this migration before relying on request replay protection in production.

CREATE TABLE IF NOT EXISTS public.generation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'refunded')),
  charge_amount integer NOT NULL DEFAULT 1 CHECK (charge_amount > 0),
  result_url text,
  result_mime_type text,
  provider_request_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at timestamptz,
  CONSTRAINT generation_attempts_request_key_format
    CHECK (request_key ~ '^[A-Za-z0-9_-]{16,100}$'),
  CONSTRAINT generation_attempts_operation_format
    CHECK (operation ~ '^[a-z0-9_-]{2,40}$'),
  UNIQUE (user_id, project_id, operation, request_key)
);

CREATE INDEX IF NOT EXISTS generation_attempts_stale_processing_idx
  ON public.generation_attempts (created_at)
  WHERE status = 'processing';

ALTER TABLE public.generation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.generation_attempts FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.generation_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.claim_generation_attempt(
  target_user_id uuid,
  target_project_id uuid,
  attempt_operation text,
  attempt_request_key text,
  charge_action text,
  charge_amount integer DEFAULT 1
)
RETURNS TABLE(
  status text,
  attempt_id uuid,
  attempt_status text,
  result_url text,
  result_mime_type text,
  attempt_created_at timestamptz,
  credits_remaining integer
) AS $$
DECLARE
  inserted_attempt_id uuid;
  existing_attempt public.generation_attempts%ROWTYPE;
  current_credits integer;
  project_exists boolean;
  requested_charge_amount integer := charge_amount;
BEGIN
  IF requested_charge_amount <= 0 THEN
    RAISE EXCEPTION 'charge_amount must be positive';
  END IF;
  IF attempt_request_key IS NULL OR attempt_request_key !~ '^[A-Za-z0-9_-]{16,100}$' THEN
    RAISE EXCEPTION 'invalid attempt_request_key';
  END IF;
  IF attempt_operation IS NULL OR attempt_operation !~ '^[a-z0-9_-]{2,40}$' THEN
    RAISE EXCEPTION 'invalid attempt_operation';
  END IF;

  SELECT true INTO project_exists
  FROM public.projects
  WHERE id = target_project_id AND user_id = target_user_id
  FOR UPDATE;

  IF project_exists IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;

  INSERT INTO public.generation_attempts (
    request_key, user_id, project_id, operation, status, charge_amount
  ) VALUES (
    attempt_request_key, target_user_id, target_project_id, attempt_operation, 'processing', requested_charge_amount
  )
  ON CONFLICT (user_id, project_id, operation, request_key) DO NOTHING
  RETURNING id INTO inserted_attempt_id;

  IF inserted_attempt_id IS NULL THEN
    SELECT * INTO existing_attempt
    FROM public.generation_attempts
    WHERE user_id = target_user_id
      AND project_id = target_project_id
      AND operation = attempt_operation
      AND request_key = attempt_request_key;

    SELECT credits INTO current_credits FROM public.profiles WHERE id = target_user_id;
    RETURN QUERY SELECT
      'already_claimed'::text,
      existing_attempt.id,
      existing_attempt.status,
      existing_attempt.result_url,
      existing_attempt.result_mime_type,
      existing_attempt.created_at,
      current_credits;
    RETURN;
  END IF;

  SELECT credits INTO current_credits
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF current_credits IS NULL OR current_credits < requested_charge_amount THEN
    DELETE FROM public.generation_attempts WHERE id = inserted_attempt_id;
    RETURN QUERY SELECT
      'insufficient_credits'::text,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::timestamptz,
      COALESCE(current_credits, 0);
    RETURN;
  END IF;

  UPDATE public.profiles SET credits = credits - requested_charge_amount WHERE id = target_user_id;
  UPDATE public.projects
  SET credit_deducted = true, refunded = false, failed_at = NULL, failed_step = NULL
  WHERE id = target_project_id AND user_id = target_user_id;
  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, charge_action, -requested_charge_amount);

  RETURN QUERY SELECT
    'charged'::text,
    inserted_attempt_id,
    'processing'::text,
    NULL::text,
    NULL::text,
    now(),
    current_credits - requested_charge_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.refund_generation_attempt(
  target_user_id uuid,
  target_attempt_id uuid,
  refund_action text,
  error_code_value text DEFAULT NULL
)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  target_attempt public.generation_attempts%ROWTYPE;
  new_credits integer;
  project_already_refunded boolean;
BEGIN
  SELECT * INTO target_attempt
  FROM public.generation_attempts
  WHERE id = target_attempt_id AND user_id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer;
    RETURN;
  END IF;
  IF target_attempt.status <> 'processing' THEN
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_user_id;
    RETURN QUERY SELECT 'not_eligible'::text, new_credits;
    RETURN;
  END IF;

  SELECT refunded INTO project_already_refunded
  FROM public.projects
  WHERE id = target_attempt.project_id AND user_id = target_user_id
  FOR UPDATE;

  -- A legacy/client recovery request may have refunded the project while this
  -- attempt was still marked processing. Close the attempt without paying a
  -- second refund.
  IF project_already_refunded IS TRUE THEN
    UPDATE public.generation_attempts
    SET status = 'refunded', error_code = COALESCE(error_code_value, 'ALREADY_REFUNDED'),
        updated_at = timezone('utc'::text, now()), completed_at = timezone('utc'::text, now())
    WHERE id = target_attempt_id;
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_user_id;
    RETURN QUERY SELECT 'already_refunded'::text, new_credits;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits + target_attempt.charge_amount
  WHERE id = target_user_id
  RETURNING credits INTO new_credits;

  UPDATE public.generation_attempts
  SET status = 'refunded', error_code = error_code_value,
      updated_at = timezone('utc'::text, now()), completed_at = timezone('utc'::text, now())
  WHERE id = target_attempt_id;

  UPDATE public.projects
  SET refunded = true,
      failed_at = COALESCE(failed_at, timezone('utc'::text, now())),
      failed_step = COALESCE(failed_step, target_attempt.operation)
  WHERE id = target_attempt.project_id AND user_id = target_user_id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, refund_action, target_attempt.charge_amount);

  RETURN QUERY SELECT 'refunded'::text, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_generation_attempt(uuid, uuid, text, text, text, integer)
  FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.refund_generation_attempt(uuid, uuid, text, text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_generation_attempt(uuid, uuid, text, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_generation_attempt(uuid, uuid, text, text)
  TO service_role;
