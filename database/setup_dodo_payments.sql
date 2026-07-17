-- Run this in Supabase SQL Editor before enabling Dodo Payments in production.
-- Amounts are stored in the smallest currency unit (PHP centavos for PHP).

CREATE TABLE IF NOT EXISTS public.dodo_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  email text NOT NULL,
  plan text NOT NULL,
  credits integer NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  dodo_checkout_session_id text,
  dodo_payment_id text,
  status text NOT NULL DEFAULT 'pending',
  credited_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.dodo_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own dodo payments"
ON public.dodo_payments FOR SELECT
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS dodo_payments_checkout_session_unique
ON public.dodo_payments (dodo_checkout_session_id)
WHERE dodo_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dodo_payments_payment_unique
ON public.dodo_payments (dodo_payment_id)
WHERE dodo_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dodo_payments_user_created_idx
ON public.dodo_payments (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_dodo_payments_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_dodo_payments_updated_at ON public.dodo_payments;
CREATE TRIGGER set_dodo_payments_updated_at
BEFORE UPDATE ON public.dodo_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_dodo_payments_updated_at();

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

  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid, text, text, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_dodo_payment_credits(uuid, text, text, integer, text) FROM anon;

NOTIFY pgrst, 'reload schema';
