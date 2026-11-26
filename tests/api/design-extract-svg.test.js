import { beforeEach, afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const mocks = vi.hoisted(() => ({ user: vi.fn(), owned: vi.fn(), read: vi.fn(), upload: vi.fn(), privateRead: vi.fn(), provider: vi.fn(), fetch: vi.fn(), limit: vi.fn(),from:vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { auth: { getUser: mocks.user },from:mocks.from, rpc: mocks.rpc } }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: mocks.limit }));
vi.mock("@/server/designExtract/service", () => ({ ownedProject: mocks.owned, readAsset: mocks.read, prefix: p => `users/${p.user_id}/design-extract/${p.id}/`, fail: (message,status=400) => { throw Object.assign(new Error(message),{status,designExtractError:true}); } }));
vi.mock("@/server/designExtract/storage", () => ({ serializeDesignData:async x=>x, ownsPrivateDesignAsset: (url,user) => url.startsWith(`r2-private://design-extract/users/${user}/`), uploadDesignAsset: mocks.upload, readPrivateDesignAsset: mocks.privateRead, designAssetUrl: async () => "https://signed.test/input.png" }));
vi.mock("@/lib/ssrf", () => ({ DEFAULT_MAX_SVG_BYTES: 8*1024*1024, getAllowedProviderHosts: () => ["img.recraft.ai"], fetchWithSSRFProtection: mocks.provider }));
import { POST } from "@/app/api/design-extract/[id]/svg/route";
import { convertDesignLayer, checkedVectorSvg } from "@/server/designExtract/vectorize";
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><path d="M0 0h100v100z" fill="#f00"/></svg>');
let files, project;
const request=body=>POST(new Request("http://localhost/api/design-extract/p/svg",{method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({id:"p"})});
beforeEach(async()=>{
  vi.resetAllMocks();vi.stubGlobal("fetch",mocks.fetch);vi.stubEnv("RECRAFT_API_KEY","private-test-key");vi.stubEnv("ADMIN_EMAIL","admin@test.com");vi.stubEnv("DESIGN_EXTRACT_ENABLED","true");
  vi.stubEnv("VERCEL_ENV", "");
  mocks.rpc.mockResolvedValue({ data: { status: "legacy" } });
  files=new Map();project={id:"p",user_id:"u",manifest:{layers:[{id:"l",url:"r2-private://design-extract/users/u/design-extract/p/l.png"}]}};
  mocks.user.mockResolvedValue({data:{user:{id:"u",email:"admin@test.com"}}});mocks.owned.mockImplementation(async()=>structuredClone(project));
  mocks.limit.mockResolvedValue({success:true});
  mocks.read.mockResolvedValue(await sharp({create:{width:640,height:800,channels:4,background:{r:240,g:10,b:50,alpha:.5}}}).png().toBuffer());
  mocks.privateRead.mockImplementation(async url=>{const key=url.replace('r2-private://design-extract/','');if(!files.has(key))throw Object.assign(new Error('missing'),{name:'NoSuchKey'});return files.get(key);});
  mocks.upload.mockImplementation(async(bytes,key,_type,options)=>{if(options?.ifAbsent&&files.has(key))throw Object.assign(new Error('exists'),{name:'PreconditionFailed'});files.set(key,bytes);return 'r2-private://design-extract/'+key;});
  mocks.fetch.mockImplementation(async()=>new Response(JSON.stringify({image:{url:"https://img.recraft.ai/output.svg"}}),{status:200}));
  mocks.provider.mockResolvedValue({buffer:svg});
  mocks.from.mockImplementation(table=>{let update;const q={select:()=>q,eq:()=>q,in:()=>q,limit:()=>q,update:value=>{update=value;return q;},maybeSingle:async()=>{project={...project,...update};return {data:structuredClone(project)};},then:resolve=>Promise.resolve({data:table==='design_extract_jobs'?[]:project}).then(resolve)};return q;});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("converts only the owned layer through direct Recraft, saves privately and reuses downloads",async()=>{
  const first=await request({layerId:'l',imageUrl:'https://attacker.test/not-used'});
  expect(first.status).toBe(200);expect(first.headers.get('content-disposition')).toContain('attachment');expect(first.headers.get('content-security-policy')).toContain('sandbox');expect(await first.text()).toContain('<path');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);const [url,options]=mocks.fetch.mock.calls[0];
  expect(url).toBe('https://external.api.recraft.ai/v1/images/vectorize');expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe('Bearer private-test-key');expect(JSON.parse(options.body)).toEqual({image_url:'https://signed.test/input.png',version:'v1',response_format:'url'});
  expect(mocks.read).toHaveBeenCalledWith(project.manifest.layers[0].url);
  expect((await request({layerId:'l'})).status).toBe(200);expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect([...files.keys()].every(key=>key.startsWith('users/u/design-extract/p/svg/'))).toBe(true);
});
it("claims once across simultaneous conversions",async()=>{
  const results=await Promise.allSettled([convertDesignLayer(project,'l'),convertDesignLayer(project,'l')]);
  expect(results.some(result=>result.status==='fulfilled')).toBe(true);expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("confirms the finishing price, refunds a rejected conversion, and settles a saved SVG once", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
  vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", "true"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
  project.revision = 0;
  mocks.rpc.mockResolvedValueOnce({ data: { status: "offer" } });
  const offer = await request({ layerId: "l" });
  expect(offer.status).toBe(409);
  expect(await offer.json()).toMatchObject({ code: "DESIGN_FINISH_UNLOCK_REQUIRED" });
  expect(mocks.fetch).not.toHaveBeenCalled();

  mocks.rpc.mockResolvedValueOnce({ data: { status: "claimed", id: "try-1" } }).mockResolvedValueOnce({});
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 422 }));
  expect((await request({ layerId: "l", acknowledgedClaws: 1 })).status).toBe(502);
  expect(mocks.rpc).toHaveBeenLastCalledWith("settle_design_extract_finish", { target_user: "u", target_action: "try-1", usable: false });

  mocks.rpc.mockResolvedValueOnce({}).mockResolvedValueOnce({ data: { status: "claimed", id: "try-2" } }).mockResolvedValue({});
  expect((await request({ layerId: "l", acknowledgedClaws: 1 })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith("settle_design_extract_finish", { target_user: "u", target_action: "try-2", usable: true });
  expect((await request({ layerId: "l" })).status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "claim_design_extract_finish")).toHaveLength(3);
});
it("resumes a saved provider result after a download outage without another provider POST",async()=>{
  mocks.provider.mockRejectedValueOnce(new Error('temporary download outage'));
  await expect(convertDesignLayer(project,'l')).rejects.toThrow('outage');
  expect(await convertDesignLayer(project,'l')).toEqual(svg);expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("never repeats an ambiguous paid submission",async()=>{
  mocks.fetch.mockRejectedValueOnce(new Error('lost response with private-token'));
  const response=await request({layerId:'l'});expect(response.status).toBe(502);expect(await response.text()).not.toContain('private-token');
  expect((await request({layerId:'l'})).status).toBe(409);expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("invalidates the cached SVG after a new accepted mask or artwork version",async()=>{
  await convertDesignLayer(project,'l');project.manifest.layers[0].url='r2-private://design-extract/users/u/design-extract/p/new-mask.png';await convertDesignLayer(project,'l');expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it.each([null,'foreign'])('rejects an unowned or missing layer %s',async layer=>{
  if(layer==='foreign')project.manifest.layers[0].url='r2-private://design-extract/users/other/l.png';
  expect((await request({layerId:layer==='foreign'?'l':'missing'})).status).toBe(404);expect(mocks.fetch).not.toHaveBeenCalled();
});
it('checks project ownership before converting a layer for a regular account',async()=>{
  vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE','paid');
  mocks.user.mockResolvedValue({data:{user:{id:'x',email:'other@test.com'}}});
  mocks.owned.mockRejectedValueOnce(Object.assign(new Error('Project not found'),{status:404,designExtractError:true}));
  expect((await request({layerId:'l'})).status).toBe(404);
  expect(mocks.owned).toHaveBeenCalledWith('p','x');
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('respects provider rate limits without claiming or paying',async()=>{mocks.limit.mockImplementation(async({namespace})=>({success:namespace!=='design-extract:svg'}));expect((await request({layerId:'l'})).status).toBe(429);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();});
it('requires the one-Claw offer on production with the local pilot disabled',async()=>{
  vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE','paid');
  vi.stubEnv('DESIGN_EXTRACT_QUALITY_PILOT','false');
  vi.stubEnv('UPSTASH_REDIS_REST_URL','https://redis.test');vi.stubEnv('UPSTASH_REDIS_REST_TOKEN','test');
  mocks.rpc.mockResolvedValueOnce({data:{status:'offer'}});
  const response=await request({layerId:'l'});
  expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'DESIGN_FINISH_UNLOCK_REQUIRED'});
  expect(mocks.fetch).not.toHaveBeenCalled();
  const legacy = await request({layerId:'l',acknowledgedClaws:1});
  expect(legacy.status).toBe(409);expect(await legacy.json()).toMatchObject({error:expect.stringContaining('outside a finishing bundle')});
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('requires provider configuration',async()=>{vi.stubEnv('RECRAFT_API_KEY','');expect((await request({layerId:'l'})).status).toBe(503);expect(mocks.fetch).not.toHaveBeenCalled();});
it('accepts the SVG returned by the live synthetic Recraft qualification',async()=>{const actual=await readFile(new URL('../fixtures/recraft-layer-vector.svg',import.meta.url));expect(checkedVectorSvg(actual).toString()).toContain('<path');});
it('does not repeat an unconfirmed paid conversion after refresh',async()=>{mocks.fetch.mockRejectedValueOnce(new Error('network interrupted'));await expect(convertDesignLayer(project,'l')).rejects.toMatchObject({status:502});await expect(convertDesignLayer(project,'l')).rejects.toMatchObject({status:409});expect(mocks.fetch).toHaveBeenCalledTimes(1);});
it.each(['<script>alert(1)</script>','<foreignObject/>','<image href="https://attacker.test/x"/>','<path onload="alert(1)"/>','<path style="fill:url(https://attacker.test/x)"/>'])('rejects active or external SVG: %s',content=>{expect(()=>checkedVectorSvg(Buffer.from(`<svg>${content}</svg>`))).toThrow('unsupported');});
it('pads tiny cutouts with transparency before sending them',async()=>{
  mocks.read.mockResolvedValue(await sharp({create:{width:30,height:40,channels:4,background:{r:200,g:100,b:20,alpha:1}}}).png().toBuffer());await convertDesignLayer(project,'l');
  const input=mocks.upload.mock.calls.find(([,key])=>key.endsWith('.png'))[0];const {data,info}=await sharp(input).raw().toBuffer({resolveWithObject:true});expect(info).toMatchObject({width:256,height:256,channels:4});expect(data[data.length-1]).toBe(0);
});
it('inserts a persistent typed SVG once, preserves placement and changes only composition visibility',async()=>{
 project.revision=0;Object.assign(project.manifest.layers[0],{name:'Logo',width:640,height:800,visible:true,composition:{x:12,y:18,scale:.7},layout:{x:300,y:0,scale:.4}});
 const response=await request({layerId:'l',attach:true,revision:0});expect(response.status).toBe(200);const data=await response.json();
 expect(data.project.manifest.version).toBe(2);expect(data.project.manifest.layers).toHaveLength(2);
 expect(data.project.manifest.layers[0].visibility).toEqual({overview:true,composition:false});
 const vector=data.project.manifest.layers[1];expect(vector).toMatchObject({kind:'svg',name:'Logo · SVG',composition:{x:12,y:18,scale:.7},visibility:{overview:true,composition:true}});expect(vector.vector.pathCount).toBe(1);
 expect((await request({layerId:'l',attach:true,revision:project.revision})).status).toBe(200);expect(project.manifest.layers).toHaveLength(2);expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("inserts the saved gradient SVG and retains the original colors for PSD", async () => {
  project.revision = 0;
  Object.assign(project.manifest.layers[0], { name: "Logo", width: 640, height: 800, composition: { x: 12, y: 18, scale: .7 }, layout: { x: 300, y: 0, scale: .4 } });
  const gradient = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><defs><linearGradient id="ink"><stop stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="640" height="800" fill="url(#ink)"/></svg>');
  mocks.provider.mockResolvedValue({ buffer: gradient });
  expect((await request({ layerId: "l" })).status).toBe(200);
  const response = await request({ layerId: "l", attach: true, revision: 0 });
  expect(response.status).toBe(200);
  const { project: saved } = await response.json();
  const added = saved.manifest.layers[1];
  expect(added).toMatchObject({ kind: "svg", vector: { psdMode: "raster" }, composition: { x: 12, y: 18, scale: .7 } });
  expect(files.get(added.url.replace("r2-private://design-extract/", ""))).toEqual(gradient);
  const pixels = await sharp(files.get(added.previewUrl.replace("r2-private://design-extract/", ""))).raw().toBuffer();
  expect(pixels.equals(await sharp(gradient).ensureAlpha().raw().toBuffer())).toBe(true);
  expect(pixels[0]).toBeGreaterThan(pixels[2]);
  expect(pixels[639 * 4 + 2]).toBeGreaterThan(pixels[639 * 4]);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it('checks the 32-layer limit before issuing a conversion',async()=>{project.revision=0;project.manifest.layers=Array.from({length:32},(_,i)=>({...project.manifest.layers[0],id:i===0?'l':`l${i}`}));expect((await request({layerId:'l',attach:true,revision:0})).status).toBe(409);expect(mocks.fetch).not.toHaveBeenCalled();});

it('sanitizes asynchronous SVG response serialization errors inside the route boundary',async()=>{
 project.revision=0;Object.assign(project.manifest.layers[0],{width:640,height:800,name:'Logo',composition:{x:0,y:0,scale:1},layout:{x:300,y:0,scale:1}});
 const serializer=vi.spyOn(await import('@/server/designExtract/storage'),'serializeDesignData').mockRejectedValueOnce(new Error('private signed asset URL'));
 const response=await request({layerId:'l',attach:true,revision:0});
 expect(response.status).toBe(500);expect(await response.text()).not.toContain('private signed');
 serializer.mockRestore();
});
