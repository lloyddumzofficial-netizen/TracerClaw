-- Apply before deploying Precision SVG idempotency. These RPCs run under the
-- service role; the database must enforce the same invariants as the webhooks.

CREATE TABLE IF NOT EXISTS public.cleanup_scan_cursors (
  scan_name text PRIMARY KEY,
  last_key text,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.cleanup_scan_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cleanup_scan_cursors FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cleanup_scan_cursors TO service_role;

CREATE OR REPLACE FUNCTION public.grant_dodo_payment_credits(
  payment_row_id uuid, provider_payment_id text, provider_checkout_session_id text,
  paid_amount integer, paid_currency text
)
RETURNS TABLE(granted boolean, granted_credits integer, granted_user_id uuid) AS $$
DECLARE target_payment public.dodo_payments%ROWTYPE;
BEGIN
  SELECT * INTO target_payment FROM public.dodo_payments WHERE id = payment_row_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dodo payment not found'; END IF;
  IF target_payment.credited_at IS NOT NULL OR target_payment.status = 'paid' THEN
    RETURN QUERY SELECT false, target_payment.credits, target_payment.user_id;
    RETURN;
  END IF;
  IF paid_amount IS NULL OR paid_amount <> target_payment.amount OR
     paid_currency IS NULL OR upper(paid_currency) <> upper(target_payment.currency) THEN
    RAISE EXCEPTION 'Dodo payment amount or currency mismatch';
  END IF;
  UPDATE public.profiles SET credits = credits + target_payment.credits WHERE id = target_payment.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dodo payment user profile not found'; END IF;
  UPDATE public.dodo_payments SET status = 'paid',
    dodo_payment_id = COALESCE(provider_payment_id, dodo_payment_id),
    dodo_checkout_session_id = COALESCE(provider_checkout_session_id, dodo_checkout_session_id),
    credited_at = timezone('utc'::text, now()) WHERE id = target_payment.id;
  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.grant_paymongo_payment_credits(
  payment_row_id uuid, provider_payment_id text, provider_checkout_session_id text,
  paid_amount integer, paid_currency text
)
RETURNS TABLE(granted boolean, granted_credits integer, granted_user_id uuid) AS $$
DECLARE target_payment public.paymongo_payments%ROWTYPE;
BEGIN
  SELECT * INTO target_payment FROM public.paymongo_payments WHERE id = payment_row_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PayMongo payment not found'; END IF;
  IF target_payment.credited_at IS NOT NULL OR target_payment.status = 'paid' THEN
    RETURN QUERY SELECT false, target_payment.credits, target_payment.user_id;
    RETURN;
  END IF;
  IF paid_amount IS NULL OR paid_amount <> target_payment.amount OR
     paid_currency IS NULL OR upper(paid_currency) <> upper(target_payment.currency) THEN
    RAISE EXCEPTION 'PayMongo payment amount or currency mismatch';
  END IF;
  UPDATE public.profiles SET credits = credits + target_payment.credits WHERE id = target_payment.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PayMongo payment user profile not found'; END IF;
  UPDATE public.paymongo_payments SET status = 'paid',
    paymongo_payment_id = COALESCE(provider_payment_id, paymongo_payment_id),
    paymongo_checkout_session_id = COALESCE(provider_checkout_session_id, paymongo_checkout_session_id),
    credited_at = timezone('utc'::text, now()) WHERE id = target_payment.id;
  INSERT INTO public.credit_logs (user_id, action, amount)
    VALUES (target_payment.user_id, 'Top-Up via PayMongo QRPh', target_payment.credits);
  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.refund_generation_attempt(
  target_user_id uuid, target_attempt_id uuid, refund_action text, error_code_value text DEFAULT NULL
)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  target_attempt public.generation_attempts%ROWTYPE;
  new_credits integer;
  project_already_refunded boolean;
BEGIN
  SELECT * INTO target_attempt FROM public.generation_attempts
    WHERE id = target_attempt_id AND user_id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::integer; RETURN; END IF;
  IF target_attempt.status <> 'processing' THEN
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_user_id;
    RETURN QUERY SELECT 'not_eligible'::text, new_credits; RETURN;
  END IF;
  IF target_attempt.operation <> 'precision_svg' THEN
    SELECT refunded INTO project_already_refunded FROM public.projects
      WHERE id = target_attempt.project_id AND user_id = target_user_id FOR UPDATE;
    IF project_already_refunded IS TRUE THEN
      UPDATE public.generation_attempts SET status = 'refunded',
        error_code = COALESCE(error_code_value, 'ALREADY_REFUNDED'),
        updated_at = timezone('utc'::text, now()), completed_at = timezone('utc'::text, now())
        WHERE id = target_attempt_id;
      SELECT credits INTO new_credits FROM public.profiles WHERE id = target_user_id;
      RETURN QUERY SELECT 'already_refunded'::text, new_credits; RETURN;
    END IF;
  END IF;
  UPDATE public.profiles SET credits = credits + target_attempt.charge_amount
    WHERE id = target_user_id RETURNING credits INTO new_credits;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation user profile not found'; END IF;
  UPDATE public.generation_attempts SET status = 'refunded', error_code = error_code_value,
    updated_at = timezone('utc'::text, now()), completed_at = timezone('utc'::text, now())
    WHERE id = target_attempt_id;
  IF target_attempt.operation <> 'precision_svg' THEN
    UPDATE public.projects SET refunded = true,
      failed_at = COALESCE(failed_at, timezone('utc'::text, now())),
      failed_step = COALESCE(failed_step, target_attempt.operation)
      WHERE id = target_attempt.project_id AND user_id = target_user_id;
  END IF;
  INSERT INTO public.credit_logs (user_id, action, amount)
    VALUES (target_user_id, refund_action, target_attempt.charge_amount);
  RETURN QUERY SELECT 'refunded'::text, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid,text,text,integer,text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.grant_paymongo_payment_credits(uuid,text,text,integer,text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.refund_generation_attempt(uuid,uuid,text,text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_paymongo_payment_credits(uuid,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_generation_attempt(uuid,uuid,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
