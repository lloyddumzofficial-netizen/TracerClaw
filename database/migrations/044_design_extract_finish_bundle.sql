BEGIN;

CREATE TABLE IF NOT EXISTS public.design_extract_finish_bundles (
  batch_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('held','unlocked','refunded')),
  reserved_by uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.design_extract_finish_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.design_extract_finish_bundles(batch_id) ON DELETE CASCADE,
  layer_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('upscale','svg')),
  state text NOT NULL CHECK (state IN ('pending','saved','refunded')),
  estimated_provider_usd numeric(10,6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS design_extract_finish_one_action
  ON public.design_extract_finish_actions(batch_id, layer_id, action) WHERE state <> 'refunded';
ALTER TABLE public.design_extract_finish_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_extract_finish_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_extract_finish_bundles, public.design_extract_finish_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.design_extract_finish_bundles, public.design_extract_finish_actions TO service_role;

CREATE OR REPLACE FUNCTION public.claim_design_extract_finish(
  target_user uuid, target_project uuid, expected_revision integer,
  target_layer text, requested_action text, acknowledged_claws integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  project public.design_extract_projects%ROWTYPE;
  batch uuid;
  bundle public.design_extract_finish_bundles%ROWTYPE;
  operation public.design_extract_finish_actions%ROWTYPE;
  operation_id uuid := gen_random_uuid();
  balance integer;
BEGIN
  IF requested_action IS NULL OR requested_action NOT IN ('upscale','svg') THEN
    RAISE EXCEPTION 'Invalid finishing action';
  END IF;
  SELECT * INTO project FROM public.design_extract_projects
    WHERE id = target_project AND user_id = target_user AND expires_at > now() FOR UPDATE;
  IF NOT FOUND OR project.revision <> expected_revision THEN RETURN jsonb_build_object('status','stale'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(project.manifest->'layers') layer
    WHERE layer->>'id' = target_layer AND COALESCE(layer->>'kind','raster') = 'raster') THEN
    RETURN jsonb_build_object('status','stale');
  END IF;
  SELECT id INTO batch FROM public.design_extract_jobs
    WHERE project_id = target_project AND user_id = target_user AND kind = 'extract' AND status = 'accepted'
      AND input #>> '{_desaynclaw,nanoElements}' = 'true'
      AND result->'layers' @> jsonb_build_array(jsonb_build_object('id',target_layer))
    ORDER BY created_at DESC LIMIT 1;
  IF batch IS NULL THEN RETURN jsonb_build_object('status','legacy'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.design_extract_jobs job,
    LATERAL jsonb_array_elements(job.result->'layers') WITH ORDINALITY AS item(layer, position)
    WHERE job.id = batch AND item.position <= 9 AND item.layer->>'id' = target_layer) THEN
    RETURN jsonb_build_object('status','limit');
  END IF;
  SELECT * INTO bundle FROM public.design_extract_finish_bundles WHERE batch_id = batch FOR UPDATE;
  SELECT * INTO operation FROM public.design_extract_finish_actions
    WHERE batch_id = batch AND layer_id = target_layer AND action = requested_action AND state <> 'refunded';
  IF FOUND THEN RETURN jsonb_build_object('status',CASE WHEN operation.state = 'saved' THEN 'used' ELSE 'pending' END); END IF;
  IF bundle.state = 'held' THEN RETURN jsonb_build_object('status','pending'); END IF;
  IF bundle.state IS DISTINCT FROM 'unlocked' THEN
    IF acknowledged_claws IS DISTINCT FROM 1 THEN RETURN jsonb_build_object('status','offer'); END IF;
    SELECT credits INTO balance FROM public.profiles WHERE id = target_user FOR UPDATE;
    IF balance IS NULL OR balance < 1 THEN RETURN jsonb_build_object('status','insufficient'); END IF;
    UPDATE public.profiles SET credits = credits - 1 WHERE id = target_user;
    INSERT INTO public.credit_logs(user_id,action,amount) VALUES(target_user,'Design Extract: Upscale + SVG',-1);
    INSERT INTO public.design_extract_finish_bundles(batch_id,user_id,state,reserved_by)
      VALUES(batch,target_user,'held',operation_id)
      ON CONFLICT (batch_id) DO UPDATE SET state = 'held', reserved_by = EXCLUDED.reserved_by;
  END IF;
  INSERT INTO public.design_extract_finish_actions(id,batch_id,layer_id,action,state)
    VALUES(operation_id,batch,target_layer,requested_action,'pending');
  RETURN jsonb_build_object('status','claimed','id',operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_design_extract_finish(target_user uuid, target_action uuid, usable boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bundle public.design_extract_finish_bundles%ROWTYPE;
  operation public.design_extract_finish_actions%ROWTYPE;
BEGIN
  SELECT b.* INTO bundle FROM public.design_extract_finish_bundles b
    JOIN public.design_extract_finish_actions a ON a.batch_id = b.batch_id
    WHERE a.id = target_action AND b.user_id = target_user FOR UPDATE OF b;
  IF NOT FOUND THEN RAISE EXCEPTION 'Finishing action not found'; END IF;
  SELECT * INTO operation FROM public.design_extract_finish_actions WHERE id = target_action FOR UPDATE;
  IF operation.state <> 'pending' THEN RETURN; END IF;
  UPDATE public.design_extract_finish_actions
    SET state = CASE WHEN usable THEN 'saved' ELSE 'refunded' END,
        estimated_provider_usd = CASE WHEN usable AND operation.action = 'upscale' THEN .004
          WHEN usable AND operation.action = 'svg' THEN .010 ELSE NULL END
    WHERE id = target_action;
  IF bundle.state = 'held' AND bundle.reserved_by = target_action THEN
    UPDATE public.design_extract_finish_bundles SET state = CASE WHEN usable THEN 'unlocked' ELSE 'refunded' END
      WHERE batch_id = bundle.batch_id;
    IF NOT usable THEN
      UPDATE public.profiles SET credits = credits + 1 WHERE id = target_user;
      INSERT INTO public.credit_logs(user_id,action,amount) VALUES(target_user,'Design Extract: Upscale + SVG refund',1);
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_design_extract_finish(uuid,uuid,integer,text,text,integer),
  public.settle_design_extract_finish(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_design_extract_finish(uuid,uuid,integer,text,text,integer),
  public.settle_design_extract_finish(uuid,uuid,boolean) TO service_role;
COMMIT;
