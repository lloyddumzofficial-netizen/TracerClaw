import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";

afterEach(() => vi.unstubAllEnvs());
describe("emergency AI maintenance", () => {
  it.each(["/", "/workspace/id", "/upscale", "/bg-remover/id", "/mockup-studio", "/mobile"])("shows the screen at %s without loading the app", async path => {
    vi.stubEnv("AI_MAINTENANCE_MODE", "on");
    const res = proxy(new NextRequest(`https://desaynclaw.com${path}`));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toContain("1:00 PM");
  });
  it.each(["/api/trace", "/api/trace-step3", "/api/upscale", "/api/remove-bg", "/api/upload", "/api/mockups/project-1/render", "/api/mockups/jobs/job-1/retry"])("blocks %s before handlers can charge or generate", async path => {
    vi.stubEnv("AI_MAINTENANCE_MODE", "on");
    const res = proxy(new NextRequest(`https://desaynclaw.com${path}`, { method: "POST" }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("AI_MAINTENANCE");
  });
  it.each([["/api/payments/dodo/webhook", "POST"], ["/api/mockups/webhook", "POST"], ["/api/upscale?requestId=old", "GET"], ["/api/cron/cleanup", "GET"], ["/api/auth/callback", "GET"], ["/privacy", "GET"]])("preserves %s (%s)", (path, method) => {
    vi.stubEnv("AI_MAINTENANCE_MODE", "on");
    expect(proxy(new NextRequest(`https://desaynclaw.com${path}`, { method })).headers.get("x-middleware-next")).toBe("1");
  });
  it("allows service when maintenance is explicitly disabled", () => {
    vi.stubEnv("AI_MAINTENANCE_MODE", "off");
    expect(proxy(new NextRequest("https://desaynclaw.com/api/trace", { method: "POST" })).headers.get("x-middleware-next")).toBe("1");
  });
  it("serves the normal site by default after service restoration", () => {
    vi.stubEnv("AI_MAINTENANCE_MODE", undefined);
    expect(proxy(new NextRequest("https://desaynclaw.com/")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(new NextRequest("https://desaynclaw.com/api/upscale", { method: "POST" })).headers.get("x-middleware-next")).toBe("1");
  });
});
