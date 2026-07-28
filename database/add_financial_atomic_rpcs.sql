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

NOTIFY pgrst, 'reload schema';
