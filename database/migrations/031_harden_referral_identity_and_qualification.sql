-- Follow-up hardening for the referral launch. Migration 030 may already be
-- deployed, so all fixes live in this forward-only migration.

BEGIN;

-- Canonicalize common provider aliases for referral-abuse checks only. This
-- does not modify the user's login email. Plus tags are ignored for all
-- domains; Gmail/Googlemail also ignore dots and share one canonical domain.
CREATE OR REPLACE FUNCTION public.canonical_referral_email(input_email text)
RETURNS text AS $$
DECLARE
  normalized text := lower(btrim(COALESCE(input_email, '')));
  local_part text;
  domain_part text;
BEGIN
  IF normalized = '' OR position('@' IN normalized) <= 1 THEN
    RETURN normalized;
  END IF;

  local_part := split_part(normalized, '@', 1);
  domain_part := split_part(normalized, '@', 2);
  local_part := split_part(local_part, '+', 1);

  IF domain_part IN ('gmail.com', 'googlemail.com') THEN
    local_part := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  END IF;

  RETURN local_part || '@' || domain_part;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = public;

CREATE OR REPLACE FUNCTION public.bind_referral_and_grant_trial(
  target_code_hash text,
  target_invitee_user_id uuid,
  target_invitee_email text,
  target_email_domain text,
  target_auth_provider text,
  target_device_hash text,
  target_network_hash text,
  target_referral_issued_at timestamptz,
  target_disposable_email boolean DEFAULT false
)
RETURNS TABLE(status text, referral_id uuid, credits_remaining integer) AS $$
DECLARE
  target_code public.referral_codes%ROWTYPE;
  invitee_profile public.profiles%ROWTYPE;
  referrer_profile public.profiles%ROWTYPE;
  existing_referral public.referrals%ROWTYPE;
  new_referral_id uuid;
  new_credits integer;
  rejection text;
  credit_reference uuid := gen_random_uuid();
  network_seen boolean := false;
