import { adminSupabase as db } from "@/lib/supabase";
import { deleteDesignPrefix as deleteR2Prefix } from "./storage";
import { prefix, settleOperation } from "./service";
import { heldDesignJobs, recoverDesignBilling, settleDesignBilling, designBillingMode } from "./billing";
const missingTable = error => ["42P01", "PGRST205"].includes(error?.code);
export async function maintainDesignExtract() {
  const now = new Date().toISOString();
  const expired = await db.from("design_extract_projects").select("*").lt("expires_at", now).order("expires_at").limit(5);
  if (missingTable(expired.error)) return;
  if (expired.error) throw expired.error;
  for (const project of expired.data || []) {
    await deleteR2Prefix(prefix(project), { allowedPrefixes: [prefix(project)] });
    // Settle money before removing job evidence. Expiry does not extend access
    // to artwork, and a failed billing RPC leaves rows available for recovery.
    for (const job of await heldDesignJobs(project.id)) {
      if (!["ready", "accepted", "rejected", "failed"].includes(job.status)) {
        const usable = Array.isArray(job.result?.layers) && job.result.layers.length > 0;
        const next = usable ? "ready" : "failed";
        const result = await db.from("design_extract_jobs").update({ status: next, error: usable ? null : "Project expired before an output was saved", updated_at: now }).eq("id", job.id).eq("status", job.status).select().maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) continue;
        await settleDesignBilling(result.data);
      } else await settleDesignBilling(job);
    }
    if ((await heldDesignJobs(project.id)).length) continue;
    const deleted = await db.from("design_extract_projects").delete().eq("id", project.id);
    if (deleted.error) throw deleted.error;
  }
  await recoverDesignBilling();
  const { maintainDesignWorkflows } = await import("./processing/launcher");
  const workflows = await maintainDesignWorkflows();
  const legacy = query => workflows?.available ? query.eq("processor", "legacy") : query;
  const pending = await legacy(db.from("design_extract_jobs").select("*")).in("status", ["queued", "processing", "saving"]).order("created_at").limit(3);
  if (pending.error) throw pending.error;
  const undispatched = designBillingMode() === "paid" ? await legacy(db.from("design_extract_jobs").select("*")).eq("status", "submitting").eq("billing_state", "held").is("dispatch_started_at", null).order("created_at").limit(3) : { data: [] };
  if (undispatched.error) throw undispatched.error;
  for (const job of [...(pending.data || []), ...(undispatched.data || [])].filter(job => job.processor !== "workflow")) {
    const { data: project, error } = await db.from("design_extract_projects").select("*").eq("id", job.project_id).gt("expires_at", now).maybeSingle();
    if (error) throw error;
    if (project) { try { await settleOperation(project, job); } catch (err) { console.warn("[Design Extract] Recovery will retry", { jobId: job.id, code: err.code || null, status: err.status || null }); } }
  }
}
