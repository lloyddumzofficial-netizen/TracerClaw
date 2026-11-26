import { LAYER_MODEL, LEGACY_LAYER_MODEL, SEGMENT_MODEL, LEGACY_SEGMENT_MODEL } from "@/lib/designExtract";
import { PILOT_MASK_MODEL } from "./qualityPilot";
import { GUIDED_CUTOUT_MODEL } from "./guidedCutout";
import { GUIDED_BACKGROUND_MODEL } from "./guidedBackground";
import { REFINE_MODEL } from "./refinement";

// One paid HTTP attempt. SDK retry policies must never duplicate a generation.
export async function submitDesignOperation(model, { input }) {
  if (![LAYER_MODEL, LEGACY_LAYER_MODEL, SEGMENT_MODEL, LEGACY_SEGMENT_MODEL, PILOT_MASK_MODEL, GUIDED_CUTOUT_MODEL, GUIDED_BACKGROUND_MODEL, REFINE_MODEL].includes(model)) throw new Error("Unsupported design model");
  if (!process.env.FAL_KEY) throw new Error("AI processing is not configured");
  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", ...([PILOT_MASK_MODEL, GUIDED_CUTOUT_MODEL, GUIDED_BACKGROUND_MODEL, REFINE_MODEL].includes(model) && { "x-app-fal-disable-fallback": "true" }) },
    body: JSON.stringify(input), signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw Object.assign(new Error("Provider did not confirm the extraction submission"), { status: response.status });
  const receipt = await response.json();
  if (typeof receipt.request_id !== "string" || !/^[a-zA-Z0-9-]{8,120}$/.test(receipt.request_id)) throw new Error("Provider returned no valid receipt");
  return { request_id: receipt.request_id };
}
