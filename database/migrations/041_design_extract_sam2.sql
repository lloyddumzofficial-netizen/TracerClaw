-- Permit the budget SAM 2 providers without changing tariffs, refunds or access.
-- Existing Qwen/SAM 3 receipts remain valid for recovery during rollout.
BEGIN;
DO $migration$
DECLARE
  definition text;
  old_rule text := $old$IF provider_model IS DISTINCT FROM (CASE WHEN operation_kind = 'segment' THEN 'fal-ai/sam-3/image' ELSE 'fal-ai/qwen-image-layered' END) THEN$old$;
  new_rule text := $new$-- SAM2_MODEL_ALLOWLIST_V1
  IF provider_model IS NULL
    OR (operation_kind = 'segment' AND provider_model NOT IN ('fal-ai/sam2/image','fal-ai/sam-3/image'))
    OR (operation_kind IN ('extract','split') AND provider_model NOT IN ('fal-ai/sam2/auto-segment','fal-ai/qwen-image-layered')) THEN$new$;
BEGIN
  SELECT pg_get_functiondef('public.claim_design_extract(uuid,uuid,integer,text,text,text,text,jsonb)'::regprocedure) INTO definition;
  IF position('SAM2_MODEL_ALLOWLIST_V1' IN definition) > 0 THEN RETURN; END IF;
  IF position(old_rule IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected Design Extract claim function. No model or billing changes applied.';
  END IF;
  -- CREATE OR REPLACE preserves ownership and existing function privileges.
  -- Only this known model-validation predicate is replaced.
  EXECUTE replace(definition, old_rule, new_rule);
END;
$migration$;
COMMIT;
