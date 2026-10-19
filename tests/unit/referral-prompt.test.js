import { describe, expect, it } from "vitest";
import {
  getReferralPromptStorageKey,
  shouldAutoOpenReferral,
} from "@/lib/referralPrompt";

describe("referral introduction prompt", () => {
  it("uses an account-scoped, versioned storage key", () => {
    const first = getReferralPromptStorageKey("user-1");
    expect(first).toContain("launch-v1");
    expect(first).toContain("user-1");
    expect(getReferralPromptStorageKey("user-2")).not.toBe(first);
  });

  it("opens only for eligible users or users who already own a link", () => {
    expect(shouldAutoOpenReferral({ enabled: true, eligible: true })).toBe(true);
    expect(shouldAutoOpenReferral({ enabled: true, eligible: false, link: "https://example.com/r/code" })).toBe(true);
    expect(shouldAutoOpenReferral({ enabled: true, eligible: false, link: null })).toBe(false);
    expect(shouldAutoOpenReferral({ enabled: false, eligible: true })).toBe(false);
  });
});
