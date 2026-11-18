import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { submitEnhancement } from "@/server/designExtract/enhancementProvider";
let fetchMock;
beforeEach(()=>{vi.stubEnv("FAL_KEY","test-only-key");fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("submits to the fixed enhancement endpoint with a bounded request and no redirect",async()=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify({request_id:"receipt-12345"}),{status:200}));
 const input={image_url:"https://r2.test/layer.png",scale:4,model:"RealESRGAN_x4plus",face:false,output_format:"png"};
 expect(await submitEnhancement(input)).toEqual({request_id:"receipt-12345"});
 expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://queue.fal.run/fal-ai/esrgan",expect.objectContaining({method:"POST",redirect:"error",cache:"no-store",body:JSON.stringify(input),signal:expect.any(AbortSignal)}));
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
