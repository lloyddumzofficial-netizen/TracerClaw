import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, getSecurityHeaders } from "@/lib/securityHeaders.mjs";

describe("security headers", () => {
  it("removes unsafe-eval and upgrades mixed content in production", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: false });
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("keeps unsafe-eval only for the Next.js development runtime", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: true });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("ships clickjacking and opener isolation headers consistently", () => {
    const headers = Object.fromEntries(getSecurityHeaders().map(({ key, value }) => [key, value]));
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
