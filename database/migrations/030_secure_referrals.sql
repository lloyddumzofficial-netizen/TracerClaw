-- Secure, Claw-only referral rewards. All mutations are service-role only.
-- The feature remains disabled at the application layer until REFERRALS_ENABLED=true.

ALTER TABLE public.credit_logs
  ADD COLUMN IF NOT EXISTS reference_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS credit_logs_reference_unique
  ON public.credit_logs (reference_id)
  WHERE reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE,
  code_hash text NOT NULL UNIQUE,
  code_prefix text NOT NULL,
  owner_device_hash text,
  enabled boolean NOT NULL DEFAULT true,
  click_count bigint NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  last_clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  disabled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id uuid NOT NULL REFERENCES public.referral_codes(id),
  referrer_user_id uuid NOT NULL,
  referrer_email text NOT NULL,
  invitee_user_id uuid NOT NULL UNIQUE,
  invitee_email text NOT NULL,
  invitee_email_domain text NOT NULL,
  auth_provider text NOT NULL,
  status text NOT NULL DEFAULT 'bound' CHECK (status IN (
    'bound', 'trial_granted', 'qualified', 'pending_review', 'rewarded', 'rejected'
  )),
  device_hash text,
  network_hash text,
  referral_issued_at timestamptz NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  trial_granted_at timestamptz,
  qualified_at timestamptz,
  review_after timestamptz,
  settled_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (referrer_user_id <> invitee_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_trial_device_idx
  ON public.referrals (device_hash, created_at DESC)
  WHERE device_hash IS NOT NULL AND trial_granted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_created_idx
  ON public.referrals (referrer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referrals_status_review_idx
  ON public.referrals (status, review_after);
CREATE INDEX IF NOT EXISTS referrals_network_idx
  ON public.referrals (network_hash)
  WHERE network_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  recipient_user_id uuid NOT NULL,
  reward_type text NOT NULL CHECK (reward_type IN ('invitee_trial', 'referrer_completion')),
  amount integer NOT NULL DEFAULT 1 CHECK (amount = 1),
  status text NOT NULL CHECK (status IN ('pending', 'rewarded', 'rejected')),
  available_at timestamptz,
  settled_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  credit_log_reference uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (referral_id, reward_type)
);

CREATE INDEX IF NOT EXISTS referral_rewards_pending_idx
  ON public.referral_rewards (status, available_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS referral_rewards_recipient_settled_idx
  ON public.referral_rewards (recipient_user_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS public.successful_project_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  completion_kind text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS successful_project_events_user_idx
  ON public.successful_project_events (user_id, completed_at);

CREATE TABLE IF NOT EXISTS public.user_activity_summary (
  user_id uuid PRIMARY KEY,
  account_created_at timestamptz NOT NULL,
  completed_project_count integer NOT NULL DEFAULT 0 CHECK (completed_project_count >= 0),
  first_completed_project_at timestamptz,
  last_completed_project_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.referral_risk_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id),
  signal_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  evidence_hash text,
  expires_at timestamptz NOT NULL DEFAULT (timezone('utc'::text, now()) + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS referral_risk_signals_active_idx
  ON public.referral_risk_signals (referral_id, severity, expires_at);

CREATE TABLE IF NOT EXISTS public.referral_click_daily (
  referral_code_id uuid NOT NULL REFERENCES public.referral_codes(id) ON DELETE CASCADE,
  click_date date NOT NULL DEFAULT (timezone('utc'::text, now()))::date,
  click_count integer NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  PRIMARY KEY (referral_code_id, click_date)
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.successful_project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_click_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.referral_codes, public.referrals, public.referral_rewards,
  public.successful_project_events, public.user_activity_summary,
  public.referral_risk_signals, public.referral_click_daily
  FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.referral_codes, public.referrals,
  public.referral_rewards, public.successful_project_events, public.user_activity_summary,
  public.referral_risk_signals, public.referral_click_daily TO service_role;

-- Seed durable project history before installing the live trigger. This is the
-- best recoverable baseline because older three-day project rows no longer exist.
INSERT INTO public.successful_project_events (project_id, user_id, completion_kind, completed_at)
SELECT
  p.id,
  p.user_id,
  CASE
    WHEN p.svg_url IS NOT NULL THEN 'svg'
    WHEN p.upscaled_image_url IS NOT NULL THEN 'upscale'
    ELSE 'generated_image'
  END,
  COALESCE(p.created_at, timezone('utc'::text, now()))
FROM public.projects p
WHERE p.user_id IS NOT NULL
  AND COALESCE(p.refunded, false) = false
  AND (
    p.svg_url IS NOT NULL OR
    p.upscaled_image_url IS NOT NULL OR
    (p.generated_image_url IS NOT NULL AND p.generated_image_url <> 'REFUNDED')
  )
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO public.user_activity_summary (
  user_id, account_created_at, completed_project_count,
  first_completed_project_at, last_completed_project_at
)
SELECT
  p.id,
  p.created_at,
  count(e.id)::integer,
  min(e.completed_at),
  max(e.completed_at)
FROM public.profiles p
LEFT JOIN public.successful_project_events e ON e.user_id = p.id
GROUP BY p.id, p.created_at
ON CONFLICT (user_id) DO UPDATE SET
  account_created_at = EXCLUDED.account_created_at,
  completed_project_count = EXCLUDED.completed_project_count,
  first_completed_project_at = EXCLUDED.first_completed_project_at,
  last_completed_project_at = EXCLUDED.last_completed_project_at,
  updated_at = timezone('utc'::text, now());

CREATE OR REPLACE FUNCTION public.create_referral_code(
  target_owner_user_id uuid,
  target_code_hash text,
  target_code_prefix text,
  target_owner_device_hash text DEFAULT NULL
)
RETURNS TABLE(status text, code_id uuid, code_prefix text) AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
  target_activity public.user_activity_summary%ROWTYPE;
  existing_code public.referral_codes%ROWTYPE;
  inserted_id uuid;
BEGIN
  SELECT * INTO target_profile FROM public.profiles
    WHERE id = target_owner_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO target_activity FROM public.user_activity_summary
    WHERE user_id = target_owner_user_id;
  IF target_profile.created_at > timezone('utc'::text, now()) - interval '7 days'
     OR COALESCE(target_activity.completed_project_count, 0) < 1 THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO existing_code FROM public.referral_codes
    WHERE owner_user_id = target_owner_user_id FOR UPDATE;
  IF FOUND THEN
    IF existing_code.enabled = false THEN
      RETURN QUERY SELECT 'disabled'::text, existing_code.id, existing_code.code_prefix;
    ELSIF existing_code.code_hash <> target_code_hash THEN
      RETURN QUERY SELECT 'secret_mismatch'::text, existing_code.id, existing_code.code_prefix;
    ELSE
      RETURN QUERY SELECT 'existing'::text, existing_code.id, existing_code.code_prefix;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.referral_codes (
    owner_user_id, code_hash, code_prefix, owner_device_hash
  ) VALUES (
    target_owner_user_id, target_code_hash, target_code_prefix, target_owner_device_hash
  ) RETURNING id INTO inserted_id;

  RETURN QUERY SELECT 'created'::text, inserted_id, target_code_prefix;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.record_referral_click(target_code_hash text)
RETURNS TABLE(status text, code_id uuid) AS $$
DECLARE target_code public.referral_codes%ROWTYPE;
BEGIN
  SELECT * INTO target_code FROM public.referral_codes
    WHERE code_hash = target_code_hash AND enabled = true FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.referral_codes SET
    click_count = click_count + 1,
    last_clicked_at = timezone('utc'::text, now())
  WHERE id = target_code.id;

  INSERT INTO public.referral_click_daily (referral_code_id, click_date, click_count)
  VALUES (target_code.id, (timezone('utc'::text, now()))::date, 1)
  ON CONFLICT (referral_code_id, click_date)
  DO UPDATE SET click_count = public.referral_click_daily.click_count + 1;

  RETURN QUERY SELECT 'recorded'::text, target_code.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

  -- Serialize competing signups from the same browser before checking and
  -- granting the one-device trial inside the 90-day risk-retention window.
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

CREATE OR REPLACE FUNCTION public.capture_successful_project_for_referrals()
RETURNS trigger AS $$
DECLARE
  completion_kind_value text;
  inserted_event_id uuid;
  qualified_referral_id uuid;
BEGIN
  IF NEW.user_id IS NULL OR COALESCE(NEW.refunded, false) = true THEN
    RETURN NEW;
  END IF;

  completion_kind_value := CASE
    WHEN NEW.svg_url IS NOT NULL THEN 'svg'
    WHEN NEW.upscaled_image_url IS NOT NULL THEN 'upscale'
    WHEN NEW.generated_image_url IS NOT NULL AND NEW.generated_image_url <> 'REFUNDED' THEN 'generated_image'
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
  AFTER INSERT OR UPDATE OF generated_image_url, upscaled_image_url, svg_url, refunded
  ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.capture_successful_project_for_referrals();

CREATE OR REPLACE FUNCTION public.get_pending_referral_rewards(batch_limit integer DEFAULT 100)
RETURNS TABLE(
  reward_id uuid,
  referral_id uuid,
  invitee_user_id uuid,
  invitee_email text,
  invitee_email_domain text,
  available_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT rw.id, r.id, r.invitee_user_id, r.invitee_email, r.invitee_email_domain, rw.available_at
  FROM public.referral_rewards rw
  JOIN public.referrals r ON r.id = rw.referral_id
  WHERE rw.reward_type = 'referrer_completion'
    AND rw.status = 'pending'
    AND r.status = 'pending_review'
    AND rw.available_at <= timezone('utc'::text, now())
  ORDER BY rw.available_at ASC
  LIMIT LEAST(GREATEST(batch_limit, 1), 100);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.reject_referral_reward(
  target_referral_id uuid,
  rejection_reason_value text
)
RETURNS TABLE(status text) AS $$
DECLARE target_referral public.referrals%ROWTYPE;
BEGIN
  SELECT * INTO target_referral FROM public.referrals
    WHERE id = target_referral_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text; RETURN; END IF;
  IF target_referral.status = 'rewarded' THEN RETURN QUERY SELECT 'already_rewarded'::text; RETURN; END IF;

  UPDATE public.referral_rewards SET
    status = 'rejected', rejected_at = timezone('utc'::text, now()),
    rejection_reason = rejection_reason_value, updated_at = timezone('utc'::text, now())
  WHERE referral_id = target_referral_id
    AND reward_type = 'referrer_completion' AND status = 'pending';
  UPDATE public.referrals SET
    status = 'rejected', rejected_at = timezone('utc'::text, now()),
    rejection_reason = rejection_reason_value, updated_at = timezone('utc'::text, now())
  WHERE id = target_referral_id;
  RETURN QUERY SELECT 'rejected'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.settle_referral_reward(target_referral_id uuid)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  target_referral public.referrals%ROWTYPE;
  target_reward public.referral_rewards%ROWTYPE;
  monthly_rewards integer;
  new_credits integer;
  credit_reference uuid := gen_random_uuid();
BEGIN
  SELECT * INTO target_referral FROM public.referrals
    WHERE id = target_referral_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::integer; RETURN; END IF;

  SELECT * INTO target_reward FROM public.referral_rewards
    WHERE referral_id = target_referral_id AND reward_type = 'referrer_completion' FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_qualified'::text, NULL::integer; RETURN; END IF;
  IF target_reward.status = 'rewarded' THEN
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_referral.referrer_user_id;
    RETURN QUERY SELECT 'already_rewarded'::text, new_credits; RETURN;
  END IF;
  IF target_reward.status <> 'pending' OR target_referral.status <> 'pending_review' THEN
    RETURN QUERY SELECT 'not_pending'::text, NULL::integer; RETURN;
  END IF;
  IF target_reward.available_at > timezone('utc'::text, now()) THEN
    RETURN QUERY SELECT 'on_hold'::text, NULL::integer; RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_codes rc
    WHERE rc.id = target_referral.referral_code_id AND rc.enabled = true
  ) THEN
    UPDATE public.referral_rewards SET status = 'rejected',
      rejected_at = timezone('utc'::text, now()), rejection_reason = 'referral_code_disabled',
      updated_at = timezone('utc'::text, now()) WHERE id = target_reward.id;
    UPDATE public.referrals SET status = 'rejected',
      rejected_at = timezone('utc'::text, now()), rejection_reason = 'referral_code_disabled',
      updated_at = timezone('utc'::text, now()) WHERE id = target_referral_id;
    RETURN QUERY SELECT 'referral_code_disabled'::text, NULL::integer; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referral_risk_signals s
    WHERE s.referral_id = target_referral_id
      AND s.severity = 'high' AND s.expires_at > timezone('utc'::text, now())
  ) THEN
    RETURN QUERY SELECT 'risk_hold'::text, NULL::integer; RETURN;
  END IF;

  -- Every reward for this referrer locks the same profile row before counting,
  -- preventing concurrent cron workers from exceeding the five-Claw cap.
  SELECT credits INTO new_credits FROM public.profiles
    WHERE id = target_referral.referrer_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referrer profile not found during settlement'; END IF;

  SELECT count(*)::integer INTO monthly_rewards
  FROM public.referral_rewards rw
  WHERE rw.recipient_user_id = target_referral.referrer_user_id
    AND rw.reward_type = 'referrer_completion'
    AND rw.status = 'rewarded'
    AND rw.settled_at >= date_trunc('month', timezone('utc'::text, now()));
  IF monthly_rewards >= 5 THEN
    UPDATE public.referral_rewards SET status = 'rejected',
      rejected_at = timezone('utc'::text, now()), rejection_reason = 'monthly_cap',
      updated_at = timezone('utc'::text, now())
    WHERE id = target_reward.id;
    UPDATE public.referrals SET status = 'rejected',
      rejected_at = timezone('utc'::text, now()), rejection_reason = 'monthly_cap',
      updated_at = timezone('utc'::text, now())
    WHERE id = target_referral_id;
    SELECT credits INTO new_credits FROM public.profiles WHERE id = target_referral.referrer_user_id;
    RETURN QUERY SELECT 'monthly_cap'::text, new_credits; RETURN;
  END IF;

  UPDATE public.profiles SET credits = credits + 1
    WHERE id = target_referral.referrer_user_id RETURNING credits INTO new_credits;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referrer profile not found during reward grant'; END IF;

  INSERT INTO public.credit_logs (user_id, action, amount, reference_id)
  VALUES (target_referral.referrer_user_id, 'Referral completion reward', 1, credit_reference);
  UPDATE public.referral_rewards SET
    status = 'rewarded', settled_at = timezone('utc'::text, now()),
    credit_log_reference = credit_reference, updated_at = timezone('utc'::text, now())
  WHERE id = target_reward.id;
  UPDATE public.referrals SET
    status = 'rewarded', settled_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  WHERE id = target_referral_id;
  RETURN QUERY SELECT 'rewarded'::text, new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE VIEW public.admin_referral_overview
WITH (security_invoker = true) AS
SELECT
  r.id AS referral_id,
  rc.code_prefix,
  r.referrer_user_id,
  r.referrer_email,
  r.invitee_user_id,
  r.invitee_email,
  r.auth_provider,
  r.status,
  r.trial_granted_at,
  uas.first_completed_project_at,
  r.qualified_at,
  r.review_after,
  r.settled_at,
  COALESCE(rr.amount, 0) AS referrer_reward_amount,
  (
    SELECT count(*)::integer FROM public.referral_rewards monthly
    WHERE monthly.recipient_user_id = r.referrer_user_id
      AND monthly.reward_type = 'referrer_completion'
      AND monthly.status = 'rewarded'
      AND monthly.settled_at >= date_trunc('month', timezone('utc'::text, now()))
  ) AS referrer_monthly_rewards,
  COALESCE((
    SELECT array_agg(DISTINCT s.signal_type ORDER BY s.signal_type)
    FROM public.referral_risk_signals s
    WHERE s.referral_id = r.id AND s.expires_at > timezone('utc'::text, now())
  ), ARRAY[]::text[]) AS risk_flags,
  r.rejection_reason,
  r.created_at,
  r.updated_at
FROM public.referrals r
JOIN public.referral_codes rc ON rc.id = r.referral_code_id
LEFT JOIN public.referral_rewards rr
  ON rr.referral_id = r.id AND rr.reward_type = 'referrer_completion'
LEFT JOIN public.user_activity_summary uas ON uas.user_id = r.invitee_user_id;

CREATE OR REPLACE VIEW public.admin_referral_metrics
WITH (security_invoker = true) AS
SELECT
  count(*)::bigint AS bound_signups,
  count(*) FILTER (WHERE qualified_at IS NOT NULL)::bigint AS qualified_referrals,
  count(*) FILTER (WHERE status = 'pending_review')::bigint AS pending_rewards,
  count(*) FILTER (WHERE status = 'rewarded')::bigint AS rewarded_referrals,
  count(*) FILTER (WHERE status = 'rejected')::bigint AS rejected_referrals,
  CASE WHEN count(*) = 0 THEN 0
    ELSE round((count(*) FILTER (WHERE qualified_at IS NOT NULL))::numeric * 100 / count(*), 2)
  END AS qualification_rate_percent,
  COALESCE((
    SELECT sum(amount) FROM public.referral_rewards WHERE status = 'rewarded'
  ), 0)::bigint AS total_claws_issued
FROM public.referrals;

REVOKE ALL ON public.admin_referral_overview, public.admin_referral_metrics
  FROM PUBLIC, authenticated, anon;
GRANT SELECT ON public.admin_referral_overview, public.admin_referral_metrics TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_referral_code(uuid,text,text,text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.record_referral_click(text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.bind_referral_and_grant_trial(text,uuid,text,text,text,text,text,timestamptz,boolean) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_referral_rewards(integer) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.reject_referral_reward(uuid,text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.settle_referral_reward(uuid) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.capture_successful_project_for_referrals() FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.create_referral_code(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_referral_click(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_referral_and_grant_trial(text,uuid,text,text,text,text,text,timestamptz,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_referral_rewards(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_referral_reward(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_referral_reward(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