BEGIN
  SELECT * INTO existing_referral FROM public.referrals
    WHERE invitee_user_id = target_invitee_user_id FOR UPDATE;
  IF FOUND THEN
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_invitee_user_id;
    RETURN QUERY SELECT existing_referral.status, existing_referral.id, new_credits;
    RETURN;
  END IF;

  SELECT * INTO target_code FROM public.referral_codes
    WHERE code_hash = target_code_hash AND enabled = true FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_code'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(target_device_hash, target_invitee_user_id::text)));

  SELECT * INTO invitee_profile FROM public.profiles
    WHERE id = target_invitee_user_id FOR UPDATE;
  SELECT * INTO referrer_profile FROM public.profiles
    WHERE id = target_code.owner_user_id;
  IF invitee_profile.id IS NULL OR referrer_profile.id IS NULL THEN
    RETURN QUERY SELECT 'profile_missing'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  IF target_code.owner_user_id = target_invitee_user_id
     OR lower(referrer_profile.email) = lower(target_invitee_email) THEN
    rejection := 'self_referral';
  ELSIF public.canonical_referral_email(referrer_profile.email)
        = public.canonical_referral_email(target_invitee_email) THEN
    rejection := 'self_referral_alias';
  ELSIF invitee_profile.created_at < target_referral_issued_at - interval '5 minutes' THEN
    rejection := 'existing_account';
  ELSIF target_disposable_email THEN
    rejection := 'disposable_email';
  ELSIF target_device_hash IS NOT NULL AND target_code.owner_device_hash = target_device_hash THEN
    rejection := 'same_device_as_referrer';
  ELSIF target_device_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.referrals r
    WHERE r.device_hash = target_device_hash
      AND r.trial_granted_at IS NOT NULL
      AND r.created_at > timezone('utc'::text, now()) - interval '90 days'
  ) THEN
    rejection := 'trial_device_reused';
  END IF;

  IF target_network_hash IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.referrals r
      WHERE r.network_hash = target_network_hash
        AND r.invitee_user_id <> target_invitee_user_id
    ) INTO network_seen;
  END IF;

  INSERT INTO public.referrals (
    referral_code_id, referrer_user_id, referrer_email,
    invitee_user_id, invitee_email, invitee_email_domain, auth_provider,
    status, device_hash, network_hash, referral_issued_at,
    rejected_at, rejection_reason
  ) VALUES (
    target_code.id, target_code.owner_user_id, lower(referrer_profile.email),
    target_invitee_user_id, lower(target_invitee_email), lower(target_email_domain),
    COALESCE(NULLIF(target_auth_provider, ''), 'email'),
    CASE WHEN rejection IS NULL THEN 'bound' ELSE 'rejected' END,
    target_device_hash, target_network_hash, target_referral_issued_at,
    CASE WHEN rejection IS NULL THEN NULL ELSE timezone('utc'::text, now()) END,
    rejection
  ) RETURNING id INTO new_referral_id;

  IF network_seen THEN
    INSERT INTO public.referral_risk_signals (
      referral_id, signal_type, severity, evidence_hash
    ) VALUES (new_referral_id, 'shared_network', 'medium', target_network_hash);
  END IF;

  IF rejection IS NOT NULL THEN
    INSERT INTO public.referral_risk_signals (
      referral_id, signal_type, severity, evidence_hash
    ) VALUES (
      new_referral_id, rejection, 'high',
      CASE WHEN rejection LIKE '%device%' THEN target_device_hash ELSE NULL END
    );
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_invitee_user_id;
    RETURN QUERY SELECT 'rejected'::text, new_referral_id, new_credits;
    RETURN;
  END IF;

  UPDATE public.profiles SET credits = credits + 1
    WHERE id = target_invitee_user_id RETURNING credits INTO new_credits;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitee profile not found during trial grant'; END IF;

  INSERT INTO public.credit_logs (user_id, action, amount, reference_id)
  VALUES (target_invitee_user_id, 'Referral trial Claw', 1, credit_reference);

  INSERT INTO public.referral_rewards (
    referral_id, recipient_user_id, reward_type, amount, status,
    available_at, settled_at, credit_log_reference
  ) VALUES (
    new_referral_id, target_invitee_user_id, 'invitee_trial', 1, 'rewarded',
    timezone('utc'::text, now()), timezone('utc'::text, now()), credit_reference
  );

  UPDATE public.referrals SET
    status = 'trial_granted',
    trial_granted_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = new_referral_id;

  RETURN QUERY SELECT 'trial_granted'::text, new_referral_id, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A successful referral project must be both charged and have a nonblank
-- server-persisted output. Watching credit_deducted also covers the rare case
-- where output persistence completes before the atomic charge flag is set.
CREATE OR REPLACE FUNCTION public.capture_successful_project_for_referrals()
RETURNS trigger AS $$
DECLARE
  completion_kind_value text;
  inserted_event_id uuid;
  qualified_referral_id uuid;
