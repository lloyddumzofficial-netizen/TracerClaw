// Explicit, isolated live billing verification. Never invokes fal or touches existing balances.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes('--allow-test-fixtures')) throw new Error('Requires --allow-test-fixtures: creates and removes a temporary non-admin test account.');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const anonymous=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`design-extract-readiness-${randomUUID()}@example.invalid`;
const password=randomBytes(36).toString('base64url');
let owner;
const projects=[];
const check=result=>{if(result.error)throw Object.assign(new Error('Database verification request failed'),{code:result.error.code,status:result.error.status});return result.data;};
try {
  const created=check(await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{design_extract_readiness_probe:true}}));
  owner=created.user.id;
  check(await db.from('profiles').upsert({id:owner,email,credits:5,is_admin:false}));
  for(let i=0;i<2;i++){
    const id=randomUUID();projects.push(id);
    check(await db.from('design_extract_projects').insert({id,user_id:owner,source_url:'https://readiness.invalid/never-submitted.png',manifest:{version:1,name:'Disposable readiness probe',width:16,height:16,layers:[]},expires_at:new Date(Date.now()+600000).toISOString()}));
  }
  const balance=async()=>check(await db.from('profiles').select('credits').eq('id',owner).single()).credits;
  const params=(key,kind='extract',project=projects[0],user=owner,revision=0)=>({target_user:user,target_project:project,expected_revision:revision,request_key:key,operation_kind:kind,target_layer:null,provider_model:kind==='segment'?'fal-ai/sam-3/image':'fal-ai/qwen-image-layered',provider_input:{image_url:'https://readiness.invalid/never-submitted.png'}});
  const claim=async(...args)=>check(await db.rpc('claim_design_extract',params(...args)));
  const settle=async id=>check(await db.rpc('settle_design_extract_billing',{target_user:owner,target_job:id}));
  const wrongOwner='00000000-0000-0000-0000-000000000000';
  assert.equal((await claim('ownership-probe','extract',projects[0],wrongOwner)).status,'not_found');
  assert.equal((await claim('revision-probe','extract',projects[0],owner,999)).status,'revision_conflict');
  const claims=await Promise.all(Array.from({length:8},()=>claim('concurrent-paid-probe')));
  assert.equal(claims.filter(r=>r.status==='charged').length,1);
  assert.equal(claims.filter(r=>r.status==='existing').length,7);
  const job=claims.find(r=>r.status==='charged').job;
  assert.equal(await balance(),3);assert.equal(job.charge_amount,2);assert.equal(job.dispatch_started_at,null);
  const marks=await Promise.all(Array.from({length:8},async()=>check(await db.from('design_extract_jobs').update({dispatch_started_at:new Date().toISOString()}).eq('id',job.id).eq('user_id',owner).is('dispatch_started_at',null).select('id'))));
  assert.equal(marks.reduce((count,rows)=>count+rows.length,0),1);
  assert.equal((await claim('second-active-probe')).status,'operation_active');
  check(await db.from('design_extract_jobs').update({status:'failed',error:'Disposable readiness failure; no provider call'}).eq('id',job.id).eq('user_id',owner));
  const refunds=await Promise.all(Array.from({length:8},()=>settle(job.id)));
  assert(refunds.every(r=>r.status==='refunded'));assert.equal(await balance(),5);
  const paid=await claim('settlement-probe','split');
  assert.equal(paid.job.charge_amount,2);assert.equal(await balance(),3);
  check(await db.from('design_extract_jobs').update({status:'ready',result:{layers:[{id:'fixture-only',url:'https://readiness.invalid/never-created.png'}]}}).eq('id',paid.job.id).eq('user_id',owner));
  assert.equal((await settle(paid.job.id)).status,'settled');assert.equal((await settle(paid.job.id)).status,'settled');assert.equal(await balance(),3);
  const segment=await claim('segment-cost-probe','segment',projects[1]);assert.equal(segment.job.charge_amount,1);assert.equal(await balance(),2);
  check(await db.from('design_extract_jobs').update({status:'failed'}).eq('id',segment.job.id).eq('user_id',owner));
  assert.equal((await settle(segment.job.id)).status,'refunded');assert.equal(await balance(),3);
  const entries=check(await db.from('design_extract_ledger').select('amount,state').eq('user_id',owner));assert.equal(entries.length,3);
  const logs=check(await db.from('credit_logs').select('amount,action').eq('user_id',owner));
  assert.equal(logs.filter(row=>row.action==='Design Extract refund').length,2);
  assert.equal(logs.filter(row=>row.action==='Design Extract: extract').length,1);
  check(await db.from('profiles').update({credits:0}).eq('id',owner));
  assert.equal((await claim('insufficient-probe','segment',projects[1])).status,'insufficient_credits');
  assert.equal(check(await db.from('design_extract_ledger').select('job_id').eq('user_id',owner)).length,3);
  assert.equal((await anonymous.rpc('claim_design_extract',params('unprivileged-probe'))).error?.code,'42501');
  assert.equal((await anonymous.rpc('settle_design_extract_billing',{target_user:owner,target_job:job.id})).error?.code,'42501');
  console.log(JSON.stringify({liveBillingVerified:true,concurrentClaimCount:8,singleDispatchWinner:true,concurrentRefundCount:8,pricesVerified:{extract:2,split:2,segment:1},settlementIdempotent:true,insufficientBalanceDenied:true,ownershipAndRevisionVerified:true,anonymousRpcDenied:true,authenticatedLoginTest:"not attempted; CAPTCHA protection preserved",providerCalls:0,existingBalancesTouched:0}));
} catch(error){ console.error('Live billing verification failed',{code:error.code||null,status:error.status||null,message:error.name==='AssertionError'?error.message:'Check failed; no credentials logged'});process.exitCode=1; }
finally {
  if(owner){
    try{
      // IDs belong solely to the account created in this invocation; never enumerate existing users.
      check(await db.from('design_extract_projects').delete().eq('user_id',owner).in('id',projects));
      check(await db.from('design_extract_ledger').delete().eq('user_id',owner));
      check(await db.from('credit_logs').delete().eq('user_id',owner));
      check(await db.auth.admin.deleteUser(owner));
      console.log(JSON.stringify({temporaryAccountAndBillingFixturesRemoved:true}));
    }catch(error){console.error('Temporary fixture cleanup needs attention',{code:error.code||null});process.exitCode=1;}
  }
}
