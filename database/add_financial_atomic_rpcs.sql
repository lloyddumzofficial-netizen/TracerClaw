-- Financial consistency hardening for paid DesaynClaw operations.
-- Run in Supabase SQL Editor with the service/admin role.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS projects_user_trace_client_request_unique
  ON public.projects (user_id, trace_type, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_standalone_upscale(
  target_user_id uuid,
  source_image_url text,
  request_key text
)
RETURNS TABLE(status text, project_id uuid, credits_remaining integer) AS $$
DECLARE
  existing_project_id uuid;
  inserted_project_id uuid;
  current_credits integer;
BEGIN
  IF request_key IS NULL OR length(trim(request_key)) = 0 THEN
    RAISE EXCEPTION 'request_key is required';
  END IF;

  SELECT id
  INTO existing_project_id
  FROM public.projects
  WHERE user_id = target_user_id
    AND trace_type = 'upscale'
    AND client_request_id = request_key
  FOR UPDATE;

  IF existing_project_id IS NOT NULL THEN
    SELECT credits INTO current_credits
    FROM public.profiles
    WHERE id = target_user_id;

    RETURN QUERY SELECT 'already_claimed'::text, existing_project_id, current_credits;
    RETURN;
  END IF;

  INSERT INTO public.projects (
    user_id,
    name,
    trace_type,
    original_image_url,
    ai_prompt,
    generated_image_url,
    credit_deducted,
    refunded,
    client_request_id
  )
  VALUES (
    target_user_id,
    'Clarity Upscale 4K',
    'upscale',
    source_image_url,
    NULL,
    NULL,
    false,
    false,
    request_key
  )
  ON CONFLICT (user_id, trace_type, client_request_id)
  WHERE client_request_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO inserted_project_id;

  IF inserted_project_id IS NULL THEN
    SELECT id
    INTO existing_project_id
    FROM public.projects
    WHERE user_id = target_user_id
      AND trace_type = 'upscale'
      AND client_request_id = request_key
    FOR UPDATE;

    SELECT credits INTO current_credits
    FROM public.profiles
    WHERE id = target_user_id;

    RETURN QUERY SELECT 'already_claimed'::text, existing_project_id, current_credits;
    RETURN;
  END IF;

  SELECT credits
  INTO current_credits
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF current_credits IS NULL OR current_credits < 1 THEN
    DELETE FROM public.projects WHERE id = inserted_project_id;
    RETURN QUERY SELECT 'insufficient_credits'::text, NULL::uuid, COALESCE(current_credits, 0);
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits - 1
  WHERE id = target_user_id;

  UPDATE public.projects
  SET credit_deducted = true,
      refunded = false
  WHERE id = inserted_project_id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, 'AI Clarity Upscale (4K)', -1);

  RETURN QUERY SELECT 'claimed'::text, inserted_project_id, current_credits - 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.claim_standalone_upscale(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_standalone_upscale(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_standalone_upscale(uuid, text, text) FROM anon;

CREATE OR REPLACE FUNCTION public.claim_project_credit(
  target_user_id uuid,
  target_project_id uuid,
  charge_action text,
  charge_amount integer DEFAULT 1
)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  current_credits integer;
  project_exists boolean;
BEGIN
  IF charge_amount <= 0 THEN
    RAISE EXCEPTION 'charge_amount must be positive';
  END IF;

  SELECT true
  INTO project_exists
  FROM public.projects
  WHERE id = target_project_id
    AND user_id = target_user_id
  FOR UPDATE;

  IF project_exists IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer;
    RETURN;
  END IF;

  SELECT credits
  INTO current_credits
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF current_credits IS NULL OR current_credits < charge_amount THEN
    RETURN QUERY SELECT 'insufficient_credits'::text, COALESCE(current_credits, 0);
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits - charge_amount
  WHERE id = target_user_id;

  UPDATE public.projects
  SET credit_deducted = true,
      refunded = false,
      failed_at = NULL,
      failed_step = NULL
  WHERE id = target_project_id
    AND user_id = target_user_id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, charge_action, -charge_amount);

  RETURN QUERY SELECT 'charged'::text, current_credits - charge_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.refund_project_credit(
  target_user_id uuid,
  target_project_id uuid,
  refund_action text,
  failed_step_value text DEFAULT NULL,
  mark_generated_refunded boolean DEFAULT true
)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  target_project public.projects%ROWTYPE;
  new_credits integer;
  has_usable_output boolean;
BEGIN
  SELECT *
  INTO target_project
  FROM public.projects
  WHERE id = target_project_id
    AND user_id = target_user_id
  FOR UPDATE;

  IF NOT FOUND OR NOT target_project.credit_deducted OR target_project.refunded THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::integer;
    RETURN;
  END IF;

  has_usable_output := (
    target_project.svg_url IS NOT NULL OR
    target_project.upscaled_image_url IS NOT NULL OR
    (target_project.generated_image_url IS NOT NULL AND target_project.generated_image_url <> 'REFUNDED')
  );

  IF has_usable_output THEN
    RETURN QUERY SELECT 'has_output'::text, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits + 1
  WHERE id = target_user_id
  RETURNING credits INTO new_credits;

  UPDATE public.projects
  SET refunded = true,
      generated_image_url = CASE WHEN mark_generated_refunded THEN 'REFUNDED' ELSE generated_image_url END,
      failed_at = COALESCE(failed_at, timezone('utc'::text, now())),
      failed_step = COALESCE(failed_step, failed_step_value)
  WHERE id = target_project_id
    AND user_id = target_user_id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, refund_action, 1);

  RETURN QUERY SELECT 'refunded'::text, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.adjust_user_credit_with_log(
  target_user_id uuid,
  credit_delta integer,
  log_action text
)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  current_credits integer;
  new_credits integer;
