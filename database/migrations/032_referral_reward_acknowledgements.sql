-- Track whether a recipient has seen a settled referral reward.
-- Reward settlement and balances remain controlled by the existing atomic RPCs;
-- this column is presentation state only.

ALTER TABLE public.referral_rewards
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

CREATE INDEX IF NOT EXISTS referral_rewards_unacknowledged_idx
  ON public.referral_rewards (recipient_user_id, settled_at DESC)
  WHERE status = 'rewarded' AND acknowledged_at IS NULL;

COMMENT ON COLUMN public.referral_rewards.acknowledged_at IS
  'Timestamp when the reward recipient acknowledged the in-app notice. Does not affect settlement or balance.';

NOTIFY pgrst, 'reload schema';
