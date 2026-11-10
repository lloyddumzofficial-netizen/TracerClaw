-- All signup-trial credit writes move behind one atomic, service-only boundary.
-- Deploy dark: a deliberate backfill and activation are required before grants.
BEGIN;

CREATE TABLE public.welcome_trial_campaign (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  launched_at timestamptz,
  backfill_completed_at timestamptz,
  secret_check text,
  daily_limit integer NOT NULL DEFAULT 25 CHECK (daily_limit BETWEEN 1 AND 25)
);
INSERT INTO public.welcome_trial_campaign(id) VALUES (true);

-- No auth.users FK: deleting/recreating an account must not reset eligibility.
CREATE TABLE public.welcome_trial_receipts (
  user_id uuid PRIMARY KEY,
  google_hash text UNIQUE,
  email_hash text UNIQUE,
  device_hash text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  credit_reference uuid UNIQUE,
  source text NOT NULL CHECK (source IN ('legacy_referral', 'welcome', 'referral'))
);
CREATE INDEX welcome_trial_device_idx ON public.welcome_trial_receipts(device_hash, granted_at DESC);
CREATE TABLE public.welcome_trial_identity_blocks (
  kind text NOT NULL CHECK (kind IN ('google', 'email')),
  fingerprint text NOT NULL,
  PRIMARY KEY(kind, fingerprint)
);
CREATE TABLE public.welcome_trial_daily (
  grant_date date PRIMARY KEY,
  grants integer NOT NULL DEFAULT 0 CHECK (grants BETWEEN 0 AND 25)
);
CREATE TABLE public.welcome_trial_intents (
  nonce uuid PRIMARY KEY,
  device_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.welcome_trial_claims (
  user_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('granted', 'pending_allocation', 'ineligible', 'temporarily_unavailable')),
  reason text NOT NULL,
  retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.welcome_trial_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_trial_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_trial_identity_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_trial_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_trial_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_trial_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_trial_campaign, public.welcome_trial_receipts,
  public.welcome_trial_identity_blocks, public.welcome_trial_daily,
  public.welcome_trial_intents, public.welcome_trial_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.welcome_trial_campaign, public.welcome_trial_receipts,
  public.welcome_trial_identity_blocks, public.welcome_trial_daily,
  public.welcome_trial_intents, public.welcome_trial_claims TO service_role;

-- Import historical trial receipts without writing profiles or credit_logs.
INSERT INTO public.welcome_trial_receipts(user_id, device_hash, granted_at, credit_reference, source)
SELECT DISTINCT ON (r.invitee_user_id) r.invitee_user_id, r.device_hash,
  r.trial_granted_at, reward.credit_log_reference, 'legacy_referral'
FROM public.referrals r
LEFT JOIN public.referral_rewards reward ON reward.referral_id = r.id AND reward.reward_type = 'invitee_trial'
WHERE r.trial_granted_at IS NOT NULL
ORDER BY r.invitee_user_id, r.trial_granted_at
ON CONFLICT DO NOTHING;

-- A quota-deferred invitee can complete a paid project while still bound.
-- Reuse durable successful-project evidence after the trial eventually lands;
-- do not lose that event or shorten the existing 72-hour security hold.
CREATE FUNCTION public.qualify_deferred_trial_referral(target_referral_id uuid) RETURNS void AS $$
DECLARE qualified_id uuid;
BEGIN
  UPDATE public.referrals r SET status = 'pending_review', qualified_at = now(),
    review_after = now() + interval '72 hours', updated_at = now()
  WHERE r.id = target_referral_id AND r.status = 'trial_granted' AND EXISTS (
    SELECT 1 FROM public.successful_project_events e
    WHERE e.user_id = r.invitee_user_id AND e.completed_at >= r.bound_at
  ) RETURNING r.id INTO qualified_id;
  IF qualified_id IS NOT NULL THEN
    INSERT INTO public.referral_rewards(referral_id, recipient_user_id, reward_type, amount, status, available_at)
    SELECT r.id, r.referrer_user_id, 'referrer_completion', 1, 'pending', r.review_after
    FROM public.referrals r WHERE r.id = qualified_id
    ON CONFLICT (referral_id, reward_type) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.qualify_deferred_trial_referral(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qualify_deferred_trial_referral(uuid) TO service_role;

CREATE FUNCTION public.grant_google_welcome_trial(
  target_user_id uuid, target_google_subject text, target_google_hash text,
  target_email_hash text, target_device_hash text, target_nonce uuid,
  target_secret_check text
)
RETURNS TABLE(status text, reason text, balance integer, retry_at timestamptz) AS $$
DECLARE
  campaign public.welcome_trial_campaign%ROWTYPE;
  proof public.welcome_trial_intents%ROWTYPE;
  account auth.users%ROWTYPE;
  receipt public.welcome_trial_receipts%ROWTYPE;
  referral public.referrals%ROWTYPE;
  next_status text := 'ineligible';
  next_reason text;
  next_retry timestamptz;
  current_balance integer;
  used integer;
  today date := (now() AT TIME ZONE 'UTC')::date;
  credit_id uuid := gen_random_uuid();
BEGIN
  -- Proof consumed in the same transaction as the decision and credit write.
  SELECT * INTO proof FROM public.welcome_trial_intents WHERE nonce = target_nonce FOR UPDATE;
  IF NOT FOUND OR proof.consumed_at IS NOT NULL OR proof.expires_at <= now()
     OR proof.device_hash IS DISTINCT FROM target_device_hash THEN
    RETURN QUERY SELECT 'temporarily_unavailable'::text, 'invalid_proof'::text, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;
  UPDATE public.welcome_trial_intents SET consumed_at = now() WHERE nonce = target_nonce;

  -- A global campaign row serializes grants, identity checks, and UTC quota.
  -- This deliberately favors correctness over throughput for a 25/day pilot.
  SELECT * INTO campaign FROM public.welcome_trial_campaign WHERE id = true FOR UPDATE;
  SELECT * INTO account FROM auth.users WHERE id = target_user_id;
  SELECT credits INTO current_balance FROM public.profiles WHERE id = target_user_id FOR UPDATE;
  IF account.id IS NULL OR current_balance IS NULL THEN
    RETURN QUERY SELECT 'temporarily_unavailable'::text, 'profile_missing'::text, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO receipt FROM public.welcome_trial_receipts WHERE user_id = target_user_id;
  IF FOUND THEN
    RETURN QUERY SELECT 'granted'::text, 'already_granted'::text, current_balance, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT campaign.enabled OR campaign.launched_at IS NULL OR campaign.backfill_completed_at IS NULL
     OR campaign.secret_check IS DISTINCT FROM target_secret_check THEN
    next_status := 'temporarily_unavailable'; next_reason := 'campaign_unavailable';
  ELSIF account.created_at < campaign.launched_at
     OR account.raw_app_meta_data->>'provider' IS DISTINCT FROM 'google' THEN
    next_reason := 'existing_or_email_account';
  ELSIF target_google_hash !~ '^[a-f0-9]{64}$' OR target_email_hash !~ '^[a-f0-9]{64}$'
     OR target_device_hash IS NULL OR target_google_hash IS NULL OR target_email_hash IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM auth.identities i WHERE i.user_id = target_user_id
         AND i.provider = 'google' AND i.provider_id = target_google_subject
         AND lower(i.identity_data->>'email') ~ '^[^@[:space:]]+@gmail\.com$'
     ) THEN
    next_reason := 'unverified_google_identity';
  ELSIF EXISTS (SELECT 1 FROM public.welcome_trial_identity_blocks b
       WHERE (b.kind = 'google' AND b.fingerprint = target_google_hash)
          OR (b.kind = 'email' AND b.fingerprint = target_email_hash))
     OR EXISTS (SELECT 1 FROM public.welcome_trial_receipts r
       WHERE r.google_hash = target_google_hash OR r.email_hash = target_email_hash) THEN
    next_reason := 'identity_already_used';
  ELSIF EXISTS (SELECT 1 FROM public.welcome_trial_receipts r
       WHERE r.device_hash = target_device_hash AND r.granted_at > now() - interval '90 days') THEN
    next_reason := 'browser_trial_used';
  ELSE
    INSERT INTO public.welcome_trial_daily(grant_date) VALUES (today) ON CONFLICT DO NOTHING;
    SELECT grants INTO used FROM public.welcome_trial_daily WHERE grant_date = today;
    IF used >= campaign.daily_limit THEN
      next_status := 'pending_allocation'; next_reason := 'daily_limit';
      next_retry := ((today + 1)::timestamp AT TIME ZONE 'UTC');
    ELSE
      SELECT r.* INTO referral FROM public.referrals r
        WHERE r.invitee_user_id = target_user_id AND r.auth_provider = 'google' AND r.status = 'bound' FOR UPDATE;
      INSERT INTO public.welcome_trial_receipts(user_id, google_hash, email_hash, device_hash, credit_reference, source)
      VALUES(target_user_id, target_google_hash, target_email_hash, target_device_hash, credit_id,
        CASE WHEN referral.id IS NULL THEN 'welcome' ELSE 'referral' END);
      UPDATE public.profiles SET credits = credits + 1 WHERE id = target_user_id RETURNING credits INTO current_balance;
      INSERT INTO public.credit_logs(user_id, action, amount, reference_id)
      VALUES(target_user_id, 'Welcome trial Claw', 1, credit_id);
      UPDATE public.welcome_trial_daily SET grants = grants + 1 WHERE grant_date = today;
      IF referral.id IS NOT NULL THEN
        INSERT INTO public.referral_rewards(referral_id, recipient_user_id, reward_type, amount, status,
          available_at, settled_at, credit_log_reference)
        VALUES(referral.id, target_user_id, 'invitee_trial', 1, 'rewarded', now(), now(), credit_id);
        UPDATE public.referrals SET status = 'trial_granted', trial_granted_at = now(), updated_at = now() WHERE id = referral.id;
        PERFORM public.qualify_deferred_trial_referral(referral.id);
      END IF;
      next_status := 'granted'; next_reason := 'awarded';
    END IF;
  END IF;
  INSERT INTO public.welcome_trial_claims(user_id, status, reason, retry_at)
  VALUES(target_user_id, next_status, next_reason, next_retry)
  ON CONFLICT(user_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason,
    retry_at = EXCLUDED.retry_at, updated_at = now();
  RETURN QUERY SELECT next_status, next_reason, current_balance, next_retry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.grant_google_welcome_trial(uuid,text,text,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_google_welcome_trial(uuid,text,text,text,text,uuid,text) TO service_role;

CREATE FUNCTION public.get_google_trial_status(target_user_id uuid)
RETURNS TABLE(status text, reason text, balance integer, retry_at timestamptz, granted_at timestamptz, source text) AS $$
BEGIN
  RETURN QUERY SELECT
    CASE WHEN r.user_id IS NOT NULL THEN 'granted'
      WHEN u.created_at < c.launched_at OR u.raw_app_meta_data->>'provider' IS DISTINCT FROM 'google'
        OR lower(u.email) !~ '^[^@[:space:]]+@gmail\.com$' THEN 'ineligible'
      ELSE COALESCE(cl.status, 'temporarily_unavailable') END,
    CASE WHEN r.user_id IS NOT NULL THEN 'already_granted' ELSE COALESCE(cl.reason, 'google_sign_in_required') END,
    p.credits,
    cl.retry_at, r.granted_at, r.source
  FROM auth.users u JOIN public.profiles p ON p.id = u.id
  CROSS JOIN public.welcome_trial_campaign c
  LEFT JOIN public.welcome_trial_claims cl ON cl.user_id = u.id
  LEFT JOIN public.welcome_trial_receipts r ON r.user_id = u.id
  WHERE u.id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_google_trial_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_trial_status(uuid) TO service_role;

-- Cleanup is invoked by the existing daily referral cron and by the backfill.
CREATE FUNCTION public.cleanup_welcome_trial_intents() RETURNS void AS $$
  DELETE FROM public.welcome_trial_intents WHERE expires_at < now() - interval '1 day';
  UPDATE public.welcome_trial_receipts SET device_hash = NULL
    WHERE device_hash IS NOT NULL AND granted_at <= now() - interval '90 days';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.cleanup_welcome_trial_intents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_welcome_trial_intents() TO service_role;

-- Read-only readiness check is also usable by the activation runbook.
CREATE FUNCTION public.activate_google_trial_campaign() RETURNS timestamptz AS $$
DECLARE launched timestamptz;
BEGIN
  UPDATE public.welcome_trial_campaign SET enabled = true, launched_at = COALESCE(launched_at, clock_timestamp())
  WHERE id = true AND backfill_completed_at IS NOT NULL AND secret_check IS NOT NULL
  RETURNING launched_at INTO launched;
  IF launched IS NULL THEN RAISE EXCEPTION 'Trial backfill must complete before activation'; END IF;
  RETURN launched;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.activate_google_trial_campaign() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_google_trial_campaign() TO service_role;

-- Preserve referral checks and attribution; remove the independent credit writer.
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
  rejection text;
  network_seen boolean := false;
  prior_receipt public.welcome_trial_receipts%ROWTYPE;
BEGIN
  -- Serialize bindings for the same account, independent of browser cookie.
  PERFORM pg_advisory_xact_lock(hashtext('trial-bind:' || target_invitee_user_id::text));
  SELECT * INTO existing_referral FROM public.referrals
    WHERE invitee_user_id = target_invitee_user_id FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT existing_referral.status, existing_referral.id, p.credits FROM public.profiles p WHERE p.id = target_invitee_user_id;
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

  -- The schema forbids a self-referral row; reject before attempting INSERT.
  IF target_code.owner_user_id = target_invitee_user_id THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::uuid, invitee_profile.credits;
    RETURN;
  END IF;
  IF lower(referrer_profile.email) = lower(target_invitee_email) THEN
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
    RETURN QUERY SELECT 'rejected'::text, new_referral_id, invitee_profile.credits;
    RETURN;
  END IF;

  -- No credit increment here: only grant_google_welcome_trial can mint a trial.
  -- A valid referral discovered immediately after a welcome grant links its
  -- existing receipt instead of awarding a second Claw.
  SELECT * INTO prior_receipt FROM public.welcome_trial_receipts
    WHERE user_id = target_invitee_user_id AND source = 'welcome' FOR UPDATE;
  IF FOUND AND target_auth_provider = 'google' THEN
    INSERT INTO public.referral_rewards(referral_id, recipient_user_id, reward_type, amount, status,
      available_at, settled_at, credit_log_reference)
    VALUES(new_referral_id, target_invitee_user_id, 'invitee_trial', 1, 'rewarded',
      prior_receipt.granted_at, prior_receipt.granted_at, prior_receipt.credit_reference);
    UPDATE public.referrals SET status = 'trial_granted', trial_granted_at = prior_receipt.granted_at, updated_at = now()
      WHERE id = new_referral_id;
    UPDATE public.welcome_trial_receipts SET source = 'referral' WHERE user_id = target_invitee_user_id;
    PERFORM public.qualify_deferred_trial_referral(new_referral_id);
    RETURN QUERY SELECT 'trial_granted'::text, new_referral_id, invitee_profile.credits;
  ELSE
    RETURN QUERY SELECT 'bound'::text, new_referral_id, invitee_profile.credits;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


COMMIT;
