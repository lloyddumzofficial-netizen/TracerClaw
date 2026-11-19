import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { submitEnhancement as submitProvider, TOPAZ_ENHANCE_MODEL as ENHANCE_MODEL, LEGACY_ENHANCE_MODEL } from "@/server/designExtract/enhancementProvider";
const submitEnhancement=(input,model=ENHANCE_MODEL)=>submitProvider(input,model);
let fetchMock;
beforeEach(()=>{vi.stubEnv("FAL_KEY","test-only-key");fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("submits to the fixed enhancement endpoint with a bounded request and no redirect",async()=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify({request_id:"receipt-12345"}),{status:200}));
 const input={image_url:"https://r2.test/layer.png",output_format:"png"};
 expect(await submitEnhancement(input)).toEqual({request_id:"receipt-12345"});
 expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://queue.fal.run/${ENHANCE_MODEL}`,expect.objectContaining({method:"POST",redirect:"error",cache:"no-store",body:JSON.stringify(input),signal:expect.any(AbortSignal)}));
});
it.each([422,503])("never retries an unsuccessful paid HTTP submission (%s)",async status=>{
 fetchMock.mockResolvedValue(new Response("Unavailable",{status}));await expect(submitEnhancement({})).rejects.toMatchObject({status});expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("never retries when the submission receipt is lost",async()=>{
 fetchMock.mockRejectedValue(new Error("Connection reset"));await expect(submitEnhancement({})).rejects.toThrow("Connection reset");expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects a missing receipt without repeating the paid request",async()=>{
 fetchMock.mockResolvedValue(new Response("{}",{status:200}));await expect(submitEnhancement({})).rejects.toThrow("no valid receipt");expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not submit when provider credentials are unavailable",async()=>{
 vi.stubEnv("FAL_KEY","");await expect(submitEnhancement({})).rejects.toThrow("not configured");expect(fetchMock).not.toHaveBeenCalled();
});

it("supports only the recorded legacy endpoint, never arbitrary provider URLs",async()=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify({request_id:"receipt-12345"}),{status:200}));
 await submitEnhancement({},LEGACY_ENHANCE_MODEL);
 expect(fetchMock.mock.calls[0][0]).toBe("https://queue.fal.run/fal-ai/esrgan");
 await expect(submitEnhancement({},"https://attacker.invalid")).rejects.toThrow("Unknown");
 expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("uses direct Recraft Crisp for new enhancements",async()=>{vi.stubEnv("RECRAFT_API_KEY","recraft-test");fetchMock.mockResolvedValue(new Response(JSON.stringify({image:{url:"https://img.recraft.ai/output.png"},credits:4}),{status:200}));expect(await submitProvider({image_url:"https://signed.test/input.png"})).toEqual({image_url:"https://img.recraft.ai/output.png",units:4});expect(fetchMock.mock.calls[0][0]).toBe("https://external.api.recraft.ai/v1/images/crispUpscale");});
it("does not fall back to paid fal upscaling when Recraft is unavailable", async () => {
 vi.stubEnv("RECRAFT_API_KEY", "");
 await expect(submitProvider({ image_url: "https://signed.test/input.png" })).rejects.toThrow("Recraft enhancement is not configured");
 expect(fetchMock).not.toHaveBeenCalled();
});
