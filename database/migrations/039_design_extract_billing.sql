-- Dedicated ledger: garment generation_attempts references a different project table.
BEGIN;
ALTER TABLE public.design_extract_jobs
  ADD COLUMN dispatch_started_at timestamptz,
  ADD COLUMN charge_amount integer NOT NULL DEFAULT 0 CHECK (charge_amount >= 0),
  ADD COLUMN billing_state text NOT NULL DEFAULT 'beta' CHECK (billing_state IN ('beta','held','settled','refunded'));

CREATE TABLE public.design_extract_ledger (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount IN (1,2)),
  price_version text NOT NULL DEFAULT 'design-extract-v1',
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','settled','refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.design_extract_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_extract_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.design_extract_ledger TO service_role;

CREATE FUNCTION public.claim_design_extract(
  target_user uuid, target_project uuid, expected_revision integer,
  request_key text, operation_kind text, target_layer text, provider_model text, provider_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing public.design_extract_jobs%ROWTYPE;
  claimed public.design_extract_jobs%ROWTYPE;
  balance integer;
  cost integer;
BEGIN
  IF operation_kind NOT IN ('extract','split','segment') OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9_-]{8,120}$' THEN
    RAISE EXCEPTION 'Invalid extraction request';
  END IF;
  cost := CASE WHEN operation_kind = 'segment' THEN 1 ELSE 2 END;
  IF provider_model IS DISTINCT FROM (CASE WHEN operation_kind = 'segment' THEN 'fal-ai/sam-3/image' ELSE 'fal-ai/qwen-image-layered' END) THEN
    RAISE EXCEPTION 'Invalid extraction model';
  END IF;
  PERFORM 1 FROM public.design_extract_projects
    WHERE id = target_project AND user_id = target_user AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT * INTO existing FROM public.design_extract_jobs
    WHERE project_id = target_project AND idempotency_key = request_key;
  IF FOUND THEN
    IF existing.kind IS DISTINCT FROM operation_kind OR existing.layer_id IS DISTINCT FROM target_layer THEN
      RAISE EXCEPTION 'Request key reused for a different operation';
    END IF;
    RETURN jsonb_build_object('status','existing','job',to_jsonb(existing));
  END IF;
  IF EXISTS (SELECT 1 FROM public.design_extract_projects WHERE id = target_project AND revision <> expected_revision) THEN
    RETURN jsonb_build_object('status','revision_conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM public.design_extract_jobs WHERE project_id = target_project AND status IN ('submitting','queued','processing','saving','ready')) THEN
    RETURN jsonb_build_object('status','operation_active');
  END IF;
  SELECT credits INTO balance FROM public.profiles WHERE id = target_user FOR UPDATE;
  IF balance IS NULL OR balance < cost THEN
    RETURN jsonb_build_object('status','insufficient_credits','credits_remaining',COALESCE(balance,0));
  END IF;
  INSERT INTO public.design_extract_jobs(project_id,user_id,base_revision,idempotency_key,kind,layer_id,model,input,charge_amount,billing_state)
    VALUES(target_project,target_user,expected_revision,request_key,operation_kind,target_layer,provider_model,provider_input,cost,'held')
    RETURNING * INTO claimed;
  UPDATE public.profiles SET credits = credits - cost WHERE id = target_user;
  INSERT INTO public.design_extract_ledger(job_id,user_id,amount) VALUES(claimed.id,target_user,cost);
  INSERT INTO public.credit_logs(user_id,action,amount) VALUES(target_user,'Design Extract: ' || operation_kind,-cost);
  RETURN jsonb_build_object('status','charged','job',to_jsonb(claimed),'credits_remaining',balance-cost);
END;
$$;

CREATE FUNCTION public.settle_design_extract_billing(target_user uuid, target_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  operation public.design_extract_jobs%ROWTYPE;
  entry public.design_extract_ledger%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM public.design_extract_jobs WHERE id = target_job AND user_id = target_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF operation.billing_state = 'beta' THEN RETURN jsonb_build_object('status','beta'); END IF;
  SELECT * INTO entry FROM public.design_extract_ledger WHERE job_id = target_job AND user_id = target_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing extraction ledger'; END IF;
  IF entry.state <> 'held' THEN RETURN jsonb_build_object('status',entry.state); END IF;
  IF operation.status IN ('ready','accepted','rejected') AND jsonb_typeof(operation.result->'layers') = 'array' AND jsonb_array_length(operation.result->'layers') > 0 THEN
    UPDATE public.design_extract_ledger SET state = 'settled', updated_at = now() WHERE job_id = target_job;
    UPDATE public.design_extract_jobs SET billing_state = 'settled' WHERE id = target_job;
    RETURN jsonb_build_object('status','settled');
  END IF;
  IF operation.status = 'failed' AND COALESCE(jsonb_array_length(operation.result->'layers'),0) = 0 THEN
    UPDATE public.profiles SET credits = credits + entry.amount WHERE id = target_user;
    INSERT INTO public.credit_logs(user_id,action,amount) VALUES(target_user,'Design Extract refund',entry.amount);
    UPDATE public.design_extract_ledger SET state = 'refunded', updated_at = now() WHERE job_id = target_job;
    UPDATE public.design_extract_jobs SET billing_state = 'refunded' WHERE id = target_job;
    RETURN jsonb_build_object('status','refunded');
  END IF;
  RETURN jsonb_build_object('status','held');
END;
$$;
REVOKE ALL ON FUNCTION public.claim_design_extract(uuid,uuid,integer,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_design_extract_billing(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_design_extract(uuid,uuid,integer,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_design_extract_billing(uuid,uuid) TO service_role;
COMMIT;