BEGIN
  IF NEW.user_id IS NULL
     OR COALESCE(NEW.refunded, false) = true
     OR COALESCE(NEW.credit_deducted, false) = false THEN
    RETURN NEW;
  END IF;

  completion_kind_value := CASE
    WHEN NULLIF(btrim(NEW.svg_url), '') IS NOT NULL THEN 'svg'
    WHEN NULLIF(btrim(NEW.upscaled_image_url), '') IS NOT NULL THEN 'upscale'
    WHEN NULLIF(btrim(NEW.generated_image_url), '') IS NOT NULL
         AND NEW.generated_image_url <> 'REFUNDED' THEN 'generated_image'
    ELSE NULL
  END;
  IF completion_kind_value IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.successful_project_events (project_id, user_id, completion_kind)
  VALUES (NEW.id, NEW.user_id, completion_kind_value)
  ON CONFLICT (project_id) DO NOTHING
  RETURNING id INTO inserted_event_id;
  IF inserted_event_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.user_activity_summary (
    user_id, account_created_at, completed_project_count,
    first_completed_project_at, last_completed_project_at
  )
  SELECT NEW.user_id, p.created_at, 1, timezone('utc'::text, now()), timezone('utc'::text, now())
  FROM public.profiles p WHERE p.id = NEW.user_id
  ON CONFLICT (user_id) DO UPDATE SET
    completed_project_count = public.user_activity_summary.completed_project_count + 1,
    first_completed_project_at = COALESCE(
      public.user_activity_summary.first_completed_project_at,
      timezone('utc'::text, now())
    ),
    last_completed_project_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now());

  UPDATE public.referrals SET
    status = 'pending_review',
    qualified_at = timezone('utc'::text, now()),
    review_after = timezone('utc'::text, now()) + interval '72 hours',
    updated_at = timezone('utc'::text, now())
  WHERE invitee_user_id = NEW.user_id AND status = 'trial_granted'
  RETURNING id INTO qualified_referral_id;

  IF qualified_referral_id IS NOT NULL THEN
    INSERT INTO public.referral_rewards (
      referral_id, recipient_user_id, reward_type, amount, status, available_at
    )
    SELECT id, referrer_user_id, 'referrer_completion', 1, 'pending', review_after
    FROM public.referrals WHERE id = qualified_referral_id
    ON CONFLICT (referral_id, reward_type) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS projects_capture_referral_success ON public.projects;
CREATE TRIGGER projects_capture_referral_success
  AFTER INSERT OR UPDATE OF generated_image_url, upscaled_image_url, svg_url, refunded, credit_deducted
  ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.capture_successful_project_for_referrals();

-- Remove any history that migration 030 may have seeded from an uncharged,
-- refunded, or output-less project, then rebuild the summary deterministically.
DELETE FROM public.successful_project_events e
USING public.projects p
WHERE p.id = e.project_id
  AND (
    COALESCE(p.credit_deducted, false) = false
    OR COALESCE(p.refunded, false) = true
    OR NOT (
      NULLIF(btrim(p.svg_url), '') IS NOT NULL
      OR NULLIF(btrim(p.upscaled_image_url), '') IS NOT NULL
      OR (
        NULLIF(btrim(p.generated_image_url), '') IS NOT NULL
        AND p.generated_image_url <> 'REFUNDED'
      )
    )
  );

UPDATE public.user_activity_summary summary SET
  completed_project_count = aggregate.completed_project_count,
  first_completed_project_at = aggregate.first_completed_project_at,
  last_completed_project_at = aggregate.last_completed_project_at,
  updated_at = timezone('utc'::text, now())
FROM (
  SELECT
    profile.id AS user_id,
    count(event.id)::integer AS completed_project_count,
    min(event.completed_at) AS first_completed_project_at,
    max(event.completed_at) AS last_completed_project_at
  FROM public.profiles profile
  LEFT JOIN public.successful_project_events event ON event.user_id = profile.id
  GROUP BY profile.id
) aggregate
WHERE summary.user_id = aggregate.user_id;

-- A pending referral whose only qualifying event was removed should return to
-- trial_granted instead of being rewarded or permanently rejected.
DELETE FROM public.referral_rewards reward
USING public.referrals referral
WHERE reward.referral_id = referral.id
  AND reward.reward_type = 'referrer_completion'
  AND reward.status = 'pending'
  AND referral.status = 'pending_review'
  AND NOT EXISTS (
    SELECT 1 FROM public.successful_project_events event
    WHERE event.user_id = referral.invitee_user_id
  );

UPDATE public.referrals referral SET
  status = 'trial_granted',
  qualified_at = NULL,
  review_after = NULL,
  updated_at = timezone('utc'::text, now())
WHERE referral.status = 'pending_review'
  AND NOT EXISTS (
    SELECT 1 FROM public.successful_project_events event
    WHERE event.user_id = referral.invitee_user_id
  );

REVOKE EXECUTE ON FUNCTION public.canonical_referral_email(text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.bind_referral_and_grant_trial(text,uuid,text,text,text,text,text,timestamptz,boolean) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.capture_successful_project_for_referrals() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.bind_referral_and_grant_trial(text,uuid,text,text,text,text,text,timestamptz,boolean) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
