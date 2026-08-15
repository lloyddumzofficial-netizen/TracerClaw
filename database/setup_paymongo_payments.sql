-- Run this in Supabase SQL Editor before enabling PayMongo QRPh in production.
-- Amounts are stored in the smallest currency unit (PHP centavos for PHP).

CREATE TABLE IF NOT EXISTS public.paymongo_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  email text NOT NULL,
  plan text NOT NULL,
  credits integer NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  paymongo_checkout_session_id text,
  paymongo_payment_intent_id text,
  paymongo_payment_method_id text,
  paymongo_payment_id text,
  status text NOT NULL DEFAULT 'pending',
  credited_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.paymongo_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.paymongo_payments
ADD COLUMN IF NOT EXISTS paymongo_payment_intent_id text;

ALTER TABLE public.paymongo_payments
ADD COLUMN IF NOT EXISTS paymongo_payment_method_id text;

CREATE POLICY "Users can view their own paymongo payments"
ON public.paymongo_payments FOR SELECT
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS paymongo_payments_checkout_session_unique
ON public.paymongo_payments (paymongo_checkout_session_id)
WHERE paymongo_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS paymongo_payments_payment_unique
ON public.paymongo_payments (paymongo_payment_id)
WHERE paymongo_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS paymongo_payments_payment_intent_unique
ON public.paymongo_payments (paymongo_payment_intent_id)
WHERE paymongo_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS paymongo_payments_user_created_idx
ON public.paymongo_payments (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_paymongo_payments_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_paymongo_payments_updated_at ON public.paymongo_payments;
CREATE TRIGGER set_paymongo_payments_updated_at
BEFORE UPDATE ON public.paymongo_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_paymongo_payments_updated_at();

CREATE OR REPLACE FUNCTION public.grant_paymongo_payment_credits(
  payment_row_id uuid,
  provider_payment_id text,
  provider_checkout_session_id text,
  paid_amount integer,
  paid_currency text
)
RETURNS TABLE(granted boolean, granted_credits integer, granted_user_id uuid) AS $$
DECLARE
  target_payment public.paymongo_payments%ROWTYPE;
BEGIN
  SELECT *
  INTO target_payment
  FROM public.paymongo_payments
  WHERE id = payment_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PayMongo payment not found';
  END IF;

  IF target_payment.credited_at IS NOT NULL OR target_payment.status = 'paid' THEN
    RETURN QUERY SELECT false, target_payment.credits, target_payment.user_id;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET credits = credits + target_payment.credits
  WHERE id = target_payment.user_id;

  UPDATE public.paymongo_payments
  SET
    status = 'paid',
    paymongo_payment_id = COALESCE(provider_payment_id, paymongo_payment_id),
    paymongo_checkout_session_id = COALESCE(provider_checkout_session_id, paymongo_checkout_session_id),
    amount = COALESCE(paid_amount, amount),
    currency = COALESCE(paid_currency, currency),
    credited_at = timezone('utc'::text, now())
  WHERE id = target_payment.id;

  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_payment.user_id, 'Top-Up via PayMongo QRPh', target_payment.credits);

  RETURN QUERY SELECT true, target_payment.credits, target_payment.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.grant_paymongo_payment_credits(uuid, text, text, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_paymongo_payment_credits(uuid, text, text, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_paymongo_payment_credits(uuid, text, text, integer, text) FROM anon;

NOTIFY pgrst, 'reload schema';
