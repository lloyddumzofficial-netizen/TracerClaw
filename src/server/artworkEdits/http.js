import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { createClient } from "@/utils/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { MAX_EDIT_BODY_BYTES } from "@/lib/artworkEdits";
import { artworkEditsEnabled, editError } from "./service";

export async function editUser(request, { requireEnabled = true } = {}) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const client = token ? adminSupabase : await createClient();
  const { data: { user }, error } = await client.auth.getUser(token || undefined);
  if (error || !user) throw editError("Please sign in again.", 401);
  if (requireEnabled && !artworkEditsEnabled(user)) throw editError("Artwork editing is not enabled for this account.", 403);
  return user;
}
export async function editRateLimit(userId, writing = false) {
  const limit = await enforceRateLimit({ namespace: `artwork-edit:${writing ? "write" : "read"}`, identifier: userId, max: writing ? 8 : 90, window: "60 s", windowMs: 60000 });
  return limit.success ? null : limit.response;
}
export async function editBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw editError("Missing request body.");
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_EDIT_BODY_BYTES) { await reader.cancel(); throw editError("Editing request is too large.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw editError("Invalid editing request."); }
}
export function editFailure(error) {
  const text = error.message || "";
  const known = ["SOURCE_CHANGED", "PROJECT_BUSY", "REQUEST_KEY_CONFLICT", "INSUFFICIENT_CREDITS", "EDIT_NOT_FOUND", "PROJECT_NOT_FOUND", "NO_GARMENT_ARTWORK"].find(code => text.includes(code));
  if (known) return NextResponse.json({ error: known, code: known }, { status: known === "INSUFFICIENT_CREDITS" ? 402 : known.includes("NOT_FOUND") ? 404 : 409 });
  const status = error.status || (error instanceof Error && !error.code ? 400 : 503);
  return NextResponse.json({ error: status < 500 ? text : "Artwork editing is temporarily unavailable. Your saved artwork is safe." }, { status });
}
export function editJson(body, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
