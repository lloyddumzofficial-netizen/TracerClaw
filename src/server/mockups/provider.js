import { MOCKUP_MODEL, MOCKUP_SHOTS } from "@/features/mockup-studio/config";
import { buildMockupPrompt } from "@/server/mockups/prompts";

const SHOT_REFERENCE_PRIORITY = Object.freeze({
  hero: ["production_board", "front", "left_sleeve", "right_sleeve", "back", "style_reference"],
  front: ["production_board", "canonical_hero", "front", "left_sleeve", "right_sleeve", "back", "style_reference"],
  back: ["production_board", "canonical_hero", "back", "left_sleeve", "right_sleeve", "front", "style_reference"],
  sleeve: ["production_board", "canonical_hero", "left_sleeve", "front", "back", "right_sleeve", "style_reference"],
  detail: ["production_board", "canonical_hero", "left_sleeve", "front", "back", "right_sleeve", "style_reference"],
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
        prompt: buildMockupPrompt({ shot: shot.key, style, colors, assetRoles: references.map(item => item.role), garmentType }),
        num_images: 1,
        aspect_ratio: shot.key === "detail" ? "4:5" : "4:5",
        output_format: "png",
        resolution: "1K",
        limit_generations: true,
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
