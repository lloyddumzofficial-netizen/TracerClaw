import { createHash } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex");

// Compare runs without retaining private artwork, prompts, or signed URLs in
// logs. URL changes do not imply that the source image itself changed.
export function getTraceRequestDiagnostics({ model, input, sourceBuffer }) {
  const sourceHash = digest(sourceBuffer);
  const promptHash = digest(JSON.stringify([input.prompt, input.system_prompt]));
  const settings = Object.fromEntries(Object.entries(input)
    .filter(([key]) => !["image_urls", "prompt", "system_prompt"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)));
  return {
    sourceHash,
    promptHash,
    requestFingerprint: digest(JSON.stringify({ model, sourceHash, promptHash, settings })),
    model,
    resolution: input.resolution,
  };
}
