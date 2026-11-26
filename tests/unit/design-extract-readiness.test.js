import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { designExtractConfiguration } from '@/lib/designExtractReadiness';
import { fenceDesignJob } from '@/server/designExtract/processing/fence';
const mocks=vi.hoisted(()=>({from:vi.fn()}));
vi.mock('@/lib/supabase',()=>({adminSupabase:{from:mocks.from}}));
import { checkDesignExtractReadiness } from '@/lib/healthChecks';
const env={DESIGN_EXTRACT_ENABLED:'true',DESIGN_EXTRACT_PRIVATE_BUCKET:'private-design',CLOUDFLARE_BUCKET_NAME:'public-design',FAL_KEY:'secret',RECRAFT_API_KEY:'test-recraft',ADMIN_EMAIL:'private@example.invalid'};
const query=(data=[],error=null)=>{const q={};for(const name of ['select','eq','in','lt','or','limit'])q[name]=vi.fn(()=>q);q.then=(resolve,reject)=>Promise.resolve({data,error}).then(resolve,reject);return q;};
beforeEach(()=>{vi.resetAllMocks();for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);vi.stubEnv('DESIGN_EXTRACT_PROCESSOR','legacy');vi.stubEnv('VERCEL_ENV','');vi.stubEnv('VERCEL','');mocks.from.mockImplementation(()=>query());});
afterEach(()=>vi.unstubAllEnvs());
it('does not require private feature configuration or tables while disabled',async()=>{vi.stubEnv('DESIGN_EXTRACT_ENABLED','false');expect(await checkDesignExtractReadiness()).toEqual({ok:true,enabled:false});expect(mocks.from).not.toHaveBeenCalled();});
it.each(['','public-design','Invalid Bucket'])('fails closed for invalid private bucket %s',bucket=>{const result=designExtractConfiguration({...env,DESIGN_EXTRACT_PRIVATE_BUCKET:bucket});expect(result.ok).toBe(false);expect(result.missing).toContain('PRIVATE_STORAGE');expect(JSON.stringify(result)).not.toContain('secret');});
it('requires workflow deployment identification only for the workflow driver on Vercel',()=>{expect(designExtractConfiguration({...env,VERCEL:'1'}).ok).toBe(true);expect(designExtractConfiguration({...env,VERCEL:'1',DESIGN_EXTRACT_PROCESSOR:'workflow'}).missing).toContain('WORKFLOW_DEPLOYMENT');});
it('uses the paid default consistently and reports missing production rate-limit storage',()=>{
 expect(designExtractConfiguration(env).billingMode).toBe('paid');
 expect(designExtractConfiguration({...env,DESIGN_EXTRACT_BILLING_MODE:''}).missing).toContain('BILLING_CONFIGURATION');
 expect(designExtractConfiguration({...env,NODE_ENV:'production'}).missing).toContain('RATE_LIMIT_STORAGE');
 expect(designExtractConfiguration({...env,NODE_ENV:'production',UPSTASH_REDIS_REST_URL:'https://redis.test',UPSTASH_REDIS_REST_TOKEN:'test'}).ok).toBe(true);
});
it('checks billing schema even in free beta without returning private database errors',async()=>{vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE','beta');mocks.from.mockReturnValue(query([], {code:'42703',message:'secret table details'}));const result=await checkDesignExtractReadiness();expect(result).toMatchObject({ok:false,code:'DESIGN_SCHEMA_UNAVAILABLE'});expect(JSON.stringify(result)).not.toContain('secret');});
it('reports overdue terminal settlement',async()=>{
 let jobReads=0;
 mocks.from.mockImplementation(table=>table==='design_extract_jobs' && ++jobReads===2 ? query([{id:'private-job'}]) : query());
 expect(await checkDesignExtractReadiness()).toMatchObject({ok:false,code:'DESIGN_SETTLEMENT_OVERDUE'});
});
it('detects missing finishing schema in paid mode',async()=>{
 vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE','paid');
 mocks.from.mockImplementation(table=>table==='design_extract_finish_actions' ? query([],{code:'PGRST205'}) : query());
 expect(await checkDesignExtractReadiness()).toMatchObject({ok:false,code:'DESIGN_SCHEMA_UNAVAILABLE',table:'design_extract_finish_actions'});
});
it('checks outbox and worker health only when the driver is enabled',async()=>{vi.stubEnv('DESIGN_EXTRACT_PROCESSOR','workflow');expect(await checkDesignExtractReadiness()).toMatchObject({ok:true,schemaVerified:true});expect(mocks.from).toHaveBeenCalledWith('design_extract_outbox');});
it('fences workflow writes by generation, token and unexpired lease',()=>{const q={eq:vi.fn(),gt:vi.fn()};q.eq.mockReturnValue(q);q.gt.mockReturnValue(q);fenceDesignJob(q,{processor:'workflow',processor_generation:2,processing_lease_token:'token'});expect(q.eq).toHaveBeenCalledWith('processor_generation',2);expect(q.eq).toHaveBeenCalledWith('processing_lease_token','token');expect(q.gt).toHaveBeenCalledWith('processing_lease_until',expect.any(String));expect(()=>fenceDesignJob(q,{processor:'workflow'})).toThrow('lease');});
