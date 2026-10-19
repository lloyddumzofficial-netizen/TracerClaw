import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminSupabase } = vi.hoisted(() => ({
  adminSupabase: { rpc: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ adminSupabase }));
vi.mock("@/lib/rateLimit", () => ({ getClientIp: () => "203.0.113.47" }));

import {
  bindReferralFromAuthCallback,
  coarseNetwork,
  createDeviceCookie,
  createReferralCookie,
  deriveReferralCode,
  hashReferralCode,
  readDeviceCookie,
  readReferralCookie,
} from "@/server/referrals";
import { isDisposableEmailDomain, normalizeEmailDomain } from "@/server/referrals/disposableDomains";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REFERRALS_ENABLED = "true";
  process.env.REFERRAL_SECURITY_SECRET = "test-referral-secret-that-is-longer-than-32-characters";
});

describe("referral security primitives", () => {
  it("derives a stable opaque code and hashes it", () => {
    const first = deriveReferralCode("user-1");
    expect(first).toMatch(/^DC[A-F0-9]{18}$/);
    expect(deriveReferralCode("user-1")).toBe(first);
    expect(hashReferralCode(first)).toHaveLength(64);
    expect(deriveReferralCode("user-2")).not.toBe(first);
  });

  it("rejects tampered and expired referral cookies", () => {
    const code = deriveReferralCode("user-1");
    const now = Date.now();
    const valid = createReferralCookie(code, now);
    expect(readReferralCookie(valid, now)).toEqual({ code, issuedAt: now });
    expect(readReferralCookie(`${valid}x`, now)).toBeNull();
    expect(readReferralCookie(createReferralCookie(code, now - 8 * 86_400_000), now)).toBeNull();
  });

  it("signs device IDs and refuses modified values", () => {
    const signed = createDeviceCookie("123e4567-e89b-12d3-a456-426614174000");
    expect(readDeviceCookie(signed)).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(readDeviceCookie(`${signed}x`)).toBeNull();
  });

  it("normalizes coarse networks without retaining a raw IP", () => {
    expect(coarseNetwork("203.0.113.47")).toBe("203.0.113.0/24");
    expect(coarseNetwork("2001:db8:abcd:12:1234:5678::1")).toBe("2001:db8:abcd:12::/64");
  });

  it("blocks disposable domains including subdomains", () => {
    expect(normalizeEmailDomain(" User@Example.COM. ")).toBe("example.com");
    expect(isDisposableEmailDomain("person@yopmail.com")).toBe(true);
    expect(isDisposableEmailDomain("sub.mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("person@1secmail.com")).toBe(true);
    expect(isDisposableEmailDomain("person@mail.gw")).toBe(true);
    expect(isDisposableEmailDomain("person@dropmail.me")).toBe(true);
    expect(isDisposableEmailDomain("gmail.com")).toBe(false);
  });
});

describe("auth callback referral binding", () => {
  it("sends only hashed device/network evidence to the atomic RPC", async () => {
    const code = deriveReferralCode("referrer-1");
    const referralCookie = createReferralCookie(code);
    const deviceCookie = createDeviceCookie("123e4567-e89b-12d3-a456-426614174000");
    adminSupabase.rpc.mockResolvedValue({
      data: [{ status: "trial_granted", referral_id: "referral-1" }],
      error: null,
    });
    const request = new Request("https://desaynclaw.com/api/auth/callback", {
      headers: {
        cookie: `dc_referral=${encodeURIComponent(referralCookie)}; dc_ref_device=${encodeURIComponent(deviceCookie)}`,
        "x-vercel-forwarded-for": "203.0.113.47",
      },
    });

    const result = await bindReferralFromAuthCallback(request, {
      id: "invitee-1",
      email: "real@example.com",
      app_metadata: { provider: "google" },
    });

    expect(result).toMatchObject({ handled: true, status: "trial_granted", referralId: "referral-1" });
    expect(adminSupabase.rpc).toHaveBeenCalledWith("bind_referral_and_grant_trial", expect.objectContaining({
      target_invitee_user_id: "invitee-1",
      target_email_domain: "example.com",
      target_auth_provider: "google",
      target_disposable_email: false,
      target_device_hash: expect.any(String),
      target_network_hash: expect.any(String),
    }));
    const args = adminSupabase.rpc.mock.calls[0][1];
    expect(args.target_device_hash).not.toContain("123e4567");
    expect(args.target_network_hash).not.toContain("203.0.113");
  });

  it("does nothing without a valid signed referral cookie", async () => {
    const request = new Request("https://desaynclaw.com/api/auth/callback", {
      headers: { cookie: "dc_referral=tampered; dc_ref_device=tampered" },
    });
    await expect(bindReferralFromAuthCallback(request, {
      id: "invitee-1",
      email: "real@example.com",
    })).resolves.toMatchObject({ handled: false });
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });
});
