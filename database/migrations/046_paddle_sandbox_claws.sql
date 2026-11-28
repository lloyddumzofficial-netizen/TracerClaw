BEGIN;

CREATE TABLE public.paddle_sandbox_claw_grants (
  paddle_transaction_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  credits integer NOT NULL CHECK (credits IN (5, 10, 35)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paddle_sandbox_claw_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paddle_sandbox_claw_grants FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.paddle_sandbox_claw_grants TO service_role;

CREATE FUNCTION public.grant_paddle_sandbox_claws(transaction_id text, test_user_id uuid, claws integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.paddle_sandbox_claw_grants (paddle_transaction_id, user_id, credits)
    VALUES (transaction_id, test_user_id, claws)
    ON CONFLICT (paddle_transaction_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_paddle_sandbox_claws(text,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_paddle_sandbox_claws(text,uuid,integer) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
