export const REFERRAL_PROMPT_VERSION = "launch-v1";

export function getReferralPromptStorageKey(userId) {
  return `desaynclaw-referral-prompt:${REFERRAL_PROMPT_VERSION}:${userId}`;
}

export function shouldAutoOpenReferral(summary) {
  return Boolean(summary?.enabled !== false && (summary?.eligible || summary?.link));
}

export function hasSeenReferralPrompt(userId) {
  if (!userId || typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(getReferralPromptStorageKey(userId)) === "1";
  } catch {
    return true;
  }
}

export function markReferralPromptSeen(userId) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getReferralPromptStorageKey(userId), "1");
  } catch {
    // Storage can be unavailable in strict privacy modes. The referral button
    // remains usable, and the prompt controller will fail quietly.
  }
}
