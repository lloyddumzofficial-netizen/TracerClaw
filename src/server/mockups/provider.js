import { MOCKUP_MODEL, MOCKUP_SHOTS } from "@/features/mockup-studio/config";
import { buildMockupPrompt } from "@/server/mockups/prompts";

const SHOT_REFERENCE_PRIORITY = Object.freeze({
  hero: ["left_sleeve", "right_sleeve", "canonical_front", "canonical_back", "production_board", "front", "back", "canonical_hero", "style_reference"],
  front: ["left_sleeve", "right_sleeve", "canonical_front", "canonical_back", "production_board", "front", "back", "canonical_hero", "style_reference"],
  back: ["left_sleeve", "right_sleeve", "canonical_back", "canonical_front", "production_board", "back", "front", "canonical_hero", "style_reference"],
  sleeve: ["left_sleeve", "canonical_front", "production_board", "canonical_hero", "front", "back", "right_sleeve", "canonical_back", "style_reference"],
  detail: ["left_sleeve", "canonical_front", "production_board", "canonical_hero", "front", "back", "right_sleeve", "canonical_back", "style_reference"],
});

export function orderMockupReferences({ imageUrls = [], assetRoles = [], shot }) {
  const priority = SHOT_REFERENCE_PRIORITY[shot] || SHOT_REFERENCE_PRIORITY.hero;
  return assetRoles
    .map((role, index) => ({ role, imageUrl: imageUrls[index], index }))
    .filter(item => item.imageUrl)
    .sort((a, b) => {
      if (a.role === "style_reference") return 1;
      if (b.role === "style_reference") return -1;
      const aPriority = priority.indexOf(a.role);
      const bPriority = priority.indexOf(b.role);
      const aRank = aPriority === -1 ? priority.length : aPriority;
      const bRank = bPriority === -1 ? priority.length : bPriority;
      return aRank - bRank || a.index - b.index;
    });
}

export async function submitMockupViews({ imageUrls, assetRoles, style, colors, garmentType, shots = MOCKUP_SHOTS, webhookUrl }) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing.");
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: process.env.FAL_KEY });

  const requests = {};
  for (const shot of shots) {
    const references = orderMockupReferences({ imageUrls, assetRoles, shot: shot.key });
    const submitted = await fal.queue.submit(MOCKUP_MODEL, {
      ...(webhookUrl ? { webhookUrl } : {}),
      input: {
        image_urls: references.map(item => item.imageUrl),
        system_prompt: "You are a production-fidelity garment photographer. Treat every supplied artwork panel as immutable manufacturing data. Camera, support, drape, lighting and background may change; printed motifs, lettering, colors, panel identity and left/right sleeve assignment may never change. Production fidelity always outranks artistic composition.",
        prompt: buildMockupPrompt({ shot: shot.key, style, colors, assetRoles: references.map(item => item.role), garmentType }),
        num_images: 1,
        aspect_ratio: shot.key === "detail" ? "4:5" : "4:5",
        output_format: "png",
        resolution: "1K",
        limit_generations: true,
        thinking_level: "high",
      },
    });
    requests[shot.key] = submitted.request_id;
  }
  return requests;
}

export async function getMockupProviderResult(requestId) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing.");
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: process.env.FAL_KEY });
  const status = await fal.queue.status(MOCKUP_MODEL, { requestId, logs: false });
  if (status.status !== "COMPLETED") return { status: status.status };
  const result = await fal.queue.result(MOCKUP_MODEL, { requestId });
  return { status: "COMPLETED", image: result?.data?.images?.[0] || null };
}
