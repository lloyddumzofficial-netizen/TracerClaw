import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { submitDesignOperation } from "@/server/designExtract/submission";
beforeEach(() => { vi.stubEnv("FAL_KEY", "test-only-secret"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(["fal-ai/sam2/auto-segment", "fal-ai/qwen-image-layered", "fal-ai/sam2/image", "fal-ai/sam-3/image"])("submits %s exactly once to a fixed allowed endpoint", async model => {
  fetch.mockResolvedValue(new Response(JSON.stringify({ request_id: "recorded-request-1234" })));
  expect(await submitDesignOperation(model, { input: { image_url: "https://owned.test/source.png" } })).toEqual({ request_id: "recorded-request-1234" });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://queue.fal.run/${model}`, expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
});
it.each([422, 429, 503])("does not retry a rejected or uncertain paid request (%s)", async status => {
  fetch.mockResolvedValue(new Response("Untrusted upstream body", { status }));
  await expect(submitDesignOperation("fal-ai/qwen-image-layered", { input: {} })).rejects.toMatchObject({ status });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not retry a lost response or accept a missing receipt", async () => {
  fetch.mockRejectedValueOnce(new Error("Connection reset"));
  await expect(submitDesignOperation("fal-ai/qwen-image-layered", { input: {} })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(new Response("{}"));
  await expect(submitDesignOperation("fal-ai/qwen-image-layered", { input: {} })).rejects.toThrow("no valid receipt");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects caller-selected endpoints before accessing the network", async () => {
  await expect(submitDesignOperation("https://attacker.test/steal", { input: {} })).rejects.toThrow("Unsupported");
  expect(fetch).not.toHaveBeenCalled();
});
