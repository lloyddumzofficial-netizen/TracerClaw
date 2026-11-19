import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ from:vi.fn(), settle:vi.fn(), review:vi.fn(), owned:vi.fn() }));
vi.mock('@/lib/supabase',()=>({adminSupabase:{from:m.from}}));
vi.mock('@/server/designExtract/service',()=>({settleOperation:m.settle,reviewOperation:m.review,ownedProject:m.owned}));
import { recoverLegacyDesignJobs } from '@/server/designExtract/recovery';
function q(data) { const x={};for(const name of ['select','eq','in','is','order','limit','gt'])x[name]=vi.fn(()=>x);x.maybeSingle=x.single=vi.fn(async()=>({data}));x.then=resolve=>Promise.resolve({data}).then(resolve);return x; }
const project={id:'p',user_id:'u',revision:2}, job={id:'j',project_id:'p',user_id:'u',status:'saving',kind:'extract',base_revision:2,updated_at:'2026-01-01'};
beforeEach(()=>{vi.resetAllMocks();m.from.mockReturnValue(q([]));m.owned.mockResolvedValue(project);});
it('advances an existing legacy job and accepts initial output without an open browser',async()=>{
 m.from.mockReturnValueOnce(q([])).mockReturnValueOnce(q([job])).mockReturnValueOnce(q([])).mockReturnValueOnce(q(project));m.settle.mockResolvedValue({...job,status:'ready'});
 await recoverLegacyDesignJobs();expect(m.settle).toHaveBeenCalledWith(project,job);expect(m.review).toHaveBeenCalledWith(project,job.id,true);
});
it('recovers ready extraction output after interruption but never auto-accepts refinements',async()=>{
 const ready={...job,status:'ready'};m.from.mockReturnValueOnce(q([ready])).mockReturnValueOnce(q(project)).mockReturnValueOnce(q([])).mockReturnValueOnce(q([]));
 await recoverLegacyDesignJobs();expect(m.review).toHaveBeenCalledWith(project,job.id,true);expect(m.settle).not.toHaveBeenCalled();
});
it('does not resurrect removed projects or replay uncertain submissions',async()=>{
 const reserved={...job,status:'submitting'};const claims=q([]);m.from.mockReturnValueOnce(q([])).mockReturnValueOnce(q([])).mockReturnValueOnce(claims);
 await recoverLegacyDesignJobs();expect(claims.is).toHaveBeenCalledWith('dispatch_started_at',null);expect(m.settle).not.toHaveBeenCalled();
 m.from.mockReturnValueOnce(q([])).mockReturnValueOnce(q([reserved])).mockReturnValueOnce(q([])).mockReturnValueOnce(q(null));
 await recoverLegacyDesignJobs();expect(m.settle).not.toHaveBeenCalled();
});
