import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithRetry", () => {
  it("does not retry a request after its signal has timed out", async () => {
    const signal = AbortSignal.abort(new Error("timeout"));
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithRetry("https://provider.example/vectorize", { signal })).rejects.toThrow(/timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
