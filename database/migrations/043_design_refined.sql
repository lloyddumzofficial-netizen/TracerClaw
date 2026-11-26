BEGIN;

ALTER TABLE public.design_extract_jobs DROP CONSTRAINT design_extract_jobs_kind_check;
ALTER TABLE public.design_extract_jobs ADD CONSTRAINT design_extract_jobs_kind_check
  CHECK (kind IN ('extract','split','segment','refine'));

-- Extend the existing locked reservation and refund paths. Keep legacy rates and grants.
DO $migration$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_design_extract(uuid,uuid,integer,text,text,text,text,jsonb)'::regprocedure) INTO definition;
  IF position('SAM2_MODEL_ALLOWLIST_V1' IN definition) = 0 THEN
    RAISE EXCEPTION 'Apply Design Extract migration 041 first.';
  END IF;
  IF position('operation_kind = ''refine''' IN definition) = 0 THEN
    EXECUTE replace(replace(replace(replace(definition,
      'operation_kind NOT IN (''extract'',''split'',''segment'')',
      'operation_kind IS NULL OR operation_kind NOT IN (''extract'',''split'',''segment'',''refine'')'),
      'IF provider_model IS NULL',
      'IF provider_model IS NULL OR (operation_kind = ''refine'' AND (provider_model <> ''google/nano-banana-2.1/edit'' OR target_layer IS NOT NULL))'),
      'input,charge_amount,billing_state)',
      'input,charge_amount,billing_state,processor)'),
      'provider_input,cost,''held'')',
      'provider_input,cost,''held'',CASE WHEN operation_kind = ''refine'' THEN ''local'' ELSE ''legacy'' END)');
  END IF;
  SELECT pg_get_functiondef('public.claim_design_extract_v2(uuid,uuid,integer,text,text,text,text,jsonb,text)'::regprocedure) INTO definition;
  IF position('''local''' IN definition) = 0 THEN
    RAISE EXCEPTION 'Apply Design Extract migration 042 first.';
  END IF;
  IF position('operation_kind = ''refine''' IN definition) = 0 THEN
    EXECUTE replace(definition, '  reservation := public.claim_design_extract',
      E'  IF operation_kind = ''refine'' AND operation_processor <> ''local'' THEN\n    RAISE EXCEPTION ''Refinement requires the local processor'';\n  END IF;\n  reservation := public.claim_design_extract');
  END IF;
  SELECT pg_get_functiondef('public.settle_design_extract_billing(uuid,uuid)'::regprocedure) INTO definition;
  IF position('operation.kind = ''refine''' IN definition) = 0 THEN
    EXECUTE replace(replace(definition,
      'jsonb_array_length(operation.result->''layers'') > 0 THEN',
      'jsonb_array_length(operation.result->''layers'') >= (CASE WHEN operation.kind = ''refine'' THEN 3 ELSE 1 END) THEN'),
      'IF operation.status = ''failed'' AND COALESCE(jsonb_array_length(operation.result->''layers''),0) = 0 THEN',
      'IF (operation.status = ''failed'' AND COALESCE(jsonb_array_length(operation.result->''layers''),0) = 0) OR (operation.kind = ''refine'' AND operation.status IN (''ready'',''accepted'',''rejected'') AND COALESCE(jsonb_array_length(operation.result->''layers''),0) < 3) THEN');
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.design_refine_available()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.design_refine_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.design_refine_available() TO service_role;

COMMIT;
