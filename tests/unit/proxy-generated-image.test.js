import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ssrf", () => ({
  DEFAULT_MAX_IMAGE_BYTES: 15 * 1024 * 1024,
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES: 120 * 1024 * 1024,
  DEFAULT_MAX_SVG_BYTES: 8 * 1024 * 1024,
  DEFAULT_MAX_ZIP_BYTES: 120 * 1024 * 1024,
  getAllowedProviderHosts: () => [],
  validateUrlForSSRF: vi.fn().mockResolvedValue(true),
  fetchWithSSRFProtection: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  getClientIp: () => "127.0.0.1",
  enforceRateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

import { GET } from "@/app/api/proxy/route";

const R2_HOST = "pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev";
const PROJECT_ID = "b875690a-9657-414a-b826-d7712e8d4fc9";

function requestFor(path) {
  const remoteUrl = `https://${R2_HOST}${path}`;
  return new Request(`https://desaynclaw.com/api/proxy?url=${encodeURIComponent(remoteUrl)}`);
}

afterEach(() => vi.unstubAllGlobals());

describe("generated logo proxy", () => {
  it("serves a saved Flat Extract larger than the upload limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image", {
      headers: { "content-type": "image/png", "content-length": String(20 * 1024 * 1024) },
    })));

    const response = await GET(requestFor(`/projects/${PROJECT_ID}/generated_flat_123.png`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("still rejects unrelated images larger than the normal limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image", {
      headers: { "content-type": "image/png", "content-length": String(20 * 1024 * 1024) },
    })));

    const response = await GET(requestFor(`/projects/${PROJECT_ID}/original_123.png`));
    expect(response.status).toBe(413);
  });
});
