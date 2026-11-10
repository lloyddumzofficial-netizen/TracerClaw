import "server-only";
import { adminSupabase } from "@/lib/supabase";
import { bindReferralFromAuthCallback } from "@/server/referrals";
import { cookieValue, readIntent, requestDeviceHash, TRIAL_INTENT_COOKIE, verifiedGoogleIdentity, welcomeTrialEnabled } from "./security";
import { getReferralSecret } from "@/server/referrals";
import { trialFingerprint } from "@/lib/welcomeTrialIdentity.mjs";

export async function campaignStatus() {
  if (!welcomeTrialEnabled()) return { enabled: false };
  const { data, error } = await adminSupabase.from("welcome_trial_campaign")
    .select("enabled, launched_at, backfill_completed_at, secret_check").eq("id", true).single();
  if (error) throw error;
  return { enabled: Boolean(data?.enabled && data.launched_at && data.backfill_completed_at
    && data.secret_check === trialFingerprint("config", "v1", getReferralSecret())) };
}

export async function processWelcomeTrial(request, session) {
  if (!welcomeTrialEnabled()) return { status: "disabled", referralHandled: false };
  const nonce = readIntent(cookieValue(request, TRIAL_INTENT_COOKIE));
  const deviceHash = requestDeviceHash(request);
  if (!nonce || !deviceHash) return { status: "temporarily_unavailable", referralHandled: false };
  const identity = await verifiedGoogleIdentity(session);
  if (!identity) return { status: "ineligible", referralHandled: false };
  // Binding never moves credits after migration 037. Attribution is retained
  // while a cap-delayed claim waits; the grant below is the only credit writer.
  const referral = await bindReferralFromAuthCallback(request, session.user, { verifiedIdentity: identity });
  const { data, error } = await adminSupabase.rpc("grant_google_welcome_trial", {
    target_user_id: session.user.id,
    target_google_subject: identity.subject,
    target_google_hash: identity.googleHash,
    target_email_hash: identity.emailHash,
    target_device_hash: deviceHash,
    target_nonce: nonce,
    target_secret_check: trialFingerprint("config", "v1", getReferralSecret()),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return { ...result, referralHandled: referral.handled };
}
