import { safeJson } from "@/lib/safeJson";
import { parseUpscaleJobMarker } from "@/lib/standaloneUpscale";

const PREFIX = "desaynclaw:upscale-attempt:";
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export function restoreUpscaleProject(project, savedAttempt) {
  const saved = savedAttempt?.projectId === project.id ? savedAttempt : null;
  return {
    requestKey: project.client_request_id || `restored-${project.id}`,
    imageUrl: project.original_image_url,
    name: project.name,
    profile: saved?.profile || null, // Historical rows do not store the profile.
    projectId: project.id,
    requestId: parseUpscaleJobMarker(project.ai_prompt)?.requestId,
    createdAt: new Date(project.created_at).getTime() || Date.now(),
    upscaledUrl: project.generated_image_url && project.generated_image_url !== "REFUNDED" ? project.generated_image_url : null,
  };
}

export function readUpscaleAttempt(userId) {
  if (!userId) return null;
  try {
    const attempt = JSON.parse(globalThis.sessionStorage?.getItem(`${PREFIX}${userId}`) || "null");
    if (!attempt?.requestKey || !attempt.imageUrl || !Number.isFinite(attempt.createdAt) || Date.now() - attempt.createdAt > RETENTION_MS) return null;
    return attempt;
  } catch {
    return null;
  }
}

export function saveUpscaleAttempt(userId, attempt) {
  if (!userId) return;
  try {
    if (attempt) globalThis.sessionStorage?.setItem(`${PREFIX}${userId}`, JSON.stringify(attempt));
    else globalThis.sessionStorage?.removeItem(`${PREFIX}${userId}`);
  } catch {
    // Private/hardened browsers still retain the same key in the page's ref.
  }
}

export async function resolveUpscaleAttempt({ attempt, token, poll, onUpdate }) {
  if (attempt.upscaledUrl) return attempt.upscaledUrl;
  // A known project is polled directly; it never needs another paid POST.
  if (!attempt.projectId) {
    const response = await fetch("/api/upscale", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ imageUrl: attempt.imageUrl, idempotencyKey: attempt.requestKey, profile: attempt.profile }),
    });
    const data = await safeJson(response, "Failed to process image");
    if (data.projectId) {
      Object.assign(attempt, { projectId: data.projectId, requestId: data.requestId });
      onUpdate(attempt);
    }
    if (data.refunded || data.error === "INSUFFICIENT_CREDITS") {
      const error = new Error(data.error || "Upscale failed and was refunded");
      error.attemptFinished = true;
      throw error;
    }
    if (!response.ok) throw new Error(data.error || "Failed to process image");
    if (data.upscaledUrl) return data.upscaledUrl;
  }
  if (!attempt.projectId) throw new Error("Upscale is taking too long. Please try again.");
  const url = await poll({ requestId: attempt.requestId, projectId: attempt.projectId, token });
  if (!url) throw new Error("Upscale is taking too long. Please try again.");
  return url;
}
