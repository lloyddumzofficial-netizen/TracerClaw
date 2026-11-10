-- Optional garment editor. Independent billing never changes extraction flags.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS artwork_revision integer NOT NULL DEFAULT 0;
CREATE TABLE public.artwork_edits (
  id uuid PRIMARY KEY REFERENCES public.generation_attempts(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  base_revision integer NOT NULL,
  source_url text NOT NULL,
  fingerprint text NOT NULL,
  instructions jsonb NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','applied','restored','refunded')),
  provider_request_id text,
  result_url text,
  error_code text,
  previous_outputs jsonb,
  applied_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX artwork_edits_one_processing ON public.artwork_edits(project_id) WHERE status = 'processing';
CREATE INDEX artwork_edits_project_history ON public.artwork_edits(project_id, created_at DESC);
ALTER TABLE public.artwork_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.artwork_edits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.artwork_edits TO service_role;

CREATE FUNCTION public.track_artwork_revision() RETURNS trigger AS $$
BEGIN
  IF NEW.generated_image_url IS DISTINCT FROM OLD.generated_image_url THEN
    NEW.artwork_revision := OLD.artwork_revision + 1;
  ELSE
    NEW.artwork_revision := OLD.artwork_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER track_artwork_revision BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.track_artwork_revision();

CREATE FUNCTION public.guard_artwork_edit_concurrency() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM public.projects WHERE id=NEW.project_id FOR UPDATE;
  IF NEW.operation<>'artwork_edit' AND EXISTS(SELECT 1 FROM public.artwork_edits WHERE project_id=NEW.project_id AND status='processing') THEN
    RAISE EXCEPTION 'PROJECT_BUSY';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER guard_artwork_edit_concurrency BEFORE INSERT ON public.generation_attempts
FOR EACH ROW EXECUTE FUNCTION public.guard_artwork_edit_concurrency();

CREATE FUNCTION public.claim_artwork_edit(p_user uuid, p_project uuid, p_key text, p_revision integer, p_source text, p_instructions jsonb, p_fingerprint text)
RETURNS jsonb AS $$
DECLARE p public.projects%ROWTYPE; a public.generation_attempts%ROWTYPE; e public.artwork_edits%ROWTYPE; balance integer;
BEGIN
  SELECT * INTO p FROM public.projects WHERE id=p_project AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR p.created_at < now()-interval '3 days' THEN RAISE EXCEPTION 'PROJECT_NOT_FOUND'; END IF;
  SELECT * INTO a FROM public.generation_attempts WHERE user_id=p_user AND project_id=p_project AND operation='artwork_edit' AND request_key=p_key;
  IF FOUND THEN
    SELECT * INTO e FROM public.artwork_edits WHERE id=a.id;
    IF e.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'REQUEST_KEY_CONFLICT'; END IF;
    RETURN jsonb_build_object('edit',to_jsonb(e),'claimed',false);
  END IF;
  IF p_key !~ '^[A-Za-z0-9_-]{16,100}$' THEN RAISE EXCEPTION 'INVALID_KEY'; END IF;
  IF p.trace_type IN ('logo','pattern','upscale','bg_remover','bg-remover') OR p.generated_image_url IS NULL OR p.generated_image_url='REFUNDED' THEN RAISE EXCEPTION 'NO_GARMENT_ARTWORK'; END IF;
  IF p.trace_type='mockup_erase' OR COALESCE(p.ai_prompt,'')='ERASE_LOGOS'
    OR NOT (p.trace_type='mockup_preserve' OR COALESCE(p.ai_prompt,'')='PRESERVE_LOGOS'
      OR (p.trace_type IN ('standard','mockup') AND COALESCE(p.ai_prompt,'')='')) THEN RAISE EXCEPTION 'NO_GARMENT_ARTWORK'; END IF;
  IF p.artwork_revision<>p_revision OR p.generated_image_url IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM public.generation_attempts WHERE project_id=p_project AND status='processing') THEN RAISE EXCEPTION 'PROJECT_BUSY'; END IF;
  UPDATE public.profiles SET credits=credits-1 WHERE id=p_user AND credits>=1 RETURNING credits INTO balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS'; END IF;
  INSERT INTO public.generation_attempts(user_id,project_id,operation,request_key,charge_amount)
    VALUES(p_user,p_project,'artwork_edit',p_key,1) RETURNING * INTO a;
  INSERT INTO public.artwork_edits(id,project_id,user_id,base_revision,source_url,instructions,fingerprint)
    VALUES(a.id,p_project,p_user,p_revision,p_source,p_instructions,p_fingerprint) RETURNING * INTO e;
  INSERT INTO public.credit_logs(user_id,action,amount) VALUES(p_user,'Artwork edit (1–5 instructions)',-1);
  RETURN jsonb_build_object('edit',to_jsonb(e),'claimed',true,'credits',balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE FUNCTION public.settle_artwork_edit(p_edit uuid, p_user uuid, p_result text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE e public.artwork_edits%ROWTYPE; balance integer;
BEGIN
  SELECT * INTO e FROM public.artwork_edits WHERE id=p_edit AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EDIT_NOT_FOUND'; END IF;
  IF e.status<>'processing' THEN RETURN to_jsonb(e); END IF;
  IF p_result IS NOT NULL THEN
    UPDATE public.artwork_edits SET status='ready',result_url=p_result,updated_at=now() WHERE id=p_edit RETURNING * INTO e;
    UPDATE public.generation_attempts SET status='completed',result_url=p_result,result_mime_type='image/png',updated_at=now(),completed_at=now() WHERE id=p_edit;
  ELSE
    UPDATE public.artwork_edits SET status='refunded',error_code=p_error,updated_at=now() WHERE id=p_edit RETURNING * INTO e;
    UPDATE public.generation_attempts SET status='refunded',error_code=p_error,updated_at=now(),completed_at=now() WHERE id=p_edit;
    UPDATE public.profiles SET credits=credits+1 WHERE id=p_user RETURNING credits INTO balance;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
    INSERT INTO public.credit_logs(user_id,action,amount) VALUES(p_user,'Refund (Artwork edit)',1);
  END IF;
  RETURN to_jsonb(e);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE FUNCTION public.apply_artwork_edit(p_edit uuid, p_user uuid, p_restore boolean DEFAULT false)
RETURNS jsonb AS $$
DECLARE e public.artwork_edits%ROWTYPE; p public.projects%ROWTYPE; outputs jsonb;
BEGIN
  -- Lock the project before its edit record, consistently with claim.
  SELECT * INTO e FROM public.artwork_edits WHERE id=p_edit AND user_id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'EDIT_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.projects WHERE id=e.project_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR p.created_at < now()-interval '3 days' THEN RAISE EXCEPTION 'PROJECT_NOT_FOUND'; END IF;
  SELECT * INTO e FROM public.artwork_edits WHERE id=p_edit FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.generation_attempts WHERE project_id=p.id AND status='processing') THEN RAISE EXCEPTION 'PROJECT_BUSY'; END IF;
  IF p_restore THEN
    IF e.status<>'applied' OR p.generated_image_url IS DISTINCT FROM e.result_url OR p.artwork_revision<>e.applied_revision THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
    outputs:=e.previous_outputs;
  ELSE
    IF e.status='applied' AND p.generated_image_url=e.result_url THEN RETURN to_jsonb(p); END IF;
    IF e.status<>'ready' OR p.artwork_revision<>e.base_revision OR p.generated_image_url IS DISTINCT FROM e.source_url THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
    UPDATE public.artwork_edits SET previous_outputs=jsonb_build_object('generated_image_url',p.generated_image_url,'upscaled_image_url',p.upscaled_image_url,'svg_url',p.svg_url) WHERE id=p_edit;
    outputs:=jsonb_build_object('generated_image_url',e.result_url);
  END IF;
  UPDATE public.projects SET generated_image_url=outputs->>'generated_image_url',upscaled_image_url=outputs->>'upscaled_image_url',svg_url=outputs->>'svg_url',
    zip_url=NULL,zip_signature=NULL,zip_generated_at=NULL,
    google_drive_folder_id=NULL,google_drive_folder_url=NULL,google_drive_exported_at=NULL,google_drive_export_signature=NULL
    WHERE id=p.id RETURNING * INTO p;
  UPDATE public.artwork_edits SET status=CASE WHEN p_restore THEN 'restored' ELSE 'applied' END,applied_revision=p.artwork_revision,updated_at=now() WHERE id=p_edit;
  RETURN to_jsonb(p);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_artwork_edit(uuid,uuid,text,integer,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_artwork_edit(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.apply_artwork_edit(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_artwork_edit(uuid,uuid,text,integer,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_artwork_edit(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_artwork_edit(uuid,uuid,boolean) TO service_role;
