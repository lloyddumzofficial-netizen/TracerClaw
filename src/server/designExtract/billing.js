import { adminSupabase as db } from "@/lib/supabase";
import { DESIGN_EXTRACT_CLAWS, DESIGN_EXTRACT_PRICE_VERSION, DESIGN_EXTRACT_DEFAULT_BILLING_MODE } from "@/lib/designExtractPricing";

export async function designBillingQuote(userId) {
  const mode = designBillingMode();
  const { data, error } = await db.from("profiles").select("credits").eq("id", userId).maybeSingle();
  const balance = !error && Number.isInteger(data?.credits) && data.credits >= 0 ? data.credits : null;
  if (mode === "paid" && balance === null) throw Object.assign(new Error("Could not confirm your Claw balance. Retry before generating."), { status: 503, designExtractError: true });
  return { mode, priceVersion: DESIGN_EXTRACT_PRICE_VERSION, prices: DESIGN_EXTRACT_CLAWS, balance };
}

export function designBillingMode() {
  const mode = process.env.DESIGN_EXTRACT_BILLING_MODE ?? DESIGN_EXTRACT_DEFAULT_BILLING_MODE;
  if (!["beta", "paid"].includes(mode)) throw Object.assign(new Error("Design Extract billing is not configured"), { status: 503, designExtractError: true });
  return mode;
}
export async function claimPaidDesignOperation(project, record) {
  const { data, error } = await db.rpc(record.processor === "workflow" ? "claim_design_extract_v2" : "claim_design_extract", {
    target_user: project.user_id, target_project: project.id, expected_revision: project.revision,
    request_key: record.idempotency_key, operation_kind: record.kind, target_layer: record.layer_id,
    provider_model: record.model, provider_input: record.input,
    ...(record.processor === "workflow" ? { operation_processor: "workflow" } : {}),
  });
  // An RPC failure may have committed. Never fall back to another debit or dispatch.
  if (error) throw Object.assign(new Error("Could not confirm the credit reservation. Reopen this project before retrying."), { status: 503, designExtractError: true });
  if (data?.status === "insufficient_credits") throw Object.assign(new Error("Not enough Claws for this operation"), { status: 402, designExtractError: true });
  if (!["charged", "existing"].includes(data?.status) || !data.job) throw Object.assign(new Error("Project changed or an operation is active. Reload before continuing."), { status: 409, designExtractError: true });
  return { job: data.job, dispatch: data.status === "charged", creditsRemaining: data.credits_remaining };
}
export async function settleDesignBilling(job) {
  // Legacy beta records have no billing_state. A paid record must always settle,
  // even if the operator switches the application back to beta mode afterwards.
  if (!job || !["held", "settled", "refunded"].includes(job.billing_state)) return job;
  const { data, error } = await db.rpc("settle_design_extract_billing", { target_user: job.user_id, target_job: job.id });
  if (error || !["held", "settled", "refunded"].includes(data?.status)) throw Object.assign(new Error("Could not confirm the operation's billing status. Resume checking to retry safely."), { status: 503, designExtractError: true });
  return { ...job, billing_state: data.status };
}

export async function heldDesignJobs(projectId) {
  const { data, error } = await db.from("design_extract_jobs").select("*").eq("project_id", projectId).eq("billing_state", "held");
  if (error) {
    if (designBillingMode() === "beta" && ["42703", "PGRST204"].includes(error.code)) return [];
    throw error;
  }
  return data || [];
}
export async function recoverDesignBilling() {
  const { data, error } = await db.from("design_extract_jobs").select("*").eq("billing_state", "held").in("status", ["failed", "ready", "accepted", "rejected"]).order("updated_at").limit(20);
  if (error) {
    if (designBillingMode() === "beta" && ["42703", "PGRST204"].includes(error.code)) return;
    throw error;
  }
  for (const job of data || []) await settleDesignBilling(job);
}
