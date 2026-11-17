-- Admin-only beta. All access goes through owner-checked server routes.
CREATE TABLE public.design_extract_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  manifest jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '3 days'
);
CREATE TABLE public.design_extract_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.design_extract_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  base_revision integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('extract','split','segment')),
  layer_id text,
  model text NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitting' CHECK (status IN ('submitting','queued','processing','saving','ready','accepted','rejected','failed')),
  request_id text,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, idempotency_key)
);
CREATE UNIQUE INDEX design_extract_one_operation ON public.design_extract_jobs(project_id)
  WHERE status IN ('submitting','queued','processing','saving','ready');
CREATE INDEX design_extract_expiry ON public.design_extract_projects(expires_at);
ALTER TABLE public.design_extract_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_extract_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_extract_projects, public.design_extract_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.design_extract_projects, public.design_extract_jobs TO service_role;

CREATE FUNCTION public.review_design_extract(target_project uuid, target_user uuid, target_job uuid, expected_revision integer, next_manifest jsonb, accepted boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.design_extract_projects WHERE id = target_project AND user_id = target_user AND revision = expected_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project revision conflict'; END IF;
  UPDATE public.design_extract_jobs SET status = CASE WHEN accepted THEN 'accepted' ELSE 'rejected' END, updated_at = now()
    WHERE id = target_job AND project_id = target_project AND user_id = target_user AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation already reviewed'; END IF;
  UPDATE public.design_extract_projects SET manifest = next_manifest, revision = revision + 1, updated_at = now() WHERE id = target_project;
END;
$$;
REVOKE ALL ON FUNCTION public.review_design_extract(uuid,uuid,uuid,integer,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_design_extract(uuid,uuid,uuid,integer,jsonb,boolean) TO service_role;

CREATE FUNCTION public.guard_design_extract_operation() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.design_extract_projects WHERE id = NEW.project_id AND user_id = NEW.user_id AND revision = NEW.base_revision AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project changed or expired'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER design_extract_operation_guard BEFORE INSERT ON public.design_extract_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_design_extract_operation();
CREATE FUNCTION public.guard_design_extract_save() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.manifest IS DISTINCT FROM OLD.manifest AND EXISTS (SELECT 1 FROM public.design_extract_jobs WHERE project_id = OLD.id AND status IN ('submitting','queued','processing','saving','ready')) THEN
    RAISE EXCEPTION 'Review active operation before editing';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER design_extract_save_guard BEFORE UPDATE ON public.design_extract_projects FOR EACH ROW EXECUTE FUNCTION public.guard_design_extract_save();
