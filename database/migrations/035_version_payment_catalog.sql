-- Snapshot the international catalog used to create each Dodo checkout. This
-- keeps pending payments valid across future price/product changes and records
-- adaptive-currency charges without overwriting the agreed base price.

ALTER TABLE public.dodo_payments
  ADD COLUMN IF NOT EXISTS provider_product_id text,
  ADD COLUMN IF NOT EXISTS catalog_version text,
  ADD COLUMN IF NOT EXISTS requested_billing_currency text,
  ADD COLUMN IF NOT EXISTS paid_amount integer,
  ADD COLUMN IF NOT EXISTS paid_currency text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dodo_payments_paid_amount_positive'
  ) THEN
    ALTER TABLE public.dodo_payments
      ADD CONSTRAINT dodo_payments_paid_amount_positive
      CHECK (paid_amount IS NULL OR paid_amount > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.grant_dodo_payment_credits(
  payment_row_id uuid, provider_payment_id text, provider_checkout_session_id text,
  paid_amount integer, paid_currency text
)
RETURNS TABLE(granted boolean, granted_credits integer, granted_user_id uuid) AS $$
DECLARE
  target_payment public.dodo_payments%ROWTYPE;
  actual_amount integer := paid_amount;
  actual_currency text := upper(paid_currency);
BEGIN
  SELECT * INTO target_payment
  FROM public.dodo_payments
  WHERE id = payment_row_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Dodo payment not found'; END IF;
  IF target_payment.credited_at IS NOT NULL OR target_payment.status = 'paid' THEN
    RETURN QUERY SELECT false, target_payment.credits, target_payment.user_id;
    RETURN;
  END IF;

  IF actual_amount IS NULL OR actual_amount <= 0 OR actual_currency IS NULL OR actual_currency = '' THEN
    RAISE EXCEPTION 'Dodo payment amount or currency is invalid';
  END IF;
  IF actual_currency = upper(target_payment.currency) AND actual_amount <> target_payment.amount THEN
    RAISE EXCEPTION 'Dodo payment amount does not match checkout snapshot';
  END IF;

  UPDATE public.profiles
  SET credits = credits + target_payment.credits
  WHERE id = target_payment.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dodo payment user profile not found'; END IF;

  UPDATE public.dodo_payments AS payment
  SET status = 'paid',
    dodo_payment_id = COALESCE(provider_payment_id, payment.dodo_payment_id),
    dodo_checkout_session_id = COALESCE(provider_checkout_session_id, payment.dodo_checkout_session_id),
    paid_amount = actual_amount,
    paid_currency = actual_currency,
    credited_at = timezone('utc'::text, now())
  WHERE payment.id = target_payment.id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_payment.user_id, 'Top-Up via Dodo', target_payment.credits);

  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid,text,text,integer,text)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid,text,text,integer,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
