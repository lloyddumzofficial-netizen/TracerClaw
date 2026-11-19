import { adminSupabase as db } from '@/lib/supabase';
import { settleOperation, reviewOperation, ownedProject } from './service';

// One expensive legacy step per watchdog invocation; no asset cleanup here.
// The durable job/request ID remains the authority, never a new generation.
export async function recoverLegacyDesignJobs() {
  const now = new Date().toISOString();
  const ready = await db.from('design_extract_jobs').select('*').eq('processor', 'legacy').eq('kind', 'extract').eq('status', 'ready').order('updated_at').limit(3);
  if (ready.error) throw ready.error;
  for (const job of ready.data || []) {
    const project = await projectFor(job, now);
    if (!project || project.revision !== job.base_revision) continue;
    try { await reviewOperation(project, job.id, true); }
    catch (error) {
      const current = await db.from('design_extract_jobs').select('status').eq('id', job.id).single();
      if (current.error || current.data?.status !== 'accepted') throw error;
    }
  }
  const pending = await db.from('design_extract_jobs').select('*').eq('processor', 'legacy').in('status', ['queued', 'processing', 'saving']).order('updated_at').limit(1);
  if (pending.error) throw pending.error;
  const reserved = await db.from('design_extract_jobs').select('*').eq('processor', 'legacy').eq('status', 'submitting').eq('billing_state', 'held').is('dispatch_started_at', null).order('updated_at').limit(1);
  if (reserved.error) throw reserved.error;
  const candidate = [...(pending.data || []), ...(reserved.data || [])].sort((a,b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))[0];
  if (!candidate) return;
  const project = await projectFor(candidate, now);
  if (!project) return;
  const job = await settleOperation(project, candidate);
  if (job.status === 'ready' && job.kind === 'extract') {
    const current = await ownedProject(project.id, project.user_id);
    if (current.revision === job.base_revision) await reviewOperation(current, job.id, true);
  }
}

async function projectFor(job, now) {
  const result = await db.from('design_extract_projects').select('*').eq('id', job.project_id).eq('user_id', job.user_id).gt('expires_at', now).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
