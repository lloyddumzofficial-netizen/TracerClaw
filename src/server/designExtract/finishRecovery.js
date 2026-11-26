import { adminSupabase as db } from "@/lib/supabase";
import { FINISH_RECEIPT_WINDOW_MS, finishCheckpoint, settleFinishAction } from "./finishBilling";
import { readPrivateDesignAsset } from "./storage";

const recoveryDelay = 5 * 60_000;
const recoveryBatchSize = 4;

async function readRecord(key) {
  try {
    return JSON.parse((await readPrivateDesignAsset(`r2-private://design-extract/${key}`, 16 * 1024)).toString("utf8"));
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

export async function recoverDesignFinishing(now = Date.now()) {
  // The delay exceeds the request's maximum duration. A failed Redis or R2 read
  // never authorizes another provider request or a speculative refund.
  const pending = () => db.from("design_extract_finish_actions")
    .select("id,batch_id,action,created_at,design_extract_finish_bundles!inner(user_id)")
    .eq("state", "pending");
  const oldEnough = new Date(now - recoveryDelay).toISOString();
  const expired = new Date(now - FINISH_RECEIPT_WINDOW_MS - recoveryDelay).toISOString();
  // Keep capacity for old reservations even when new ones are continuously added.
  const batches = await Promise.all([
    pending().lt("created_at", expired).order("created_at").limit(recoveryBatchSize),
    pending().gte("created_at", expired).lt("created_at", oldEnough)
      .order("created_at", { ascending: false }).limit(recoveryBatchSize),
  ]);
  for (const batch of batches) if (batch.error) throw batch.error;

  let firstError;
  for (const action of batches.flatMap(batch => batch.data || [])) {
    try { await recoverAction(action, now); }
    catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

async function recoverAction(action, now) {
  const user_id = action.design_extract_finish_bundles.user_id;
  const batch = await db.from("design_extract_jobs").select("project_id").eq("id", action.batch_id).eq("user_id", user_id).maybeSingle();
  if (batch.error) throw batch.error;
  const project = { id: batch.data?.project_id, user_id };
  const checkpoint = project.id && await readRecord(finishCheckpoint(project, action.id));
  const prefix = `users/${user_id}/design-extract/${project.id}/${action.action}/`;
  if (checkpoint && (typeof checkpoint.recordKey !== "string" || !checkpoint.recordKey.startsWith(prefix))) throw new Error("Invalid finishing checkpoint");
  const record = checkpoint && await readRecord(checkpoint.recordKey);
  const matching = record?.finishActionId === action.id;
  // The existing request can still save a generated provider receipt.
  if (matching && record.state === "generated" && now - Date.parse(record.createdAt || action.created_at) < FINISH_RECEIPT_WINDOW_MS + recoveryDelay) return;
  await settleFinishAction(project, action.id, matching && ["done", "ready"].includes(record.state));
}
