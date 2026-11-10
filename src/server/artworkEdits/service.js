import { createHash } from "node:crypto";
import { adminSupabase as db } from "@/lib/supabase";
import { uploadToR2, s3Client, bucketName } from "@/lib/cloudflare";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { DEFAULT_MAX_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl } from "@/lib/ssrf";
import { EDIT_MODEL, isCompleteDesignProject, validateEditInstructions } from "@/lib/artworkEdits";
import { buildEditMasks, compositeEdit, referenceImage, sourcePixels } from "./images";
import { buildArtworkEditPrompt } from "./prompt";
import { editContext, cropSource, cropMask, sourcePng, validateContext, buildContextPreview } from "./context";
import { logger } from "@/lib/logger";

export const editError = (message, status = 400) => Object.assign(new Error(message), { status });
export function artworkEditsEnabled(user) {
  const mode = process.env.ARTWORK_EDITS_MODE || "off";
  return mode === "all" || (mode === "admin" && Boolean(user?.email && process.env.ADMIN_EMAIL && user.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()));
}
const unwrap = result => { if (result.error) throw result.error; return result.data; };
const prefix = edit => `projects/${edit.project_id}/artwork-edits/${edit.id}/`;
const isCompletedBalanceFailure = error => error.status === 403 &&
  [error.body?.detail, error.body?.message].some(value => typeof value === "string" && /^User is locked\. Reason: TOP_UP\.?$/i.test(value.trim()));

export async function ownedProject(userId, projectId) {
  const project = unwrap(await db.from("projects").select("*").eq("id", projectId).eq("user_id", userId).maybeSingle());
  if (!project || Date.parse(project.created_at) < Date.now() - 3 * 86400000) throw editError("Project not found or expired.", 404);
  if (!isCompleteDesignProject(project)) throw editError("Artwork editing is available for Keep Complete Design only.");
  return project;
}
export async function readEdit(userId, projectId, editId) {
  const edit = unwrap(await db.from("artwork_edits").select("*").eq("id", editId).eq("project_id", projectId).eq("user_id", userId).maybeSingle());
  if (!edit) throw editError("Edit not found.", 404);
  return edit;
}
export async function listEdits(userId, projectId) {
  return unwrap(await db.from("artwork_edits").select("*").eq("project_id", projectId).eq("user_id", userId).order("created_at", { ascending: false }).limit(30));
}
async function loadSource(project, url) {
  if (!isOwnedStorageUrl(url, { userId: project.user_id, projectId: project.id })) throw editError("Invalid project source.");
  const { buffer } = await fetchWithSSRFProtection(url, { allowedHosts: getAllowedStorageHosts(), maxBytes: DEFAULT_MAX_IMAGE_BYTES, allowedContentTypes: ["image/"] });
  return sourcePixels(buffer);
}
async function settle(edit, result, error) {
  return unwrap(await db.rpc("settle_artwork_edit", { p_edit: edit.id, p_user: edit.user_id, p_result: result, p_error: error }));
}
function publicEdit(edit) {
  // Do not expose provider identifiers, fingerprints or internal snapshots.
  const { id, project_id, base_revision, source_url, instructions, status, result_url, error_code, created_at, applied_revision } = edit;
  return { id, project_id, base_revision, source_url, instructions, status, result_url, error_code, created_at, applied_revision };
}
export { publicEdit };

export async function startEdit(project, user, body) {
  if (!process.env.FAL_KEY) throw editError("AI editing is temporarily unavailable.", 503);
  const instructions = validateEditInstructions(body.instructions);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(body.requestKey || "")) throw editError("Invalid request key.");
  if (!Number.isInteger(body.sourceRevision) || body.sourceRevision < 0) throw editError("Invalid source revision.");
  const sourceUrl = project.generated_image_url;
  if (!sourceUrl || sourceUrl === "REFUNDED") throw editError("Extract the artwork first.");
  const fingerprint = createHash("sha256").update(JSON.stringify({ instructions, revision: body.sourceRevision })).digest("hex");
  // Validate image/masks before charging. This also rejects empty and overlapping areas.
  const source = await loadSource(project, sourceUrl);
  const { masks, union } = await buildEditMasks(instructions, source.width, source.height);
  const context = { ...editContext(source, union), reviewBoundary: true, referenceFormat: "color-overlay-v2" };
  const claim = unwrap(await db.rpc("claim_artwork_edit", {
    p_user: user.id, p_project: project.id, p_key: body.requestKey, p_revision: body.sourceRevision,
    p_source: sourceUrl, p_instructions: instructions, p_fingerprint: fingerprint,
  }));
  let edit = claim.edit;
  if (!claim.claimed) return edit;
  let submitting = false;
  try {
    const focused = await cropSource(source, context);
    const inputUrl = await uploadToR2(await sourcePng(focused), `${prefix(edit)}input-v1.png`, "image/png");
    const reference = await referenceImage(focused, masks.map(mask => cropMask(mask, source.width, context)));
    const referenceUrl = await uploadToR2(reference, `${prefix(edit)}reference.png`, "image/png");
    await uploadToR2(Buffer.from(JSON.stringify({ ...context, fingerprint })), `${prefix(edit)}context-v1.json`, "application/json");
    const { fal } = await import("@fal-ai/client");
    submitting = true;
    const queued = await fal.queue.submit(EDIT_MODEL, {
      input: { image_urls: [inputUrl, referenceUrl], prompt: buildArtworkEditPrompt(instructions, { focused: true }), resolution: "1K", output_format: "png", num_images: 1, aspect_ratio: context.aspectRatio },
      abortSignal: AbortSignal.timeout(25000),
    });
    if (!queued.request_id) throw new Error("Missing provider request ID");
    edit = unwrap(await db.from("artwork_edits").update({ provider_request_id: queued.request_id, updated_at: new Date().toISOString() }).eq("id", edit.id).select("*").single());
    unwrap(await db.from("generation_attempts").update({ provider_request_id: queued.request_id }).eq("id", edit.id));
    return edit;
  } catch (error) {
    const definiteRejection = [400, 401, 402, 403, 422].includes(error.status);
    const detail = typeof error.body?.detail === "string" ? error.body.detail : "";
    const reason = /balance|insufficient.funds|credits.exhausted|\bTOP_UP\b/i.test(detail) || isCompletedBalanceFailure(error) ? "PROVIDER_BALANCE" : definiteRejection ? "PROVIDER_REJECTION" : "UNCONFIRMED_SUBMISSION";
    logger.error("[Artwork edit] Submit failed", { editId: edit.id, status: error.status, submitting, reason });
    if (!submitting || definiteRejection) return settle(edit, null, "SUBMISSION_FAILED");
    // Submission may have reached fal. Never resubmit or charge twice after a timeout.
    return edit;
  }
}

