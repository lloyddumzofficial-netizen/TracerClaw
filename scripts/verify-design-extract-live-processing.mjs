// Isolated real database + local Workflow runtime canary. Never calls fal:
// fixtures already have usable output and require only checkpoint settlement.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes('--allow-test-fixtures')) throw new Error('Requires --allow-test-fixtures; creates and removes an isolated temporary account.');
const base=process.env.DESIGN_WORKFLOW_TEST_URL||'http://localhost:3000';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw new Error('This canary targets the local application only.');
if(!process.env.CRON_SECRET)throw new Error('CRON_SECRET is required.');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const checked=result=>{if(result.error)throw Object.assign(new Error('Canary database request failed'),{code:result.error.code});return result.data;};
let owner;const projectIds=[];let runs=[];
try{
  const other=checked(await db.from('design_extract_jobs').select('id').in('status',['submitting','queued','processing','saving','ready']).limit(1));
  assert.equal(other.length,0,'Run in isolation: other active Design Extract jobs exist.');
  owner=checked(await db.auth.admin.createUser({email:`workflow-canary-${randomUUID()}@example.invalid`,password:randomBytes(36).toString('base64url'),email_confirm:true})).user.id;
  checked(await db.from('profiles').update({credits:0}).eq('id',owner));
  for(let index=0;index<10;index++){
    const id=randomUUID();projectIds.push(id);
    const source=`r2-private://design-extract/users/${owner}/design-extract/${id}/source.png`;
    checked(await db.from('design_extract_projects').insert({id,user_id:owner,source_url:source,manifest:{version:1,width:1,height:1,layers:[]}}));
    checked(await db.from('design_extract_jobs').insert({project_id:id,user_id:owner,idempotency_key:`canary-${index}`,base_revision:0,kind:'split',model:'fal-ai/qwen-image-layered',input:{image_url:source},status:'ready',processor:'workflow',result:{layers:[{id:'saved-fixture',width:1,height:1,url:source}]}}));
  }
  const started=Date.now();
  for(let attempt=0;attempt<80;attempt++){
    if(attempt%5===0){const response=await fetch(`${base}/api/cron/design-extract`,{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(65000)});assert.equal(response.status,200,'Local watchdog could not dispatch fixtures');}
    const jobs=checked(await db.from('design_extract_jobs').select('id,processor_run_id,processing_lease_token,billing_state,status,request_id,dispatch_started_at').eq('user_id',owner));
    runs=jobs.map(job=>job.processor_run_id).filter(Boolean);
    const outbox=checked(await db.from('design_extract_outbox').select('state').in('job_id',jobs.map(job=>job.id)));
    if(outbox.length===10&&outbox.every(entry=>entry.state==='complete')){
      assert.equal(new Set(runs).size,10);assert(jobs.every(job=>job.status==='ready'&&job.billing_state==='beta'&&!job.request_id&&!job.dispatch_started_at&&!job.processing_lease_token));
      const profile=checked(await db.from('profiles').select('credits').eq('id',owner).single());assert.equal(profile.credits,0);
      console.log(JSON.stringify({liveProcessingVerified:true,projects:10,completedWorkflows:10,browserRequired:false,providerSubmissions:0,clawsCharged:0,durationMs:Date.now()-started}));
      break;
    }
    if(attempt===79)throw new Error('Workflow canary did not complete within its bounded wait');
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}catch(error){console.error('Live workflow canary failed',{code:error.code||null,message:error.name==='AssertionError'?error.message:'Recovery verification did not complete; inspect local workflow status.'});process.exitCode=1;}
finally{
  if(owner){
    try{
      if(process.exitCode&&runs.length){const{getRun}=await import('workflow/api');await Promise.allSettled(runs.map(id=>getRun(id).cancel()));}
      checked(await db.from('design_extract_projects').delete().eq('user_id',owner).in('id',projectIds));
      checked(await db.from('credit_logs').delete().eq('user_id',owner));
      checked(await db.auth.admin.deleteUser(owner));
      console.log(JSON.stringify({temporaryProcessingFixturesRemoved:true}));
    }catch(error){console.error('Canary fixture cleanup requires attention',{code:error.code||null});process.exitCode=1;}
  }
}
