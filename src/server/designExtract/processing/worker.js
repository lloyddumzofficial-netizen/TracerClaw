import {adminSupabase as db} from '@/lib/supabase';
import {logger} from '@/lib/logger';
import {ownedProject,settleOperation,reviewOperation} from '../service';
import {settleDesignBilling} from '../billing';

import { DESIGN_OPERATION_DEADLINE_MS } from '@/lib/designExtract';
export { DESIGN_OPERATION_DEADLINE_MS };
const checked=result=>{if(result.error)throw result.error;return result.data;};
export async function advanceDesignWorkflowJob(jobId,generation,runId) {
  let job,token,previousProgress;
  try {
    const claim=checked(await db.rpc('claim_design_extract_step',{target_job:jobId,target_generation:generation,target_run:runId}));
    if(claim.status==='obsolete')return {done:true,outcome:'obsolete'};
    if(claim.status==='busy')return {done:false,delayMs:10000};
    job=claim.job;token=claim.lease_token;
    previousProgress=job&&`${job.status}:${job.result?.enhancement?.revision||0}:${job.result?.layers?.length||0}`;
    if(claim.status==='terminal') {await settleDesignBilling(job);return {done:true,outcome:job.status};}
    if(!job||!token)throw new Error('Invalid processing lease');
    const project=checked(await db.from('design_extract_projects').select('*').eq('id',job.project_id).eq('user_id',job.user_id).maybeSingle());
    if(!project) return {done:true,outcome:'project_removed'};
    const deadline=Date.parse(job.created_at)+DESIGN_OPERATION_DEADLINE_MS;
    if(!Number.isFinite(deadline)||Date.now()>=deadline||Date.parse(project.expires_at)<=Date.now()) {
      const usable=Boolean(job.result?.layers?.length);
      const expired=Date.parse(project.expires_at)<=Date.now();
      const result=usable?{...job.result,warnings:[...new Set([...(job.result.warnings||[]),'Processing reached its time limit. Available saved layers were kept.'])]}:job.result;
      job=checked(await db.from('design_extract_jobs').update({status:usable?'ready':'failed',result,error:usable?null:'No usable layers were saved before the processing deadline',updated_at:new Date().toISOString()}).eq('id',job.id).eq('processor_generation',generation).eq('processing_lease_token',token).select().single());
      await settleDesignBilling(job);
      if(expired)return {done:true,outcome:usable?'expired_with_saved_output':'expired_refunded'};
    } else {
      job=await settleOperation(project,job);
      if(job.processor_generation!==generation||job.processing_lease_token!==token)return {done:true,outcome:'obsolete'};
    }
    if(job.status==='ready'&&job.kind==='extract') {
      try {await reviewOperation(await ownedProject(project.id,job.user_id),job.id,true);}
      catch(error) {
        const current=checked(await db.from('design_extract_jobs').select('status').eq('id',job.id).single());
        if(current?.status!=='accepted')throw error;
      }
      return {done:true,outcome:'accepted'};
    }
    if(['ready','accepted','rejected','failed'].includes(job.status)) return {done:true,outcome:job.status};
    return {done:false,delayMs:job.status==='saving'?5000:job.status==='submitting'?30000:15000};
  } catch(error) {
    logger.warn('[Design Extract workflow] Safe recovery pending',{jobId,code:error.code||null,status:error.status||null});
    return {done:false,retryable:true,delayMs:15000};
  } finally {
    if(token) {
      const now=new Date().toISOString();
      const update=await db.from('design_extract_jobs').update({processing_lease_token:null,processing_lease_until:null,last_polled_at:now,...(job&&`${job.status}:${job.result?.enhancement?.revision||0}:${job.result?.layers?.length||0}`!==previousProgress?{last_progress_at:now}:{})}).eq('id',jobId).eq('processor_generation',generation).eq('processing_lease_token',token);
      if(update.error)logger.warn('[Design Extract workflow] Lease will expire safely',{jobId,code:update.error.code||null});
      if(job&&['ready','accepted','rejected','failed'].includes(job.status)) {
        const ack=await db.from('design_extract_outbox').update({state:'complete',lease_token:null,lease_until:null,updated_at:now}).eq('job_id',jobId).eq('generation',generation);
        if(ack.error)logger.warn('[Design Extract workflow] Completion acknowledgement pending',{jobId,code:ack.error.code||null});
      }
    }
  }
}
