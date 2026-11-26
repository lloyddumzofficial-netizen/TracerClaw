import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import path from 'node:path';
const {PGlite}=await (process.env.PGLITE_TEST_MODULE?import(pathToFileURL(path.resolve(process.env.PGLITE_TEST_MODULE)).href):import('@electric-sql/pglite'));const db=new PGlite();
try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE profiles(id uuid PRIMARY KEY,credits integer NOT NULL); CREATE TABLE credit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles(id),action text,amount integer);');
 for(const file of ['038_design_extract.sql','039_design_extract_billing.sql','040_design_extract_processing.sql','041_design_extract_sam2.sql','042_design_extract_local_processor.sql','043_design_refined.sql'])await db.exec(await readFile('database/migrations/'+file,'utf8'));
 const owner='10000000-0000-4000-8000-000000000001';await db.query('INSERT INTO profiles VALUES($1,20)',[owner]);
 const claim=async(n,processor='workflow')=>{const project=`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;await db.query("INSERT INTO design_extract_projects(id,user_id,source_url,manifest)VALUES($1,$2,'https://test.invalid','{}')ON CONFLICT DO NOTHING",[project,owner]);return(await db.query("SELECT claim_design_extract_v2($1,$2,0,$3,'extract',NULL,'fal-ai/sam2/auto-segment','{}',$4)AS result",[owner,project,'processing-'+n,processor])).rows[0].result;};
 const first=await claim(1);assert.equal(first.status,'charged');assert.equal(first.job.processor,'workflow');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM design_extract_outbox')).rows[0].n,1);
 assert.equal((await claim(1)).status,'existing');assert.equal((await db.query('SELECT credits FROM profiles WHERE id=$1',[owner])).rows[0].credits,18);
 const outbox=async()=> (await db.query('SELECT * FROM claim_design_extract_outbox($1,1)',[first.job.id])).rows;
 assert.equal((await outbox()).length,1);assert.equal((await outbox()).length,0);
 const step=async(id,generation=1,run='test-run')=>(await db.query('SELECT claim_design_extract_step($1,$2,$3)AS result',[id,generation,run])).rows[0].result;
 const lease=await step(first.job.id);assert.equal(lease.status,'claimed');assert(lease.lease_token);
 assert.equal((await step(first.job.id,1,'duplicate-run')).status,'busy');
 const second=await claim(2),third=await claim(3);assert.equal((await step(second.job.id)).status,'claimed');assert.equal((await step(third.job.id)).status,'busy');
 await db.query("UPDATE design_extract_jobs SET last_polled_at=now()-interval '10 minutes' WHERE id=$1",[first.job.id]);
 assert.equal((await db.query('SELECT requeue_stale_design_extract($1)AS changed',[first.job.id])).rows[0].changed,false);
 await db.query("UPDATE design_extract_jobs SET processing_lease_until=now()-interval '1 minute' WHERE id=$1",[first.job.id]);
 assert.equal((await db.query('SELECT requeue_stale_design_extract($1)AS changed',[first.job.id])).rows[0].changed,true);
 assert.equal((await step(first.job.id,1)).status,'obsolete');assert.equal((await step(first.job.id,2,'replacement-run')).status,'claimed');
 const replaced=(await db.query('SELECT generation,state,lease_token FROM design_extract_outbox WHERE job_id=$1',[first.job.id])).rows[0];assert.equal(replaced.generation,2);assert.equal(replaced.state,'pending');assert.equal(replaced.lease_token,null);
 const local=await claim(4,'local');assert.equal(local.status,'charged');assert.equal(local.job.processor,'local');
 assert.equal((await claim(4,'local')).status,'existing');
 assert.equal((await db.query('SELECT credits FROM profiles WHERE id=$1',[owner])).rows[0].credits,12);
 assert.equal((await db.query('SELECT job_id FROM design_extract_outbox WHERE job_id=$1',[local.job.id])).rows.length,0);
 assert.equal((await step(local.job.id)).status,'obsolete');
 for(const status of ['submitting','queued','processing','saving','ready']){
  await db.query('UPDATE design_extract_jobs SET status=$2 WHERE id=$1',[local.job.id,status]);
  const hosted=await db.query("SELECT id FROM design_extract_jobs WHERE id=$1 AND processor IN ('legacy','workflow')",[local.job.id]);
  assert.equal(hosted.rows.length,0);
 }
 for(const fn of ['public.claim_design_extract_v2(uuid,uuid,integer,text,text,text,text,jsonb,text)','public.claim_design_extract_outbox(uuid,integer)','public.claim_design_extract_step(uuid,integer,text)','public.requeue_stale_design_extract(uuid)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE')AS allowed",[role,fn])).rows[0].allowed,role==='service_role');
 for (const count of [0, 1, 2, 3]) {
  const project = '30000000-0000-4000-8000-00000000000' + count;
  await db.query("INSERT INTO design_extract_projects(id,user_id,source_url,manifest) VALUES ($1,$2,'https://test.invalid','{}')",[project,owner]);
  const reserve = async () => (await db.query("SELECT claim_design_extract_v2($1,$2,0,'refine-batch','refine',NULL,'google/nano-banana-2.1/edit','{}','local') AS result", [owner,project])).rows[0].result;
  const reservation = await reserve();
  assert.equal(reservation.status, 'charged');
  assert.equal(reservation.job.processor, 'local');
  assert.equal(reservation.job.charge_amount, 2);
  assert.equal((await reserve()).status, 'existing');
  assert.equal((await db.query('SELECT * FROM design_extract_outbox WHERE job_id=$1',[reservation.job.id])).rows.length,0);
  const preview = {layers:Array.from({length:count},(_,id)=>({id}))};
  await db.query('UPDATE design_extract_jobs SET status=$2,result=$3::jsonb WHERE id=$1',[reservation.job.id,count ? 'ready' : 'failed',JSON.stringify(preview)]);
  const settle = async () => (await db.query('SELECT settle_design_extract_billing($1,$2) AS result',[owner,reservation.job.id])).rows[0].result.status;
  const expected = count === 3 ? 'settled' : 'refunded';
  assert.equal(await settle(), expected);
  assert.equal(await settle(), expected);
 }
 assert.equal((await db.query('SELECT credits FROM profiles WHERE id=$1',[owner])).rows[0].credits,10);
 console.log('Processing SQL verified, including 2-Claw refinement claims, isolation, and exact-once refunds for 0–2 previews.');
}catch(error){console.error('Processing SQL failed',{message:error.message,code:error.code});process.exitCode=1;}finally{await db.close();}
