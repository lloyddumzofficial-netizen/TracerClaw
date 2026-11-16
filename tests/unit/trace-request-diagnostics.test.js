import { describe, expect, it } from "vitest";
import { getTraceRequestDiagnostics } from "../../src/server/traceRequestDiagnostics";

const base = {
  model: "google/nano-banana-2.1/edit",
  sourceBuffer: Buffer.from("private artwork"),
  input: { image_urls: ["https://private.example/source"], prompt: "private instruction", system_prompt: "private system instruction", resolution: "2K", aspect_ratio: "2:3" },
};

describe("trace request diagnostics", () => {
  it("compares identical content despite URL or key-order changes without logging private content", () => {
    const result = getTraceRequestDiagnostics(base);
    const reordered = { aspect_ratio: "2:3", resolution: "2K", system_prompt: base.input.system_prompt, prompt: base.input.prompt, image_urls: ["https://different.example/signed-url"] };
    expect(getTraceRequestDiagnostics({ ...base, input: reordered })).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/private|https/);
    expect(result.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    { sourceBuffer: Buffer.from("changed source") },
    { model: "different-model" },
    { input: { ...base.input, resolution: "1K" } },
    { input: { ...base.input, prompt: "changed instruction" } },
  ])("distinguishes changed source, model, resolution or prompt", change => {
    expect(getTraceRequestDiagnostics({ ...base, ...change }).requestFingerprint).not.toBe(getTraceRequestDiagnostics(base).requestFingerprint);
  });
});
