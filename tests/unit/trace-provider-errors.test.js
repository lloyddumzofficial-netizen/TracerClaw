import { describe, expect, it } from "vitest";
import { getTraceProviderFailure } from "../../src/lib/traceProviderErrors";

describe("trace provider failure diagnostics", () => {
  it("recognizes model moderation without retaining private provider input", () => {
    const result = getTraceProviderFailure({
      requestId: "01a1bb41-2244-7ab3-a4df-1fb88bb2acbd",
      body: { detail: [{
        type: "content_policy_violation", categories: ["model_moderated"],
        input: { prompt: "PRIVATE_PROMPT", image_urls: ["PRIVATE_IMAGE_URL"] },
      }] },
    });
    expect(result).toEqual({
      contentBlocked: true, types: ["content_policy_violation"],
      categories: ["model_moderated"], requestId: "01a1bb41-2244-7ab3-a4df-1fb88bb2acbd",
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("does not treat schema validation as content moderation", () => {
    expect(getTraceProviderFailure({ body: { detail: [{ type: "enum", categories: [] }] } }).contentBlocked).toBe(false);
  });

  it.each([undefined, {}, { body: { detail: "Unprocessable Entity" } }, { body: { detail: [null, { categories: "invalid" }] } }])("handles unstructured errors safely", error => {
    expect(getTraceProviderFailure(error).contentBlocked).toBe(false);
  });
});
