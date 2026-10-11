import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pricing/local/route.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localized pricing API", () => {
  it("uses the visitor country and a cached PHP conversion rate", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: "2026-10-10", base: "PHP", quote: "USD", rate: 0.017 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/pricing/local", {
      headers: { "x-vercel-ip-country": "US" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      baseCurrency: "PHP",
      country: "US",
      currency: "USD",
      rate: 0.017,
      estimated: true,
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.frankfurter.dev/v2/rate/php/usd",
      { next: { revalidate: 86_400 } },
    );
  });

  it("serves PHP without depending on the rate provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost/api/pricing/local?currency=PHP"));
    expect(await response.json()).toEqual(expect.objectContaining({ currency: "PHP", rate: 1 }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects currencies outside the server allowlist", async () => {
    const response = await GET(new Request("http://localhost/api/pricing/local?currency=ZZZ"));
    expect(response.status).toBe(400);
  });

  it("falls back to PHP when live conversion is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const response = await GET(new Request("http://localhost/api/pricing/local?currency=USD"));
    expect(await response.json()).toEqual(expect.objectContaining({
      currency: "PHP",
      rate: 1,
      fallback: true,
    }));
  });
});