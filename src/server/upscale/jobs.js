import { uploadToR2 } from "@/lib/cloudflare";
import { DEFAULT_MAX_UPSCALED_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts } from "@/lib/ssrf";
import { parseUpscaleJobMarker } from "@/lib/standaloneUpscale";

export const UPSCALE_JOB_FIELDS = "id, user_id, created_at, ai_prompt, generated_image_url, credit_deducted, refunded";

export function upscaleJobSnapshot(project) {
  if (project.refunded || project.generated_image_url === "REFUNDED") {
    return { status: "FAILED", refunded: true };
  }
  if (project.generated_image_url) {
    return { status: "COMPLETED", upscaledUrl: project.generated_image_url };
  }
  const job = parseUpscaleJobMarker(project.ai_prompt);
  return { status: "IN_QUEUE", ...(job ? { requestId: job.requestId } : {}) };
}

export async function readUpscaleJob(db, projectId, userId) {
  const { data, error } = await db.from("projects").select(UPSCALE_JOB_FIELDS)
    .eq("id", projectId).eq("user_id", userId).eq("trace_type", "upscale").maybeSingle();
  if (error) throw error;
  return data;
}

export async function refundUpscaleJob(db, project, action = "Refund (Upscale Error)") {
  // The RPC locks the row and refuses to refund delivered/already-refunded jobs.
  const { data, error } = await db.rpc("refund_project_credit", {
    target_user_id: project.user_id,
    target_project_id: project.id,
    refund_action: action,
    failed_step_value: "upscale",
    mark_generated_refunded: true,
  });
  if (error) throw error;
  const refund = Array.isArray(data) ? data[0] : data;
  return refund?.status === "refunded";
}

export function isTerminalUpscaleError(error) {
  // Network errors, timeouts, rate limits and provider/server outages are retryable.
  return error?.name === "ValidationError" || error?.status === 422 ||
    error?.message === "Unprocessable Entity";
}

function isExpiredOutput(error, project) {
  // Allow time for a newly submitted request/result to propagate. A gone (410)
  // asset or an old missing (404) asset can no longer be delivered.
  return error?.status === 410 || (error?.status === 404 &&
    Date.now() - new Date(project.created_at).getTime() >= 30 * 60_000);
}

async function settleFailure(db, project, refundAction) {
  const refunded = await refundUpscaleJob(db, project, refundAction);
  if (refunded) return { status: "FAILED", refunded: true };
  // Another poll may have delivered the output while the refund waited.
  const latest = await readUpscaleJob(db, project.id, project.user_id);
  if (!latest) throw new Error("Upscale request not found");
  return upscaleJobSnapshot(latest);
}

async function persistResult(providerUrl, projectId) {
  const { response, buffer } = await fetchWithSSRFProtection(providerUrl, {
    allowedHosts: getAllowedProviderHosts(),
    maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
  });
  if (!response.ok) throw Object.assign(new Error(`Provider download returned ${response.status}`), { status: response.status });
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") throw new Error("Provider output is not an image");
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  // Concurrent polls/reconciliation overwrite the same object, not new copies.
  const url = await uploadToR2(buffer, `projects/${projectId}/upscaled_result.${extension}`, contentType);
  if (!url) throw new Error("Upscale output could not be saved");
  return url;
}

export async function settleUpscaleJob({ db, fal, project, refundAction }) {
  const snapshot = upscaleJobSnapshot(project);
  if (snapshot.status !== "IN_QUEUE") return snapshot;
  const job = parseUpscaleJobMarker(project.ai_prompt);
  if (!job) return snapshot; // Submission may still be saving its queue marker.

  let result;
  let failed = false;
  try {
    const status = await fal.queue.status(job.endpoint, { requestId: job.requestId, logs: true });
    if (status.status === "FAILED") failed = true;
    else if (status.status !== "COMPLETED") return { status: status.status, logs: status.logs || [] };
    else {
      result = await fal.queue.result(job.endpoint, { requestId: job.requestId });
      failed = !result?.data?.image?.url;
    }
  } catch (error) {
    if (!isTerminalUpscaleError(error) && !isExpiredOutput(error, project)) throw error;
    failed = true;
  }

  if (failed) {
    return settleFailure(db, project, refundAction);
  }

  // Storage/DB failures deliberately propagate: the job stays pending and the
  // next browser poll or cron retries delivery. Temporary provider URLs never
  // become the recorded paid result.
  let upscaledUrl;
  try {
    upscaledUrl = await persistResult(result.data.image.url, project.id);
  } catch (error) {
    if (isExpiredOutput(error, project)) return settleFailure(db, project, refundAction);
    throw error;
  }
  const { data: saved, error } = await db.from("projects")
    .update({ generated_image_url: upscaledUrl })
    .eq("id", project.id).eq("user_id", project.user_id)
    .eq("refunded", false).is("generated_image_url", null)
    .select(UPSCALE_JOB_FIELDS).maybeSingle();
  if (error) throw error;
  if (saved) return upscaleJobSnapshot(saved);
  // A refund or a concurrent completion won the conditional write.
  const latest = await readUpscaleJob(db, project.id, project.user_id);
  if (!latest) throw new Error("Upscale request not found");
  return upscaleJobSnapshot(latest);
}
