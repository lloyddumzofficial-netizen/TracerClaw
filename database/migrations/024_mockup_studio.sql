-- Premium design-to-mockup projects, assets, render jobs and outputs.
-- The service role owns all writes; users access this domain through authenticated API routes.

CREATE TABLE IF NOT EXISTS public.mockup_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  garment_type text NOT NULL DEFAULT 'sports_raglan' CHECK (garment_type IN ('sports_raglan')),
  template_version text NOT NULL DEFAULT 'sports-raglan-v1',
  style_preset text NOT NULL DEFAULT 'studio' CHECK (style_preset IN ('studio', 'editorial', 'performance')),
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'queueing', 'rendering', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 days')
);

CREATE INDEX IF NOT EXISTS mockup_projects_user_created_idx
  ON public.mockup_projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mockup_projects_expiry_idx
  ON public.mockup_projects (expires_at);

CREATE TABLE IF NOT EXISTS public.mockup_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mockup_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('front', 'back', 'left_sleeve', 'right_sleeve', 'collar', 'left_cuff', 'right_cuff', 'logo', 'style_reference')),
  file_url text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0),
  width integer NOT NULL CHECK (width > 0 AND width <= 8192),
  height integer NOT NULL CHECK (height > 0 AND height <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, role)
);

CREATE INDEX IF NOT EXISTS mockup_assets_project_idx ON public.mockup_assets (project_id);

CREATE TABLE IF NOT EXISTS public.mockup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mockup_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,100}$'),
  status text NOT NULL DEFAULT 'queueing' CHECK (status IN ('queueing', 'queued', 'processing', 'completed', 'failed', 'refunded')),
  model text NOT NULL DEFAULT 'fal-ai/nano-banana-2/edit',
  charge_amount integer NOT NULL DEFAULT 2 CHECK (charge_amount > 0),
  provider_requests jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, project_id, request_key)
);

CREATE INDEX IF NOT EXISTS mockup_jobs_project_created_idx
  ON public.mockup_jobs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mockup_jobs_stale_idx
  ON public.mockup_jobs (created_at)
  WHERE status IN ('queueing', 'queued', 'processing');

CREATE TABLE IF NOT EXISTS public.mockup_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.mockup_jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.mockup_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  view_type text NOT NULL CHECK (view_type IN ('hero', 'front', 'back', 'sleeve', 'detail')),
  file_url text NOT NULL,
  mime_type text NOT NULL DEFAULT 'image/png',
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, view_type)
);

ALTER TABLE public.mockup_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mockup_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mockup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mockup_outputs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mockup_projects, public.mockup_assets, public.mockup_jobs, public.mockup_outputs
  FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mockup_projects, public.mockup_assets, public.mockup_jobs, public.mockup_outputs
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_mockup_render(
  target_user_id uuid,
  target_project_id uuid,
  attempt_request_key text,
  requested_charge integer DEFAULT 2
)
RETURNS TABLE(status text, job_id uuid, job_status text, credits_remaining integer) AS $$
DECLARE
  inserted_job_id uuid;
  existing_job public.mockup_jobs%ROWTYPE;
  active_job public.mockup_jobs%ROWTYPE;
  current_credits integer;
  project_exists boolean;
BEGIN
  IF requested_charge <= 0 THEN RAISE EXCEPTION 'requested_charge must be positive'; END IF;
  IF attempt_request_key IS NULL OR attempt_request_key !~ '^[A-Za-z0-9_-]{16,100}$' THEN
    RAISE EXCEPTION 'invalid attempt_request_key';
  END IF;

  SELECT true INTO project_exists
  FROM public.mockup_projects AS mp
  WHERE mp.id = target_project_id AND mp.user_id = target_user_id
  FOR UPDATE;
  IF project_exists IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::integer;
    RETURN;
  END IF;

  -- The project row lock above serializes competing render claims. Return the
  -- existing live job instead of charging a second request with a new key.
  SELECT mj.* INTO active_job FROM public.mockup_jobs AS mj
  WHERE mj.user_id = target_user_id
    AND mj.project_id = target_project_id
    AND mj.status IN ('queueing', 'queued', 'processing')
  ORDER BY mj.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    SELECT p.credits INTO current_credits FROM public.profiles AS p WHERE p.id = target_user_id;
    RETURN QUERY SELECT 'already_claimed'::text, active_job.id, active_job.status, current_credits;
    RETURN;
  END IF;

  INSERT INTO public.mockup_jobs (project_id, user_id, request_key, charge_amount)
  VALUES (target_project_id, target_user_id, attempt_request_key, requested_charge)
  ON CONFLICT (user_id, project_id, request_key) DO NOTHING
  RETURNING id INTO inserted_job_id;

  IF inserted_job_id IS NULL THEN
    SELECT mj.* INTO existing_job FROM public.mockup_jobs AS mj
    WHERE mj.user_id = target_user_id
      AND mj.project_id = target_project_id
      AND mj.request_key = attempt_request_key;
    SELECT p.credits INTO current_credits FROM public.profiles AS p WHERE p.id = target_user_id;
    RETURN QUERY SELECT 'already_claimed'::text, existing_job.id, existing_job.status, current_credits;
    RETURN;
  END IF;

  SELECT p.credits INTO current_credits FROM public.profiles AS p WHERE p.id = target_user_id FOR UPDATE;
  IF current_credits IS NULL OR current_credits < requested_charge THEN
    DELETE FROM public.mockup_jobs WHERE id = inserted_job_id;
    RETURN QUERY SELECT 'insufficient_credits'::text, NULL::uuid, NULL::text, COALESCE(current_credits, 0);
    RETURN;
  END IF;

  UPDATE public.profiles SET credits = credits - requested_charge WHERE id = target_user_id;
  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, 'Premium Mockup Set', -requested_charge);
  UPDATE public.mockup_projects SET status = 'queueing', updated_at = now()
  WHERE id = target_project_id AND user_id = target_user_id;

  RETURN QUERY SELECT 'charged'::text, inserted_job_id, 'queueing'::text, current_credits - requested_charge;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.refund_mockup_render(
  target_user_id uuid,
  target_job_id uuid,
  error_code_value text DEFAULT NULL
)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  target_job public.mockup_jobs%ROWTYPE;
  new_credits integer;
BEGIN
  SELECT * INTO target_job FROM public.mockup_jobs
  WHERE id = target_job_id AND user_id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer;
    RETURN;
  END IF;
  IF target_job.status IN ('completed', 'refunded') THEN
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_user_id;
    RETURN QUERY SELECT 'not_eligible'::text, new_credits;
    RETURN;
  END IF;

  UPDATE public.profiles SET credits = credits + target_job.charge_amount
  WHERE id = target_user_id RETURNING credits INTO new_credits;
  UPDATE public.mockup_jobs SET status = 'refunded', error_code = error_code_value,
    updated_at = now(), completed_at = now() WHERE id = target_job_id;
  UPDATE public.mockup_projects SET status = 'failed', updated_at = now()
  WHERE id = target_job.project_id AND user_id = target_user_id;
  INSERT INTO public.credit_logs (user_id, action, amount)
  VALUES (target_user_id, 'Refund (Premium Mockup)', target_job.charge_amount);

  RETURN QUERY SELECT 'refunded'::text, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.claim_mockup_render(uuid, uuid, text, integer) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.refund_mockup_render(uuid, uuid, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_mockup_render(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_mockup_render(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
