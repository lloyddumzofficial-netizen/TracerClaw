import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const m=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),update:vi.fn(),send:vi.fn(),fetch:vi.fn(),upload:vi.fn(),submit:vi.fn(),status:vi.fn(),result:vi.fn()}));
vi.mock("@/lib/supabase",()=>({adminSupabase:{rpc:m.rpc,from:m.from}}));
vi.mock("@/lib/cloudflare",()=>({uploadToR2:m.upload,s3Client:{send:m.send},bucketName:"test"}));
vi.mock("@/lib/ssrf",()=>({DEFAULT_MAX_IMAGE_BYTES:15000000,fetchWithSSRFProtection:m.fetch,getAllowedProviderHosts:()=>["provider.test"],getAllowedStorageHosts:()=>["storage.test"],isOwnedStorageUrl:()=>true}));
vi.mock("@fal-ai/client",()=>({fal:{queue:{submit:m.submit,status:m.status,result:m.result}}}));
vi.mock("@/lib/logger",()=>({logger:{error:vi.fn()}}));
import { startEdit,settleEdit } from "@/server/artworkEdits/service";
import { editContext } from "@/server/artworkEdits/context";
import { buildEditMasks, sourcePixels } from "@/server/artworkEdits/images";
const project={id:"p1",user_id:"u1",trace_type:"standard",artwork_revision:1,generated_image_url:"https://storage.test/flat.png",created_at:new Date().toISOString()};
const edit={id:"e1",project_id:"p1",user_id:"u1",status:"processing",created_at:new Date().toISOString(),provider_request_id:"provider-1"};
const instructions=[{prompt:"Remove the text",shapes:[{kind:"rect",x:.2,y:.2,width:.3,height:.2}]}];
beforeEach(async()=>{
  vi.clearAllMocks();vi.stubEnv("FAL_KEY","test");
  m.send.mockRejectedValue(Object.assign(new Error("missing"),{name:"NoSuchKey"}));
  m.fetch.mockResolvedValue({buffer:await sharp({create:{width:100,height:100,channels:3,background:"blue"}}).png().toBuffer()});
  m.upload.mockResolvedValue("https://storage.test/reference.png");m.submit.mockResolvedValue({request_id:"provider-1"});
  m.rpc.mockResolvedValue({data:{edit,claimed:true}});
  const query={update:m.update,eq:()=>query,select:()=>query,single:async()=>({data:edit}),maybeSingle:async()=>({data:project}),then:resolve=>resolve({data:edit})};
  m.update.mockReturnValue(query);
  m.from.mockReturnValue(query);
});
it("one replayed batch sends one provider request, with a distinct editing prompt",async()=>{
  await startEdit(project,{id:"u1"},{requestKey:"request-1234567890",sourceRevision:1,instructions});
  m.rpc.mockResolvedValue({data:{edit,claimed:false}});
  await startEdit(project,{id:"u1"},{requestKey:"request-1234567890",sourceRevision:1,instructions});
  expect(m.submit).toHaveBeenCalledTimes(1);
  expect(m.submit.mock.calls[0][1].input).toMatchObject({resolution:"1K",num_images:1,prompt:expect.stringContaining("Remove the text")});
  expect(m.upload.mock.calls.map(call=>call[1])).toContain("projects/p1/artwork-edits/e1/context-v1.json");
  const manifest=m.upload.mock.calls.find(call=>call[1].endsWith("context-v1.json"));
  expect(JSON.parse(manifest[0].toString()).reviewBoundary).toBe(true);
  expect(JSON.parse(manifest[0].toString()).referenceFormat).toBe("color-overlay-v2");
});
it("rejects overlapping masks before calling the charge RPC",async()=>{
  await expect(startEdit(project,{id:"u1"},{requestKey:"request-1234567890",sourceRevision:1,instructions:[...instructions,...instructions]})).rejects.toThrow("overlap");
  expect(m.rpc).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();
});
it("refunds input preparation failure without submitting a provider request",async()=>{
  m.upload.mockRejectedValue(new Error("Storage unavailable"));
  await startEdit(project,{id:"u1"},{requestKey:"request-1234567890",sourceRevision:1,instructions});
  expect(m.submit).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_error:"SUBMISSION_FAILED",p_result:null}));
});
it("retains in-progress jobs and transient outages without refunds",async()=>{
  m.status.mockResolvedValue({status:"IN_QUEUE"});expect(await settleEdit(edit)).toBe(edit);
  m.status.mockRejectedValue(Object.assign(new Error("outage"),{status:503}));expect(await settleEdit(edit)).toBe(edit);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("refunds a completed job carrying fal's TOP_UP error instead of polling forever",async()=>{
  m.status.mockResolvedValue({status:"COMPLETED"});
  m.result.mockRejectedValue(Object.assign(new Error("Forbidden"),{status:403,body:{detail:"User is locked. Reason: TOP_UP."}}));
  m.rpc.mockResolvedValue({data:{...edit,status:"refunded",error_code:"PROVIDER_BALANCE"}});
  const settled=await settleEdit(edit);
  expect(settled.status).toBe("refunded");
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_result:null,p_error:"PROVIDER_BALANCE"}));
  expect(m.upload).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();
  m.rpc.mockClear();await settleEdit(settled);expect(m.rpc).not.toHaveBeenCalled();
});
it("does not refund unknown polling/auth errors or unrelated forbidden results",async()=>{
  const locked=Object.assign(new Error("Forbidden"),{status:403,body:{detail:"User is locked. Reason: TOP_UP."}});
  m.status.mockRejectedValue(locked);await settleEdit(edit);
  expect(m.result).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
  m.status.mockResolvedValue({status:"COMPLETED"});
  m.result.mockRejectedValue(Object.assign(new Error("Forbidden"),{status:403,body:{detail:"Access denied"}}));
  await settleEdit(edit);expect(m.rpc).not.toHaveBeenCalled();
});
it("recovers an already-uploaded preview before retrying fal",async()=>{
  m.send.mockResolvedValue({Body:{destroy:vi.fn()}});m.rpc.mockResolvedValue({data:{...edit,status:"ready"}});
  expect((await settleEdit(edit)).status).toBe("ready");expect(m.status).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_edit:"e1",p_result:expect.stringContaining("preview.png")}));
});
it("refunds terminal failure, not an uncertain fresh submission",async()=>{
  m.status.mockResolvedValue({status:"FAILED"});await settleEdit(edit);
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_error:"PROVIDER_FAILED",p_result:null}));
  m.rpc.mockClear();await settleEdit({...edit,provider_request_id:null});expect(m.rpc).not.toHaveBeenCalled();
});
it("refunds a focused result that spills outside the mask without storing a clipped preview",async()=>{
  const source=await sourcePixels((await m.fetch()).buffer);
  const {union}=await buildEditMasks(instructions,source.width,source.height);
  const context={...editContext(source,union),fingerprint:"test-fingerprint"};
  m.send.mockRejectedValueOnce(Object.assign(new Error("missing"),{name:"NoSuchKey"}));
  m.send.mockResolvedValueOnce({Body:{transformToString:async()=>JSON.stringify(context)}});
  m.status.mockResolvedValue({status:"COMPLETED"});m.result.mockResolvedValue({data:{images:[{url:"https://provider.test/result.png"}]}});
  m.fetch.mockResolvedValueOnce({buffer:await sharp({create:{width:100,height:100,channels:3,background:"red"}}).png().toBuffer()});
  await settleEdit({...edit,instructions,source_url:project.generated_image_url,fingerprint:"test-fingerprint"});
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_result:null,p_error:"EDIT_OUTSIDE_SELECTION"}));
  expect(m.upload).not.toHaveBeenCalled();
});
it("continues settling full-frame jobs submitted before focused context existed",async()=>{
  m.status.mockResolvedValue({status:"COMPLETED"});m.result.mockResolvedValue({data:{images:[{url:"https://provider.test/result.png"}]}});
  await settleEdit({...edit,instructions,source_url:project.generated_image_url});
  expect(m.upload).toHaveBeenCalledWith(expect.any(Buffer),expect.stringContaining("preview.png"),"image/png");
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_error:null,p_result:expect.any(String)}));
});