BEGIN
  IF credit_delta = 0 THEN
    RAISE EXCEPTION 'credit_delta must not be zero';
  END IF;

  SELECT credits
  INTO current_credits
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF current_credits IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer;
    RETURN;
  END IF;

  IF credit_delta < 0 AND current_credits < abs(credit_delta) THEN
    RETURN QUERY SELECT 'insufficient_credits'::text, current_credits;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits + credit_delta
  WHERE id = target_user_id
  RETURNING credits INTO new_credits;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, log_action, credit_delta);

  RETURN QUERY SELECT 'adjusted'::text, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.claim_project_credit(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_project_credit(uuid, uuid, text, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_project_credit(uuid, uuid, text, integer) FROM anon;

REVOKE EXECUTE ON FUNCTION public.refund_project_credit(uuid, uuid, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_project_credit(uuid, uuid, text, text, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_project_credit(uuid, uuid, text, text, boolean) FROM anon;

REVOKE EXECUTE ON FUNCTION public.adjust_user_credit_with_log(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_user_credit_with_log(uuid, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.adjust_user_credit_with_log(uuid, integer, text) FROM anon;

CREATE OR REPLACE FUNCTION public.grant_dodo_payment_credits(
  payment_row_id uuid,
  provider_payment_id text,
  provider_checkout_session_id text,
  paid_amount integer,
  paid_currency text
)
RETURNS TABLE(granted boolean, granted_credits integer, granted_user_id uuid) AS $$
DECLARE
  target_payment public.dodo_payments%ROWTYPE;
BEGIN
  SELECT *
  INTO target_payment
  FROM public.dodo_payments
  WHERE id = payment_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dodo payment not found';
  END IF;

  IF target_payment.credited_at IS NOT NULL OR target_payment.status = 'paid' THEN
    RETURN QUERY SELECT false, target_payment.credits, target_payment.user_id;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits + target_payment.credits
  WHERE id = target_payment.user_id;

  UPDATE public.dodo_payments
  SET
    status = 'paid',
    dodo_payment_id = COALESCE(provider_payment_id, dodo_payment_id),
    dodo_checkout_session_id = COALESCE(provider_checkout_session_id, dodo_checkout_session_id),
    amount = COALESCE(paid_amount, amount),
    currency = COALESCE(paid_currency, currency),
    credited_at = timezone('utc'::text, now())
  WHERE id = target_payment.id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_payment.user_id, 'Top-Up via Dodo', target_payment.credits);

  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid, text, text, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid, text, text, integer, text) FROM anon;

NOTIFY pgrst, 'reload schema';
