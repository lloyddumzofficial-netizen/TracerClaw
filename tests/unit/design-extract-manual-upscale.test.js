import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import sharp from 'sharp';
const m=vi.hoisted(()=>({from:vi.fn(),owned:vi.fn(),read:vi.fn(),upload:vi.fn(),privateRead:vi.fn(),submit:vi.fn(),limit:vi.fn()}));
vi.mock('@/lib/supabase',()=>({adminSupabase:{from:m.from}}));
vi.mock('@/lib/rateLimit',()=>({enforceRateLimit:m.limit}));
vi.mock('@/server/designExtract/service',()=>({ownedProject:m.owned,readAsset:m.read,prefix:p=>`users/${p.user_id}/design-extract/${p.id}/`,fail:(message,status=400)=>{throw Object.assign(Error(message),{status,designExtractError:true});}}));
vi.mock('@/server/designExtract/storage',()=>({ownsPrivateDesignAsset:(url,user)=>url.startsWith(`r2-private://design-extract/users/${user}/`),uploadDesignAsset:m.upload,readPrivateDesignAsset:m.privateRead,designAssetUrl:async()=> 'https://signed.test/input.png'}));
vi.mock('@/server/designExtract/enhancementProvider',()=>({ENHANCE_MODEL:'recraft/crisp-upscale',TOPAZ_ENHANCE_MODEL:'topaz/upscale/image/transparent',LEGACY_ENHANCE_MODEL:'fal-ai/esrgan',submitEnhancement:m.submit}));
import {upscaleDesignLayer} from '@/server/designExtract/upscaleLayer';
let project,files;
beforeEach(async()=>{
 vi.resetAllMocks();vi.stubEnv('RECRAFT_API_KEY','test');files=new Map();
 project={id:'p',user_id:'u',revision:0,manifest:{layers:[{id:'l',url:'r2-private://design-extract/users/u/design-extract/p/source.png',width:32,height:32,name:'Image',visible:true,composition:{x:10,y:20,scale:2},layout:{x:300,y:0,scale:3}}]}};
 const source=await sharp({create:{width:32,height:32,channels:4,background:{r:20,g:40,b:60,alpha:.5}}}).png().toBuffer();
 const output=await sharp({create:{width:128,height:128,channels:3,background:{r:30,g:50,b:70}}}).png().toBuffer();
 m.read.mockImplementation(async(_url,provider)=>provider?output:source);m.owned.mockImplementation(async()=>structuredClone(project));m.limit.mockResolvedValue({success:true});m.submit.mockResolvedValue({image_url:'https://img.recraft.ai/result.png',units:4});
 m.privateRead.mockImplementation(async url=>{const key=url.replace('r2-private://design-extract/','');if(!files.has(key))throw Object.assign(Error('missing'),{name:'NoSuchKey'});return files.get(key);});
 m.upload.mockImplementation(async(bytes,key,_type,options)=>{if(options?.ifAbsent&&files.has(key))throw Object.assign(Error('exists'),{name:'PreconditionFailed'});files.set(key,bytes);return 'r2-private://design-extract/'+key;});
 m.from.mockImplementation(table=>{let update;const q={select:()=>q,eq:()=>q,in:()=>q,limit:()=>q,update:value=>{update=value;return q;},maybeSingle:async()=>{project={...project,...update};return {data:structuredClone(project)};},then:resolve=>Promise.resolve({data:table==='design_extract_jobs'?[]:project}).then(resolve)};return q;});
});
afterEach(()=>vi.unstubAllEnvs());
it('upscales once and preserves transparency, placement, and the base version',async()=>{
 const result=await upscaleDesignLayer(project,'l',0),layer=result.project.manifest.layers[0];expect(layer).toMatchObject({width:128,height:128,composition:{x:10,y:20,scale:.5},layout:{x:300,y:0,scale:.75},upscale:{state:'done'}});expect(layer.baseVariant.url).toContain('source.png');
 const png=files.get([...files.keys()].find(key=>key.endsWith('.png')&&!key.endsWith('-input.png')));expect((await sharp(png).metadata()).hasAlpha).toBe(true);
 await expect(upscaleDesignLayer(project,'l',1)).rejects.toThrow('already upscaled');expect(m.submit).toHaveBeenCalledTimes(1);
});
it.each(['enhancement','enhancedVariant','upscale'])('blocks an existing %s enhancement before any provider submission',async field=>{
 project.manifest.layers[0][field]=field==='upscale'?{state:'done'}:{model:'existing'};await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('already upscaled');expect(m.submit).not.toHaveBeenCalled();
});
it('prevents concurrent double submissions',async()=>{const snapshot=structuredClone(project);await Promise.allSettled([upscaleDesignLayer(snapshot,'l',0),upscaleDesignLayer(snapshot,'l',0)]);expect(m.submit).toHaveBeenCalledTimes(1);});
it('preserves a known output across storage failure and never regenerates',async()=>{
 const upload=m.upload.getMockImplementation();let failed=false;m.upload.mockImplementation(async(bytes,key,...args)=>{if(key.endsWith('.png')&&!key.endsWith('-input.png')&&!failed){failed=true;throw Error('storage outage');}return upload(bytes,key,...args);});
 await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('storage outage');await upscaleDesignLayer(project,'l',0);expect(m.submit).toHaveBeenCalledTimes(1);
});
it('applies a recorded Recraft result with rounded dimensions to an opaque refinement option', async () => {
 const layer = project.manifest.layers[0];
 Object.assign(layer, { width: 106, height: 157, nativeFrame: { width: 106, height: 157, left: 0, top: 0 } });
 const source = await sharp({ create: { width: 106, height: 157, channels: 3, background: "#1B3C4D" } }).png().toBuffer();
 const output = await sharp({ create: { width: 346, height: 512, channels: 3, background: "#1B3C4D" } }).png().toBuffer();
 m.read.mockImplementation(async (_url, provider) => provider ? output : source);
 m.privateRead.mockResolvedValueOnce(Buffer.from(JSON.stringify({ state: "generated", sourceUrl: layer.url, outputUrl: "https://img.recraft.ai/saved.png", model: "recraft/crisp-upscale", plan: { scale: 4, width: 424, height: 628 } })));
 const result = await upscaleDesignLayer(project, layer.id, 0);
 expect(result.project.manifest.layers[0]).toMatchObject({ width: 346, height: 512, nativeFrame: { width: 346, height: 512, left: 0, top: 0 } });
 expect(m.submit).not.toHaveBeenCalled();
});
it('does not repeat an ambiguous provider request',async()=>{m.submit.mockRejectedValue(Error('secret upstream error'));await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('could not be confirmed');await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('already requested');expect(m.submit).toHaveBeenCalledTimes(1);});
it('rejects SVG, locked layers, unsafe dimensions and stale revisions',async()=>{
 project.manifest.layers[0].kind='svg';await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('raster');delete project.manifest.layers[0].kind;
 project.manifest.layers[0].locked=true;await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('Unlock');project.manifest.layers[0].locked=false;
 await expect(upscaleDesignLayer(project,'l',9)).rejects.toThrow('changed');project.manifest.layers[0].width=4000;project.manifest.layers[0].height=4000;await expect(upscaleDesignLayer(project,'l',0)).rejects.toThrow('supported size limits');expect(m.submit).not.toHaveBeenCalled();
});
