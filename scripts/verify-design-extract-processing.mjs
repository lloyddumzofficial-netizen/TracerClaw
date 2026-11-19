import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import path from 'node:path';
const {PGlite}=await (process.env.PGLITE_TEST_MODULE?import(pathToFileURL(path.resolve(process.env.PGLITE_TEST_MODULE)).href):import('@electric-sql/pglite'));const db=new PGlite();
try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE profiles(id uuid PRIMARY KEY,credits integer NOT NULL); CREATE TABLE credit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles(id),action text,amount integer);');
 for(const file of ['038_design_extract.sql','039_design_extract_billing.sql','040_design_extract_processing.sql'])await db.exec(await readFile('database/migrations/'+file,'utf8'));
 const owner='10000000-0000-4000-8000-000000000001';await db.query('INSERT INTO profiles VALUES($1,20)',[owner]);
 const claim=async n=>{const project=`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;await db.query("INSERT INTO design_extract_projects(id,user_id,source_url,manifest)VALUES($1,$2,'https://test.invalid','{}')ON CONFLICT DO NOTHING",[project,owner]);return(await db.query("SELECT claim_design_extract_v2($1,$2,0,$3,'extract',NULL,'fal-ai/qwen-image-layered','{}','workflow')AS result",[owner,project,'processing-'+n])).rows[0].result;};
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
 for(const fn of ['public.claim_design_extract_v2(uuid,uuid,integer,text,text,text,text,jsonb,text)','public.claim_design_extract_outbox(uuid,integer)','public.claim_design_extract_step(uuid,integer,text)','public.requeue_stale_design_extract(uuid)'])for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE')AS allowed",[role,fn])).rows[0].allowed,role==='service_role');
 console.log('Processing SQL verified: atomic job/outbox reservation, duplicate claims, leased delivery, per-user concurrency, stale-run fencing, replacement generation and service-only privileges.');
}catch(error){console.error('Processing SQL failed',{message:error.message,code:error.code});process.exitCode=1;}finally{await db.close();}
