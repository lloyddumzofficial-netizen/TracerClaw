BEGIN;
ALTER TABLE public.design_extract_jobs
  ADD COLUMN processor text NOT NULL DEFAULT 'legacy' CHECK (processor IN ('legacy','workflow')),
  ADD COLUMN processor_generation integer NOT NULL DEFAULT 1 CHECK (processor_generation > 0),
  ADD COLUMN processor_run_id text,
  ADD COLUMN processing_lease_token uuid,
  ADD COLUMN processing_lease_until timestamptz,
  ADD COLUMN last_polled_at timestamptz,
  ADD COLUMN last_progress_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.design_extract_outbox (
  job_id uuid PRIMARY KEY REFERENCES public.design_extract_jobs(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','started','complete')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_extract_outbox_due ON public.design_extract_outbox(next_attempt_at) WHERE state='pending';
CREATE INDEX design_extract_processing_lease ON public.design_extract_jobs(user_id,processing_lease_until) WHERE processor='workflow';
ALTER TABLE public.design_extract_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_extract_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.design_extract_outbox TO service_role;
CREATE FUNCTION public.enqueue_design_extract_workflow() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.processor='workflow' THEN
    INSERT INTO public.design_extract_outbox(job_id,generation) VALUES(NEW.id,NEW.processor_generation)
      ON CONFLICT(job_id) DO UPDATE SET generation=EXCLUDED.generation,state='pending',next_attempt_at=now(),lease_token=NULL,lease_until=NULL,updated_at=now();
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER design_extract_enqueue_workflow AFTER INSERT OR UPDATE OF processor,processor_generation ON public.design_extract_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_design_extract_workflow();
-- Wrap the existing financial transaction; do not rewrite its prices or ledger.
CREATE FUNCTION public.claim_design_extract_v2(target_user uuid,target_project uuid,expected_revision integer,request_key text,operation_kind text,target_layer text,provider_model text,provider_input jsonb,operation_processor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reservation jsonb; claimed public.design_extract_jobs%ROWTYPE;
BEGIN
  IF operation_processor IS NULL OR operation_processor NOT IN ('legacy','workflow') THEN RAISE EXCEPTION 'Invalid processor'; END IF;
  reservation:=public.claim_design_extract(target_user,target_project,expected_revision,request_key,operation_kind,target_layer,provider_model,provider_input);
  IF reservation->>'status'='charged' THEN
    UPDATE public.design_extract_jobs SET processor=operation_processor WHERE id=(reservation->'job'->>'id')::uuid AND user_id=target_user RETURNING * INTO claimed;
    reservation:=jsonb_set(reservation,'{job}',to_jsonb(claimed));
  END IF;
  RETURN reservation;
END; $$;
CREATE FUNCTION public.claim_design_extract_outbox(target_job uuid,batch_limit integer)
RETURNS SETOF public.design_extract_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY WITH due AS (
    SELECT o.job_id FROM public.design_extract_outbox o JOIN public.design_extract_jobs j ON j.id=o.job_id
    WHERE o.state='pending' AND o.next_attempt_at<=now() AND (o.lease_until IS NULL OR o.lease_until<now())
      AND (target_job IS NULL OR o.job_id=target_job) AND j.processor='workflow'
    ORDER BY o.next_attempt_at,o.job_id FOR UPDATE OF o SKIP LOCKED LIMIT LEAST(GREATEST(COALESCE(batch_limit,1),1),10)
  ) UPDATE public.design_extract_outbox o SET lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=o.attempts+1,updated_at=now()
    FROM due WHERE o.job_id=due.job_id RETURNING o.*;
END; $$;
CREATE FUNCTION public.claim_design_extract_step(target_job uuid,target_generation integer,target_run text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.design_extract_jobs%ROWTYPE; token uuid;
BEGIN
  IF target_run IS NULL OR length(target_run)<1 OR length(target_run)>200 THEN RAISE EXCEPTION 'Invalid workflow run'; END IF;
  SELECT * INTO job FROM public.design_extract_jobs WHERE id=target_job FOR UPDATE;
  IF NOT FOUND OR job.processor<>'workflow' OR job.processor_generation<>target_generation THEN RETURN jsonb_build_object('status','obsolete'); END IF;
  IF job.status IN ('failed','accepted','rejected') THEN RETURN jsonb_build_object('status','terminal','job',to_jsonb(job)); END IF;
  IF job.processing_lease_until>now() THEN RETURN jsonb_build_object('status','busy'); END IF;
  PERFORM 1 FROM public.profiles WHERE id=job.user_id FOR UPDATE;
  IF (SELECT count(*) FROM public.design_extract_jobs WHERE user_id=job.user_id AND processor='workflow' AND processing_lease_until>now())>=2 THEN
    RETURN jsonb_build_object('status','busy');
  END IF;
  token:=gen_random_uuid();
  UPDATE public.design_extract_jobs SET processor_run_id=target_run,processing_lease_token=token,processing_lease_until=now()+interval '180 seconds',last_polled_at=now()
    WHERE id=target_job RETURNING * INTO job;
  RETURN jsonb_build_object('status','claimed','job',to_jsonb(job),'lease_token',token);
END; $$;
-- Fenced handoff: older workflow runs cannot claim another step after replacement.
CREATE FUNCTION public.requeue_stale_design_extract(target_job uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.design_extract_jobs SET processor_generation=processor_generation+1,processor_run_id=NULL,processing_lease_token=NULL,processing_lease_until=NULL,last_polled_at=now()
    WHERE id=target_job AND processor='workflow' AND status IN ('submitting','queued','processing','saving','ready')
      AND COALESCE(last_polled_at,created_at)<now()-interval '5 minutes' AND (processing_lease_until IS NULL OR processing_lease_until<now());
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.claim_design_extract_v2(uuid,uuid,integer,text,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_design_extract_outbox(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_design_extract_step(uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.requeue_stale_design_extract(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_design_extract_v2(uuid,uuid,integer,text,text,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_design_extract_outbox(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_design_extract_step(uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_design_extract(uuid) TO service_role;
COMMIT;
