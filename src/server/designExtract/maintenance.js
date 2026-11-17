import { adminSupabase as db } from "@/lib/supabase";
import { deleteR2Prefix } from "@/lib/cloudflare";
import { prefix, settleOperation } from "./service";
const missingTable = error => ["42P01", "PGRST205"].includes(error?.code);
export async function maintainDesignExtract() {
  const now = new Date().toISOString();
  const expired = await db.from("design_extract_projects").select("*").lt("expires_at", now).order("expires_at").limit(5);
  if (missingTable(expired.error)) return;
  if (expired.error) throw expired.error;
  for (const project of expired.data || []) {
    await deleteR2Prefix(prefix(project), { allowedPrefixes: [prefix(project)] });
    const deleted = await db.from("design_extract_projects").delete().eq("id", project.id);
    if (deleted.error) throw deleted.error;
  }
  const pending = await db.from("design_extract_jobs").select("*").in("status", ["queued", "processing", "saving"]).order("created_at").limit(3);
  if (pending.error) throw pending.error;
  for (const job of pending.data || []) {
    const { data: project, error } = await db.from("design_extract_projects").select("*").eq("id", job.project_id).gt("expires_at", now).maybeSingle();
    if (error) throw error;
    if (project) { try { await settleOperation(project, job); } catch (err) { console.warn("[Design Extract] Recovery will retry", { jobId: job.id, message: err.message }); } }
  }
}
