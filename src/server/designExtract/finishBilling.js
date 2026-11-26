import { adminSupabase as db } from "@/lib/supabase";
import { designBillingMode } from "./billing";
import { uploadDesignAsset } from "./storage";

export const FINISH_RECEIPT_WINDOW_MS = 24 * 60 * 60_000;

export async function finishReceiptExpired(record) {
  if (!record.finishActionId) return false;
  let createdAt = Date.parse(record.createdAt);
  if (!Number.isFinite(createdAt)) {
    const { data, error } = await db.from("design_extract_finish_actions").select("state,created_at").eq("id", record.finishActionId).maybeSingle();
    if (error) throw error;
    if (!data || data.state === "refunded") return true;
    createdAt = Date.parse(data.created_at);
  }
  return Date.now() - createdAt >= FINISH_RECEIPT_WINDOW_MS;
}

export async function claimFinishAction(project, layerId, action, acknowledgedClaws) {
  if (designBillingMode() === "beta") return null;
  const { data, error } = await db.rpc("claim_design_extract_finish", {
    target_user: project.user_id, target_project: project.id, expected_revision: project.revision,
    target_layer: layerId, requested_action: action, acknowledged_claws: acknowledgedClaws === 1 ? 1 : null,
  });
  if (error) throw error;
  if (data?.status === "legacy" && process.env.VERCEL_ENV !== "production") return null;
  if (data?.status === "claimed" && data.id) return data.id;
  const responses = {
    offer: [409, "Unlock Upscale + SVG for this extraction for 1 Claw."],
    insufficient: [402, "You need 1 Claw to unlock Upscale + SVG."],
    pending: [409, "An action is pending. Check the existing result before starting another."],
    used: [409, "This layer already used its included action."],
    stale: [409, "The project changed. Reload before continuing."],
    limit: [409, "This layer is outside the extraction’s nine-layer allowance."],
    legacy: [409, "This layer is outside a finishing bundle. Run Extract elements to create eligible layers."],
  };
  const status = Object.hasOwn(responses, data?.status) ? data.status : null;
  const [httpStatus, message] = responses[status] || [503, "Could not confirm the finishing allowance."];
  throw Object.assign(new Error(message), {
    designExtractError: true, status: httpStatus, ...(status === "offer" && { code: "DESIGN_FINISH_UNLOCK_REQUIRED" }),
  });
}

export async function settleFinishAction(project, actionId, usable) {
  if (!actionId) return;
  const { error } = await db.rpc("settle_design_extract_finish", {
    target_user: project.user_id, target_action: actionId, usable,
  });
  if (error) throw error;
}

export function finishCheckpoint(project, actionId) {
  return `users/${project.user_id}/design-extract/${project.id}/finish/${actionId}.json`;
}

export async function trackFinishAction(project, actionId, recordKey) {
  if (actionId) await uploadDesignAsset(Buffer.from(JSON.stringify({ recordKey })), finishCheckpoint(project, actionId), "application/json", { ifAbsent: true });
}

export const confirmedFinishRejection = status => [400, 401, 402, 403, 404, 413, 422, 429].includes(status);
