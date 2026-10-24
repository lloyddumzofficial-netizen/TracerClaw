import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pricing/local/route.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localized pricing API", () => {
  it("uses the international USD catalog outside the Philippines", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/pricing/local", {
      headers: { "x-vercel-ip-country": "US" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      baseCurrency: "USD",
      country: "US",
      currency: "USD",
      primaryProvider: "dodo",
      rate: 1,
      estimated: false,
    }));
    expect(body.providers.dodo.plans.basic).toEqual(expect.objectContaining({ amount: 599, currency: "USD" }));
    expect(body.providers.dodo.plans.tingi).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a cached USD conversion rate for international display currencies", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: "2026-10-10", base: "USD", quote: "EUR", rate: 0.86 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/pricing/local?currency=EUR", {
      headers: { "x-vercel-ip-country": "US" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      baseCurrency: "USD",
      country: "US",
      currency: "EUR",
      rate: 0.86,
      estimated: true,
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.frankfurter.dev/v2/rate/usd/eur",
      { next: { revalidate: 86_400 } },
    );
  });

  it("keeps the Philippine catalog in PHP and localizes the optional Dodo card price", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ rate: 63 }) }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost/api/pricing/local?currency=PHP", {
      headers: { "x-vercel-ip-country": "PH" },
    }));
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ currency: "PHP", rate: 1, primaryProvider: "paymongo" }));
    expect(body.providers.paymongo.plans.tingi.amount).toBe(6900);
    expect(body.providers.dodo).toEqual(expect.objectContaining({ baseCurrency: "USD", rate: 63 }));
  });

  it("rejects currencies outside the server allowlist", async () => {
    const response = await GET(new Request("http://localhost/api/pricing/local?currency=ZZZ"));
    expect(response.status).toBe(400);
  });

  it("falls back to PHP when live conversion is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const response = await GET(new Request("http://localhost/api/pricing/local?currency=EUR", {
      headers: { "x-vercel-ip-country": "US" },
    }));
    expect(await response.json()).toEqual(expect.objectContaining({
      currency: "USD",
      rate: 1,
      fallback: true,
    }));
  });
});
