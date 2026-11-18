import { beforeEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ from: vi.fn(), submit: vi.fn(), status: vi.fn(), result: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { from: mocks.from } }));
vi.mock("@/server/designExtract/enhancementProvider", () => ({ submitEnhancement: mocks.submit }));
vi.mock("@fal-ai/client", () => ({ fal: { queue: { submit: mocks.submit, status: mocks.status, result: mocks.result } } }));
import { enhancementPlan, restoreEnhancedAlpha, enhancedLayer, enhancementResult, advanceEnhancement } from "@/server/designExtract/enhancement";
const base = { id: "layer-0", name: "Logo", url: "https://r2.test/base.png", width: 2, height: 2,
  nativeFrame: { width: 4, height: 4, left: 1, top: 2 }, composition: { x: 17, y: 23, scale: 1.6 }, layout: { x: 300, y: 0, scale: 1 }, visible: true };
let state, failReceiptSave;
function database() {
  mocks.from.mockImplementation(() => {
    let update; const filters = [];
    const q = { select: () => q, update: value => { update = value; return q; }, eq: (key, value) => { filters.push([key, value]); return q; } };
    q.single = q.maybeSingle = async () => {
      if (!update) return { data: structuredClone(state) };
      if (failReceiptSave && update.result.enhancement.items.some(item => item.status === "queued")) throw new Error("DB unavailable after paid submission");
      if (filters.some(([key, value]) => key === "status" ? state.status !== value : key === "result->enhancement->>revision" ? String(state.result.enhancement.revision) !== value : false)) return { data: null };
      state = { ...state, ...structuredClone(update) }; return { data: structuredClone(state) };
    };
    return q;
  });
}
async function fixture(count = 1) {
  const source = await sharp(Buffer.from([10,20,30,0, 20,30,40,128, 30,40,50,255, 40,50,60,255]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const output = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 90, g: 120, b: 150 } } }).png().toBuffer();
  const assets = { readAsset: vi.fn(async (url) => url.includes("fal.test") ? output : source), uploadToR2: vi.fn(async (_, key) => `https://r2.test/${key}`), prefix: () => "owner/project/" };
  state = { id: "job", project_id: "project", status: "saving", result: enhancementResult({ layers: Array.from({ length: count }, (_, i) => ({ ...base, id: `layer-${i}` })), warnings: [] }) };
  mocks.submit.mockImplementation(async () => ({ request_id: `paid-${mocks.submit.mock.calls.length}` }));
  mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.result.mockResolvedValue({ data: { image: { url: "https://fal.test/enhanced.png" } } });
  return { source, output, assets, step: () => advanceEnhancement({}, structuredClone(state), assets) };
}
beforeEach(() => { vi.clearAllMocks(); failReceiptSave = false; database(); });
describe("bounded, alpha-preserving enhancement", () => {
  it("plans up to 4x without exceeding dimension or pixel limits", () => {
    expect(enhancementPlan(480,832)).toEqual({scale:4,width:1920,height:3328});
    expect(enhancementPlan(2000,2000)).toEqual({scale:2,width:4000,height:4000});
    expect(enhancementPlan(4000,4000)).toBeNull(); expect(enhancementPlan(0,20)).toBeNull();
  });
  it("restores the original resized alpha even when the provider returns an opaque image", async () => {
    const {source,output}=await fixture(); const png=await restoreEnhancedAlpha(source,output,enhancementPlan(2,2));
    const actual=await sharp(png).ensureAlpha().raw().toBuffer();
    const alpha=await sharp(source).extractChannel(3).resize(8,8,{kernel:"lanczos3"}).raw().toBuffer();
    for(let i=0;i<64;i++){expect(actual[i*4+3]).toBe(alpha[i]);expect([...actual.subarray(i*4,i*4+3)]).toEqual([90,120,150]);}
    await expect(restoreEnhancedAlpha(source,source,enhancementPlan(2,2))).rejects.toThrow("unexpected dimensions");
  });
  it("keeps both canvas placements and visual dimensions unchanged", () => {
    const next=enhancedLayer(base,"enhanced.png",enhancementPlan(2,2));
    expect(next.composition).toEqual({x:17,y:23,scale:.4}); expect(next.layout).toEqual({x:300,y:0,scale:.25});
    expect(next.width*next.composition.scale).toBe(base.width*base.composition.scale);
    expect(next.nativeFrame).toEqual({width:16,height:16,left:4,top:8});expect(base.url).toContain("base.png");
  });
});
describe("durable automatic per-layer processing", () => {
  it("enhances every candidate, records receipts, then makes review ready", async () => {
    const {step,assets}=await fixture(4);
    for(let i=0;i<12&&state.status!=="ready";i++)await step();
    expect(state.status).toBe("ready");expect(mocks.submit).toHaveBeenCalledTimes(4);
    expect(state.result.enhancement.items.every(item=>item.status==="done")).toBe(true);
    for(const layer of state.result.layers){expect(layer).toMatchObject({width:8,height:8,enhancement:{scale:4}});expect(layer.url).toContain("enhanced-");}
    expect(mocks.submit.mock.calls.every(([input])=>input.scale===4&&input.face===false&&input.model==="RealESRGAN_x4plus")).toBe(true);
    const rgb=assets.uploadToR2.mock.calls.find(([,key])=>key.includes("enhance-input"))[0];expect((await sharp(rgb).metadata()).hasAlpha).toBe(false);
  });
  it("allows only one browser/cron poller to submit a layer", async () => {
    const {assets}=await fixture();const snapshot=structuredClone(state);
    await Promise.all([advanceEnhancement({},snapshot,assets),advanceEnhancement({},snapshot,assets)]);
    expect(mocks.submit).toHaveBeenCalledTimes(1);expect(state.result.enhancement.items[0].requestId).toBe("paid-1");
  });
  it("resumes known receipt polling after a transient outage without another paid request", async () => {
    const {step}=await fixture();await step();
    mocks.status.mockRejectedValueOnce(Object.assign(new Error("Temporary outage"),{status:503}));await expect(step()).rejects.toThrow("Temporary outage");
    await step();await step();expect(state.status).toBe("ready");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps the original candidate on bad output and reports a review warning", async () => {
    const {step,assets,source}=await fixture();await step();assets.readAsset.mockResolvedValue(source);await step();await step();
    expect(state.status).toBe("ready");expect(state.result.layers[0]).toEqual(base);
    expect(state.result.warnings[0]).toContain("original extracted layer was kept");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("never repeats a paid submission after losing its receipt checkpoint", async () => {
    const {step}=await fixture();failReceiptSave=true;await expect(step()).rejects.toThrow("DB unavailable");
    failReceiptSave=false;await step();expect(mocks.submit).toHaveBeenCalledTimes(1);
    state.result.enhancement.items[0].startedAt=new Date(Date.now()-121000).toISOString();await step();await step();
    expect(state.status).toBe("ready");expect(state.result.enhancement.items[0].status).toBe("uncertain");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("preserves the original on rejection and completes the remaining work", async () => {
    const {step}=await fixture();mocks.submit.mockRejectedValueOnce(Object.assign(new Error("Rejected"),{status:422}));await step();await step();
    expect(state.status).toBe("ready");expect(state.result.layers[0]).toEqual(base);expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not resubmit when a known provider request exceeds its waiting limit", async () => {
    const {step}=await fixture();await step();state.result.enhancement.items[0].startedAt=new Date(Date.now()-21*60_000).toISOString();await step();await step();
    expect(state.status).toBe("ready");expect(state.result.layers[0]).toEqual(base);expect(state.result.warnings[0]).toContain("took too long");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps polling the same receipt when storage is temporarily unavailable", async () => {
    const {step,assets}=await fixture();await step();assets.uploadToR2.mockRejectedValueOnce(new Error("Storage unavailable"));await expect(step()).rejects.toThrow("Storage unavailable");
    await step();await step();expect(state.status).toBe("ready");expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("preserves finished enhancements while a later element falls back", async () => {
    const {step}=await fixture(2);await step();await step();mocks.submit.mockRejectedValueOnce(new Error("Connection lost"));await step();await step();
    expect(state.status).toBe("ready");expect(state.result.layers[0].enhancement.scale).toBe(4);expect(state.result.layers[1].url).toEqual(base.url);expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("skips unsafe output sizes without submitting and leaves the candidate untouched", async () => {
    const {step}=await fixture();state.result=enhancementResult({layers:[{...base,width:4000,height:4000}],warnings:[]});await step();
    expect(state.status).toBe("ready");expect(state.result.enhancement.items[0].status).toBe("skipped");expect(state.result.warnings[0]).toContain("safe output limits");expect(mocks.submit).not.toHaveBeenCalled();
  });
});
