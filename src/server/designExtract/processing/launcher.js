import {adminSupabase as db} from '@/lib/supabase';
import {logger} from '@/lib/logger';

const checked=result=>{if(result.error)throw result.error;return result.data;};
export async function dispatchPendingDesignWorkflows(targetJob=null) {
  const claimed=checked(await db.rpc('claim_design_extract_outbox',{target_job:targetJob,batch_limit:targetJob?1:5}));
  if(!claimed?.length)return {started:0};
  const {start}=await import('workflow/api');
  const {HookConflictError}=await import('workflow/errors');
  const {processDesignExtract}=await import('@/workflows/designExtract');
  let started=0;
  for(const entry of claimed) {
    try {
      let runId;
      try {
        const run=await start(processDesignExtract,[entry.job_id,entry.generation],{experimental_hook:{token:`design-extract:${entry.job_id}:${entry.generation}`,experimental_minRetention:'4 days'}});
        runId=run.runId;
      } catch(error) {
        if(!HookConflictError.is(error))throw error;
        runId=error.conflictingRunId;
      }
      if(typeof runId!=='string'||!runId.trim())throw new Error('Workflow start receipt unavailable');
      checked(await db.from('design_extract_outbox').update({state:'started',lease_token:null,lease_until:null,last_error_code:null,updated_at:new Date().toISOString()}).eq('job_id',entry.job_id).eq('generation',entry.generation).eq('lease_token',entry.lease_token));
      checked(await db.from('design_extract_jobs').update({processor_run_id:runId}).eq('id',entry.job_id).eq('processor_generation',entry.generation));
      started++;
    } catch(error) {
      const delay=Math.min(300,5*2**Math.min(entry.attempts||1,6));
      const result=await db.from('design_extract_outbox').update({lease_token:null,lease_until:null,next_attempt_at:new Date(Date.now()+delay*1000).toISOString(),last_error_code:'WORKFLOW_START_UNCONFIRMED',updated_at:new Date().toISOString()}).eq('job_id',entry.job_id).eq('generation',entry.generation).eq('lease_token',entry.lease_token);
      logger.warn('[Design Extract workflow] Outbox retry recorded',{jobId:entry.job_id,code:result.error?.code||error.code||null});
    }
  }
  return {started};
}
export async function wakeDesignWorkflow(job) {
  if(job?.processor!=='workflow'||['accepted','rejected','failed'].includes(job.status))return;
  try {await dispatchPendingDesignWorkflows(job.id);}
  catch(error) {logger.warn('[Design Extract workflow] Durable wakeup pending',{jobId:job.id,code:error.code||null});}
}
export async function maintainDesignWorkflows() {
  const cutoff=new Date(Date.now()-5*60000).toISOString();
  const stale=await db.from('design_extract_jobs').select('id').eq('processor','workflow').in('status',['submitting','queued','processing','saving']).lt('created_at',cutoff).or(`last_polled_at.is.null,last_polled_at.lt.${cutoff}`).order('last_polled_at').limit(5);
  if(stale.error) {
    if(['42703','PGRST204'].includes(stale.error.code))return {available:false};
    throw stale.error;
  }
  // Ready refinements deliberately wait for review; only initial extraction
  // needs automatic acceptance if its original worker disappeared.
  const ready=checked(await db.from('design_extract_jobs').select('id').eq('processor','workflow').eq('kind','extract').eq('status','ready').lt('last_polled_at',cutoff).order('last_polled_at').limit(5));
  for(const job of [...(stale.data||[]),...(ready||[])])checked(await db.rpc('requeue_stale_design_extract',{target_job:job.id}));
  await dispatchPendingDesignWorkflows();
  return {available:true};
}
