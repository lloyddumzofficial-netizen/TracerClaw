import { describe, expect, it } from "vitest";
import {
  booleanField,
  getBearerToken,
  opaqueIdField,
  parseJsonRequest,
  parseSearchParams,
  stringField,
} from "@/lib/apiValidation";

const schema = {
  plan: stringField({ maxLength: 32, pattern: /^[a-z]+$/ }),
  markOnly: booleanField({ required: false, defaultValue: false }),
};

describe("API validation", () => {
  it("normalizes valid JSON fields and applies defaults", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: " basic " }),
    });
    const result = await parseJsonRequest(request, schema);
    expect(result).toEqual({ ok: true, data: { plan: "basic", markOnly: false } });
  });

  it("returns a stable 400 response for malformed JSON", async () => {
    const request = new Request("http://localhost/api/test", { method: "POST", body: "{" });
    const result = await parseJsonRequest(request, schema);
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("rejects oversized request bodies before route logic runs", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ plan: "a".repeat(200) }),
    });
    const result = await parseJsonRequest(request, schema, { maxBytes: 32 });
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(413);
    expect((await result.response.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("validates opaque identifiers in query strings", () => {
    const valid = parseSearchParams(
      new Request("http://localhost/api/test?paymentId=payment_123-abc"),
      { paymentId: opaqueIdField() },
    );
    const invalid = parseSearchParams(
      new Request("http://localhost/api/test?paymentId=../../secret"),
      { paymentId: opaqueIdField() },
    );
    expect(valid).toEqual({ ok: true, data: { paymentId: "payment_123-abc" } });
    expect(invalid.ok).toBe(false);
    expect(invalid.response.status).toBe(400);
  });

  it("accepts only a well-formed bounded Bearer token", () => {
    expect(getBearerToken(new Request("http://localhost", {
      headers: { authorization: "Bearer test-token" },
    }))).toBe("test-token");
    expect(getBearerToken(new Request("http://localhost", {
      headers: { authorization: "Basic test-token" },
    }))).toBeNull();
  });
});
