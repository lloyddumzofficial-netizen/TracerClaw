-- Keep Dodo purchases visible in the user's Claw activity while preserving the
-- transaction and idempotency guarantees added in migration 027.

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
  INSERT INTO public.credit_logs (user_id, action, amount)
    VALUES (target_payment.user_id, 'Top-Up via Dodo', target_payment.credits);
  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid,text,text,integer,text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid,text,text,integer,text) TO service_role;
NOTIFY pgrst, 'reload schema';
