import { afterEach, expect, it, vi } from "vitest";
import { uploadDesignFile } from "@/features/design-extract/upload";
afterEach(() => vi.unstubAllGlobals());
const file = new File(["design"], "design.png", { type: "image/png" });
const prepared = () => Response.json({ uploadUrl: "https://storage.test/signed", publicUrl: "https://public.test/design.png" });
it("uploads directly when storage is reachable", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(prepared()).mockResolvedValueOnce(new Response(null)); vi.stubGlobal("fetch", fetcher);
  expect(await uploadDesignFile({ file, token: "session", allowServerFallback: true })).toBe("https://public.test/design.png");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("recovers local CORS failures through the authenticated server route", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(prepared()).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(Response.json({ publicUrl: "https://public.test/fallback.png" })); vi.stubGlobal("fetch", fetcher);
  expect(await uploadDesignFile({ file, token: "session", allowServerFallback: true })).toBe("https://public.test/fallback.png");
  const [url, request] = fetcher.mock.calls[2];
  expect(url).toBe("/api/upload-direct"); expect(request.headers.Authorization).toBe("Bearer session"); expect(request.body.get("purpose")).toBe("design_extract"); expect(request.body.get("file").name).toBe("design.png");
});
it("does not send large production uploads to a serverless fallback", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(prepared()).mockRejectedValueOnce(new TypeError("Failed to fetch")); vi.stubGlobal("fetch", fetcher);
  await expect(uploadDesignFile({ file, token: "session", allowServerFallback: false })).rejects.toThrow("R2 CORS"); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("reports fallback validation errors without creating a project", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(prepared()).mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(Response.json({ error: "File is too large" }, { status: 413 })));
  await expect(uploadDesignFile({ file, token: "session", allowServerFallback: true })).rejects.toThrow("File is too large");
});
