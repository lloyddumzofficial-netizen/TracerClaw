import { NextResponse } from "next/server";

const DEFAULT_MAX_JSON_BYTES = 16 * 1024;
const MAX_BEARER_TOKEN_LENGTH = 4096;

function errorResponse(error, status, code = "INVALID_REQUEST") {
  return NextResponse.json({ error, code }, { status });
}

function fail(error, status = 400, code) {
  return { ok: false, response: errorResponse(error, status, code) };
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) return null;
  return token;
}

export function stringField({
  required = true,
  minLength = 1,
  maxLength = 256,
  pattern,
  normalize = (value) => value.trim(),
  message,
} = {}) {
  return { type: "string", required, minLength, maxLength, pattern, normalize, message };
}

export function booleanField({ required = true, defaultValue, message } = {}) {
  return { type: "boolean", required, defaultValue, message };
}

export const opaqueIdField = (options = {}) => stringField({
  maxLength: 128,
  pattern: /^[A-Za-z0-9_-]+$/,
  message: "must be a valid identifier",
  ...options,
});

function validateField(name, value, rule) {
  if (value === undefined || value === null) {
    if (!rule.required) return { ok: true, value: rule.defaultValue };
    return { ok: false, error: `${name} is required` };
  }
  if (rule.type === "string") {
    if (typeof value !== "string") return { ok: false, error: rule.message || `${name} must be a string` };
    const normalized = rule.normalize ? rule.normalize(value) : value;
    if (normalized.length < rule.minLength || normalized.length > rule.maxLength) {
      return { ok: false, error: rule.message || `${name} has an invalid length` };
    }
    if (rule.pattern && !rule.pattern.test(normalized)) {
      return { ok: false, error: rule.message || `${name} has an invalid format` };
    }
    return { ok: true, value: normalized };
  }
  if (rule.type === "boolean") {
    if (typeof value !== "boolean") return { ok: false, error: rule.message || `${name} must be a boolean` };
    return { ok: true, value };
  }
  return { ok: false, error: `${name} uses an unsupported validation rule` };
}

export function validateObject(input, schema, { allowUnknown = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  if (!allowUnknown) {
    const unknown = Object.keys(input).find((key) => !(key in schema));
    if (unknown) return { ok: false, error: `Unknown field: ${unknown}` };
  }
  const data = {};
  for (const [name, rule] of Object.entries(schema)) {
    const result = validateField(name, input[name], rule);
    if (!result.ok) return result;
    if (result.value !== undefined) data[name] = result.value;
  }
  return { ok: true, data };
}

export async function parseJsonRequest(request, schema, {
  maxBytes = DEFAULT_MAX_JSON_BYTES,
  allowUnknown = true,
} = {}) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return fail("Request body is too large", 413, "PAYLOAD_TOO_LARGE");
  }
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return fail("Could not read request body", 400);
  }
  if (utf8ByteLength(rawBody) > maxBytes) {
    return fail("Request body is too large", 413, "PAYLOAD_TOO_LARGE");
  }
  let input;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return fail("Request body must contain valid JSON", 400);
  }
  const validation = validateObject(input, schema, { allowUnknown });
  if (!validation.ok) return fail(validation.error, 400);
  return { ok: true, data: validation.data };
}

export function parseSearchParams(request, schema, { allowUnknown = true } = {}) {
  let params;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return fail("Invalid request URL", 400);
  }
  const validation = validateObject(Object.fromEntries(params.entries()), schema, { allowUnknown });
  if (!validation.ok) return fail(validation.error, 400);
  return { ok: true, data: validation.data };
}
