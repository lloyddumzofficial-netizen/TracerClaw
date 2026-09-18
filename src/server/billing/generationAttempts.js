import { adminSupabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export function isValidGenerationRequestKey(value) {
  return typeof value === "string" && REQUEST_KEY_PATTERN.test(value);
}

export function isGenerationAttemptStale(createdAt, staleAfterMs = 15 * 60_000) {
  const createdAtMs = Date.parse(createdAt || "");
  return Number.isFinite(createdAtMs) && Date.now() - createdAtMs >= staleAfterMs;
}

export async function claimGenerationAttempt({
  userId,
  projectId,
  operation,
  requestKey,
  chargeAction,
  chargeAmount = 1,
}) {
  if (!isValidGenerationRequestKey(requestKey)) {
    return { mode: "legacy", status: "missing_request_key" };
  }

  const { data, error } = await adminSupabase.rpc("claim_generation_attempt", {
    target_user_id: userId,
    target_project_id: projectId,
    attempt_operation: operation,
    attempt_request_key: requestKey,
    charge_action: chargeAction,
    charge_amount: chargeAmount,
  });

  if (error) {
    const safeLegacyFallback = [
      "PGRST202", // function missing during a staged deploy
      "PGRST203", // stale/ambiguous PostgREST function schema cache
      "42883",    // PostgreSQL function missing
      "42702",    // deterministic SQL ambiguity; transaction is rolled back
      "42804",    // deterministic RPC return-type mismatch; transaction rolled back
    ].includes(error.code);
    const logMessage = safeLegacyFallback
      ? "Idempotent claim unavailable; using legacy claim"
      : "Idempotent claim failed; refusing an uncertain second charge";
    logger.error(`[Billing] ${logMessage} (${error.code || "UNKNOWN"}: ${error.message || "No message"})`, {
      operation,
      projectId,
    });
    // Only a definite "function missing" error is safe to fall back from. A
    // timeout/network error may have committed the charge server-side, so a
    // legacy retry here could deduct twice.
    return safeLegacyFallback
      ? { mode: "legacy", status: "rpc_unavailable" }
      : { mode: "error", status: "claim_uncertain" };
  }

  const claim = Array.isArray(data) ? data[0] : data;
  return { mode: "idempotent", ...claim };
}

export async function completeGenerationAttempt(attemptId, resultUrl, resultMimeType = null) {
  if (!attemptId) return;
  const now = new Date().toISOString();
  const { error } = await adminSupabase
    .from("generation_attempts")
    .update({
      status: "completed",
      result_url: resultUrl,
      result_mime_type: resultMimeType,
      updated_at: now,
      completed_at: now,
    })
    .eq("id", attemptId)
    .eq("status", "processing");
  if (error) throw error;
}

export async function refundGenerationAttempt({ userId, attemptId, action, errorCode }) {
  if (!attemptId) return { status: "not_applicable" };
  const { data, error } = await adminSupabase.rpc("refund_generation_attempt", {
    target_user_id: userId,
    target_attempt_id: attemptId,
    refund_action: action,
    error_code_value: errorCode || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