it("saves a new-policy preview with a durable review warning instead of refunding context changes",async()=>{
  const source=await sourcePixels((await m.fetch()).buffer);
  const {union}=await buildEditMasks(instructions,source.width,source.height);
  const context={...editContext(source,union),reviewBoundary:true,fingerprint:"test-fingerprint"};
  m.send.mockRejectedValueOnce(Object.assign(new Error("missing"),{name:"NoSuchKey"}));
  m.send.mockResolvedValueOnce({Body:{transformToString:async()=>JSON.stringify(context)}});
  m.status.mockResolvedValue({status:"COMPLETED"});m.result.mockResolvedValue({data:{images:[{url:"https://provider.test/result.png"}]}});
  m.fetch.mockResolvedValueOnce({buffer:await sharp({create:{width:100,height:100,channels:3,background:"red"}}).png().toBuffer()});
  m.rpc.mockResolvedValue({data:{...edit,status:"ready",error_code:"EDIT_BOUNDARY_REVIEW",result_url:"https://storage.test/preview.png"}});
  const settled=await settleEdit({...edit,instructions,source_url:project.generated_image_url,fingerprint:"test-fingerprint"});
  expect(settled).toMatchObject({status:"ready",error_code:"EDIT_BOUNDARY_REVIEW"});
  expect(m.update).toHaveBeenCalledWith({error_code:"EDIT_BOUNDARY_REVIEW"});
  expect(m.update.mock.invocationCallOrder[0]).toBeLessThan(m.upload.mock.invocationCallOrder[0]);
  expect(m.rpc).toHaveBeenCalledWith("settle_artwork_edit",expect.objectContaining({p_error:null,p_result:expect.any(String)}));
  expect(m.submit).not.toHaveBeenCalled();
});

