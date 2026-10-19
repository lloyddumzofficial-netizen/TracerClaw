"use client";

import { useEffect } from "react";
import { safeJson } from "@/lib/safeJson";
import {
  hasSeenReferralPrompt,
  markReferralPromptSeen,
  shouldAutoOpenReferral,
} from "@/lib/referralPrompt";

const AUTO_PROMPT_DELAY_MS = 2200;

export default function ReferralPromptController({ user, supabase, blocked, onOpen }) {
  useEffect(() => {
    if (!user?.id || blocked || hasSeenReferralPrompt(user.id)) return undefined;

    const params = new URLSearchParams(window.location.search);
    if (params.get("topup") || params.get("error")) return undefined;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || controller.signal.aborted) return;

        const response = await fetch("/api/referrals", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const summary = await safeJson(response, "Could not load referral eligibility");
        if (!response.ok || !shouldAutoOpenReferral(summary) || controller.signal.aborted) return;

        markReferralPromptSeen(user.id);
        onOpen();
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.warn("Referral introduction was deferred:", error);
        }
      }
    }, AUTO_PROMPT_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blocked, onOpen, supabase, user?.id]);

  return null;
}
