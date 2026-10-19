-- Fail closed on referral rewards from email-only identities. Disposable-email
-- providers rotate domains, so a domain denylist remains a useful signal but
-- is not sufficient authority for issuing Claws.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_referral_reward_identity()
RETURNS trigger AS $$
DECLARE
  referral_provider text;
BEGIN
  -- Pending records do not move credits. Enforce at the exact point a reward
  -- becomes settled so both the invitee trial and referrer payout are covered.
  IF NEW.status <> 'rewarded' THEN
    RETURN NEW;
  END IF;

  SELECT lower(COALESCE(NULLIF(btrim(referral.auth_provider), ''), 'email'))
  INTO referral_provider
  FROM public.referrals referral
  WHERE referral.id = NEW.referral_id;

  IF referral_provider IS DISTINCT FROM 'google' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Referral rewards require a Google-verified identity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS referral_reward_identity_on_insert ON public.referral_rewards;
CREATE TRIGGER referral_reward_identity_on_insert
  BEFORE INSERT ON public.referral_rewards
  FOR EACH ROW EXECUTE FUNCTION public.enforce_referral_reward_identity();

DROP TRIGGER IF EXISTS referral_reward_identity_on_settlement ON public.referral_rewards;
CREATE TRIGGER referral_reward_identity_on_settlement
  BEFORE UPDATE OF status ON public.referral_rewards
  FOR EACH ROW EXECUTE FUNCTION public.enforce_referral_reward_identity();

-- Existing email-only referrals may already have received an invitee trial.
-- Do not subtract balances automatically because the Claw may have been spent
-- or mixed with purchased credits. Quarantine every unsettled referrer payout
-- and retain an explicit audit reason instead.
UPDATE public.referral_rewards reward SET
  status = 'rejected',
  rejected_at = COALESCE(reward.rejected_at, timezone('utc'::text, now())),
  rejection_reason = CASE
    WHEN referral.invitee_email_domain = 'goldlical.com' THEN 'disposable_email'
    ELSE 'untrusted_auth_provider'
  END,
  updated_at = timezone('utc'::text, now())
FROM public.referrals referral
WHERE reward.referral_id = referral.id
  AND reward.reward_type = 'referrer_completion'
  AND reward.status = 'pending'
  AND lower(COALESCE(NULLIF(btrim(referral.auth_provider), ''), 'email')) <> 'google';

UPDATE public.referrals referral SET
  status = 'rejected',
  rejected_at = COALESCE(referral.rejected_at, timezone('utc'::text, now())),
  rejection_reason = CASE
    WHEN referral.invitee_email_domain = 'goldlical.com' THEN 'disposable_email'
    ELSE 'untrusted_auth_provider'
  END,
  updated_at = timezone('utc'::text, now())
WHERE referral.status IN ('bound', 'trial_granted', 'qualified', 'pending_review')
  AND lower(COALESCE(NULLIF(btrim(referral.auth_provider), ''), 'email')) <> 'google';

INSERT INTO public.referral_risk_signals (
  referral_id, signal_type, severity, evidence_hash
)
SELECT
  referral.id,
  CASE
    WHEN referral.invitee_email_domain = 'goldlical.com' THEN 'disposable_email'
    ELSE 'untrusted_auth_provider'
  END,
  'high',
  NULL
FROM public.referrals referral
WHERE referral.status = 'rejected'
  AND referral.rejection_reason IN ('disposable_email', 'untrusted_auth_provider')
  AND lower(COALESCE(NULLIF(btrim(referral.auth_provider), ''), 'email')) <> 'google'
  AND NOT EXISTS (
    SELECT 1
    FROM public.referral_risk_signals signal
    WHERE signal.referral_id = referral.id
      AND signal.signal_type = referral.rejection_reason
      AND signal.expires_at > timezone('utc'::text, now())
  );

REVOKE EXECUTE ON FUNCTION public.enforce_referral_reward_identity()
  FROM PUBLIC, authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