it("recovers a stored preview without losing its previously persisted warning or submitting again",async()=>{
  const warned={...edit,error_code:"EDIT_BOUNDARY_REVIEW"};
  m.send.mockResolvedValue({Body:{destroy:vi.fn()}});
  m.rpc.mockResolvedValue({data:{...warned,status:"ready",result_url:"https://storage.test/preview.png"}});
  expect(await settleEdit(warned)).toMatchObject({status:"ready",error_code:"EDIT_BOUNDARY_REVIEW"});
  expect(m.status).not.toHaveBeenCalled();expect(m.result).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();
});

it("does not upload a warning preview if persisting its warning fails",async()=>{
  const source=await sourcePixels((await m.fetch()).buffer);
  const {union}=await buildEditMasks(instructions,source.width,source.height);
  const context={...editContext(source,union),reviewBoundary:true,fingerprint:"test-fingerprint"};
  m.send.mockRejectedValueOnce(Object.assign(new Error("missing"),{name:"NoSuchKey"}));
  m.send.mockResolvedValueOnce({Body:{transformToString:async()=>JSON.stringify(context)}});
  m.status.mockResolvedValue({status:"COMPLETED"});m.result.mockResolvedValue({data:{images:[{url:"https://provider.test/result.png"}]}});
  m.fetch.mockResolvedValueOnce({buffer:await sharp({create:{width:100,height:100,channels:3,background:"red"}}).png().toBuffer()});
  m.update.mockReturnValueOnce({eq:()=>({eq:async()=>({error:new Error("Database unavailable")})})});
  const pending={...edit,instructions,source_url:project.generated_image_url,fingerprint:"test-fingerprint"};
  expect(await settleEdit(pending)).toBe(pending);
  expect(m.upload).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});
