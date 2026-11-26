// The installed fal queue SDK retries POST submissions internally. Paid
// enhancements use one HTTP attempt so a lost response cannot duplicate work.
export const ENHANCE_MODEL = "recraft/crisp-upscale";
export const TOPAZ_ENHANCE_MODEL = "topaz/upscale/image/transparent";
export const LEGACY_ENHANCE_MODEL = "fal-ai/esrgan";
export async function submitEnhancement(input, model = ENHANCE_MODEL) {
  if(model===ENHANCE_MODEL){
    if(!process.env.RECRAFT_API_KEY)throw Error('Recraft enhancement is not configured');
    const response=await fetch('https://external.api.recraft.ai/v1/images/crispUpscale',{method:'POST',redirect:'error',cache:'no-store',headers:{Authorization:`Bearer ${process.env.RECRAFT_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({image_url:input.image_url,image_format:'png',response_format:'url'}),signal:AbortSignal.timeout(40000)});
    if(!response.ok)throw Object.assign(Error('Recraft enhancement did not confirm a result'),{status:response.status});
    const data=await response.json();if(typeof data.image?.url!=='string')throw Object.assign(Error('Recraft enhancement returned no image'), { status: 422 });
    return {image_url:data.image.url,units:Number.isFinite(data.credits)?data.credits:null};
  }
  if (![TOPAZ_ENHANCE_MODEL, LEGACY_ENHANCE_MODEL].includes(model)) throw new Error("Unknown enhancement provider");
  if (!process.env.FAL_KEY) throw new Error("Enhancement provider is not configured");
  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw Object.assign(new Error("Enhancement provider did not confirm submission"), { status: response.status });
  const receipt = await response.json();
  if (typeof receipt.request_id !== "string" || !/^[a-zA-Z0-9-]{8,120}$/.test(receipt.request_id)) throw new Error("Enhancement provider returned no valid receipt");
  return { request_id: receipt.request_id };
}
