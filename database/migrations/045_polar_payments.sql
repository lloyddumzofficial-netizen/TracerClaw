BEGIN;

CREATE TABLE IF NOT EXISTS public.polar_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  product_id text NOT NULL,
  checkout_id text UNIQUE,
  order_id text UNIQUE,
  amount integer NOT NULL CHECK (amount > 0),
  credits integer NOT NULL CHECK (credits > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  credited_at timestamptz
);

ALTER TABLE public.polar_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polar_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.polar_payments TO service_role;

CREATE OR REPLACE FUNCTION public.grant_polar_payment_credits(
  payment_row_id uuid, provider_order_id text, provider_checkout_id text,
  provider_product_id text, amount_before_tax integer
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  payment public.polar_payments%ROWTYPE;
BEGIN
  SELECT * INTO STRICT payment FROM public.polar_payments WHERE id = payment_row_id FOR UPDATE;
  IF provider_order_id IS NULL OR provider_checkout_id IS NULL
    OR payment.checkout_id IS DISTINCT FROM provider_checkout_id
    OR payment.product_id IS DISTINCT FROM provider_product_id
    OR payment.amount IS DISTINCT FROM amount_before_tax THEN
    RAISE EXCEPTION 'Polar order does not match checkout';
  END IF;

  IF payment.credited_at IS NOT NULL THEN
    IF payment.order_id IS DISTINCT FROM provider_order_id THEN
      RAISE EXCEPTION 'Polar checkout already fulfilled for another order';
    END IF;
    RETURN false;
  END IF;

  UPDATE public.polar_payments SET order_id = provider_order_id, credited_at = now() WHERE id = payment.id;
  UPDATE public.profiles SET credits = credits + payment.credits WHERE id = payment.user_id;
  INSERT INTO public.credit_logs (user_id, action, amount)
    VALUES (payment.user_id, 'Top-Up via Polar', payment.credits);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_polar_payment_credits(uuid,text,text,text,integer)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.grant_polar_payment_credits(uuid,text,text,text,integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