async function recoverSavedPreview(edit) {
  // Deterministic owned key recovers a PNG uploaded before a database/network failure.
  const key = `${prefix(edit)}preview.png`;
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    await response.Body?.destroy?.();
    return `${process.env.CLOUDFLARE_PUBLIC_URL}/${key}`;
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function savedContext(edit, source) {
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: `${prefix(edit)}context-v1.json` }));
    const context = JSON.parse(await response.Body.transformToString());
    if (context.fingerprint !== edit.fingerprint) throw new Error("Artwork edit context fingerprint mismatch.");
    return validateContext(context, source);
  } catch (error) {
    // Jobs queued before focused editing still return full-frame outputs.
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function settleEdit(edit) {
  if (edit.status !== "processing") return edit;
  const saved = await recoverSavedPreview(edit);
  if (saved) return settle(edit, saved, null);
  if (!edit.provider_request_id) {
    // An interrupted/ambiguous queue submission gets a bounded grace period.
    if (Date.now() - Date.parse(edit.created_at) > 15 * 60000) return settle(edit, null, "SUBMISSION_INTERRUPTED");
    return edit;
  }
  if (!process.env.FAL_KEY) return edit;
  const { fal } = await import("@fal-ai/client");
  try {
    const status = await fal.queue.status(EDIT_MODEL, { requestId: edit.provider_request_id, logs: false, abortSignal: AbortSignal.timeout(15000) });
    if (["FAILED", "CANCELLED"].includes(status.status)) return settle(edit, null, "PROVIDER_FAILED");
    if (status.status !== "COMPLETED") return edit;
    let result;
    try {
      result = await fal.queue.result(EDIT_MODEL, { requestId: edit.provider_request_id, abortSignal: AbortSignal.timeout(15000) });
    } catch (error) {
      // A completed job can itself contain fal's TOP_UP failure. It has no
      // usable image. Do not confuse this with an auth error while polling
      // status, where the job outcome is still unknown and must be recoverable.
      if (isCompletedBalanceFailure(error)) return settle(edit, null, "PROVIDER_BALANCE");
      throw error;
    }
    const url = result?.data?.images?.[0]?.url;
    if (!url) return settle(edit, null, "EMPTY_OUTPUT");
    const { buffer } = await fetchWithSSRFProtection(url, { allowedHosts: getAllowedProviderHosts(), maxBytes: DEFAULT_MAX_IMAGE_BYTES, allowedContentTypes: ["image/"] });
    const project = await ownedProject(edit.user_id, edit.project_id);
    const source = await loadSource(project, edit.source_url);
    const { union } = await buildEditMasks(edit.instructions, source.width, source.height);
    const context = await savedContext(edit, source);
    const preview = context
      ? await buildContextPreview(source, buffer, union, context, { reviewBoundary: context.reviewBoundary === true })
      : { buffer: await compositeEdit(source, buffer, union), warningCode: null };
    if (preview.warningCode) {
      // Persist before uploading the deterministic preview key. Recovery can
      // then settle an interrupted upload without losing the review warning.
      unwrap(await db.from("artwork_edits").update({ error_code: preview.warningCode })
        .eq("id", edit.id).eq("status", "processing"));
    }
    const stored = await uploadToR2(preview.buffer, `${prefix(edit)}preview.png`, "image/png");
    return settle(edit, stored, null);
  } catch (error) {
    if (error.artworkOutputCode) return settle(edit, null, error.artworkOutputCode);
    // Only definite provider terminal errors are refundable. Storage/transient errors retry.
    if ([400, 422].includes(error.status)) return settle(edit, null, "PROVIDER_REJECTED");
    logger.error("[Artwork edit] Settlement deferred", { editId: edit.id, message: String(error.message).slice(0, 160) });
    return edit;
  }
}

export async function applyEdit(userId, projectId, editId, restore = false) {
  await readEdit(userId, projectId, editId);
  return unwrap(await db.rpc("apply_artwork_edit", { p_edit: editId, p_user: userId, p_restore: restore }));
}

export async function reconcileArtworkEdits() {
  const rows = await db.from("artwork_edits").select("*").eq("status", "processing").order("created_at").limit(2);
  if (["42P01", "PGRST205"].includes(rows.error?.code)) return; // Safe before migration rollout.
  for (const edit of unwrap(rows) || []) {
    try { await settleEdit(edit); } catch (error) { logger.error("[Artwork edit] Recovery deferred", { editId: edit.id, message: error.message }); }
  }
}
