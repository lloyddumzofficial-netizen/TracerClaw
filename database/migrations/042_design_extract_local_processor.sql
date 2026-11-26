BEGIN;

ALTER TABLE public.design_extract_jobs DROP CONSTRAINT design_extract_jobs_processor_check;
ALTER TABLE public.design_extract_jobs ADD CONSTRAINT design_extract_jobs_processor_check
  CHECK (processor IN ('legacy', 'workflow', 'local'));

-- Publish local jobs atomically with their existing billing reservation. The
-- workflow trigger only enqueues 'workflow', and deployed legacy workers
-- only select 'legacy'.
CREATE OR REPLACE FUNCTION public.claim_design_extract_v2(
  target_user uuid, target_project uuid, expected_revision integer,
  request_key text, operation_kind text, target_layer text,
  provider_model text, provider_input jsonb, operation_processor text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reservation jsonb; claimed public.design_extract_jobs%ROWTYPE;
BEGIN
  IF operation_processor IS NULL OR operation_processor NOT IN ('legacy', 'workflow', 'local') THEN
    RAISE EXCEPTION 'Invalid processor';
  END IF;
  reservation := public.claim_design_extract(target_user, target_project, expected_revision, request_key, operation_kind, target_layer, provider_model, provider_input);
  IF reservation->>'status' = 'charged' THEN
    UPDATE public.design_extract_jobs SET processor = operation_processor
      WHERE id = (reservation->'job'->>'id')::uuid AND user_id = target_user
      RETURNING * INTO claimed;
    reservation := jsonb_set(reservation, '{job}', to_jsonb(claimed));
  END IF;
  RETURN reservation;
END;
$$;

COMMIT;
