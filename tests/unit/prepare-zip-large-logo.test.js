import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  adminSupabase: { auth: { getUser: vi.fn() }, from: vi.fn() },
}));
vi.mock("@/lib/cloudflare", () => ({ uploadToR2: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: vi.fn(), getClientIp: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/ssrf", () => ({
  DEFAULT_MAX_IMAGE_BYTES: 15 * 1024 * 1024,
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES: 120 * 1024 * 1024,
  DEFAULT_MAX_SVG_BYTES: 8 * 1024 * 1024,
  fetchWithSSRFProtection: vi.fn(),
  getAllowedStorageHosts: () => ["storage.example"],
  isOwnedStorageUrl: () => true,
}));

import { POST } from "@/app/api/prepare-zip/route";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import { fetchWithSSRFProtection } from "@/lib/ssrf";

const projectId = "23f9721e-16c6-4b74-83c2-125cf73dbe06";
const project = {
  id: projectId,
  user_id: "test-user",
  name: "Festival",
  trace_type: "logo",
  original_image_url: null,
  generated_image_url: `https://storage.example/projects/${projectId}/generated_flat_123.png`,
  upscaled_image_url: null,
  svg_url: null,
  zip_url: null,
  zip_signature: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  adminSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null });
  adminSupabase.from.mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: project, error: null }) }) }) }),
    update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  });
  enforceRateLimit.mockResolvedValue({ success: true });
  uploadToR2.mockResolvedValue(`https://storage.example/projects/${projectId}/zip_test.zip`);
  fetchWithSSRFProtection.mockResolvedValue({
    response: new Response("image", { headers: { "content-type": "image/png" } }),
    buffer: Buffer.from("image"),
  });
});

function request() {
  return new Request("https://desaynclaw.com/api/prepare-zip", {
    method: "POST",
    headers: { authorization: "Bearer test" },
    body: JSON.stringify({ projectId }),
  });
}

describe("ZIP export of saved logo extraction", () => {
  it("reads a large Flat Extract with the accepted logo limit", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(fetchWithSSRFProtection).toHaveBeenCalledWith(project.generated_image_url, expect.objectContaining({
      maxBytes: 120 * 1024 * 1024,
    }));
    expect(uploadToR2).toHaveBeenCalledTimes(1);
  });

  it("does not cache or deliver a ZIP missing its Flat Extract", async () => {
    fetchWithSSRFProtection.mockRejectedValue(new Error("Remote file is too large"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(uploadToR2).not.toHaveBeenCalled();
  });
});
