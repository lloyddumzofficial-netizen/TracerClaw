-- Replace the renewable monthly referrer allowance with a permanent lifetime
-- ceiling. Existing rewards are preserved; accounts that already reached the
-- ceiling cannot receive another referrer-completion Claw.

BEGIN;

CREATE OR REPLACE FUNCTION public.settle_referral_reward(target_referral_id uuid)
RETURNS TABLE(status text, credits_remaining integer) AS $$
DECLARE
  target_referral public.referrals%ROWTYPE;
  target_reward public.referral_rewards%ROWTYPE;
  lifetime_rewards integer;
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

  -- Serialize every payout for this referrer on the same profile row. The
  -- lifetime count and credit update therefore remain atomic across workers.
  SELECT credits INTO new_credits FROM public.profiles
    WHERE id = target_referral.referrer_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referrer profile not found during settlement'; END IF;

  SELECT count(*)::integer INTO lifetime_rewards
  FROM public.referral_rewards rw
  WHERE rw.recipient_user_id = target_referral.referrer_user_id
    AND rw.reward_type = 'referrer_completion'
    AND rw.status = 'rewarded';

  IF lifetime_rewards >= 3 THEN
    UPDATE public.referral_rewards SET status = 'rejected',
      rejected_at = timezone('utc'::text, now()), rejection_reason = 'lifetime_cap',
      updated_at = timezone('utc'::text, now())
    WHERE id = target_reward.id;
    UPDATE public.referrals SET status = 'rejected',
      rejected_at = timezone('utc'::text, now()), rejection_reason = 'lifetime_cap',
      updated_at = timezone('utc'::text, now())
    WHERE id = target_referral_id;
    RETURN QUERY SELECT 'lifetime_cap'::text, new_credits; RETURN;
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

REVOKE EXECUTE ON FUNCTION public.settle_referral_reward(uuid)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.settle_referral_reward(uuid) TO service_role;

DROP VIEW IF EXISTS public.admin_referral_overview;
CREATE VIEW public.admin_referral_overview
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
    SELECT count(*)::integer FROM public.referral_rewards lifetime
    WHERE lifetime.recipient_user_id = r.referrer_user_id
      AND lifetime.reward_type = 'referrer_completion'
      AND lifetime.status = 'rewarded'
  ) AS referrer_lifetime_rewards,
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

REVOKE ALL ON public.admin_referral_overview FROM PUBLIC, authenticated, anon;
GRANT SELECT ON public.admin_referral_overview TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
