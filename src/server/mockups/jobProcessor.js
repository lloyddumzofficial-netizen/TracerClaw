import sharp from "sharp";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { fetchWithSSRFProtection, getAllowedProviderHosts } from "@/lib/ssrf";
import { MOCKUP_SHOTS } from "@/features/mockup-studio/config";
import { getGarmentProfile, isGarmentPartAllowed } from "@/features/mockup-studio/garmentCatalog";
import { getMockupProviderResult, submitMockupViews } from "./provider";
import { loadMockupAssets, loadOwnedMockupJob, loadOwnedMockupProject } from "./repository";
import { createMockupWebhookUrl } from "./webhook";

const STALE_PHASE_MS = 20 * 60_000;

function orderedAssets(project, assets) {
  const profile = getGarmentProfile(project.garment_type);
  const order = [...profile.requiredParts, ...profile.optionalParts];
  return assets
    .filter(asset => isGarmentPartAllowed(project.garment_type, asset.role))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

async function refundJob(userId, jobId, errorCode) {
  const { data } = await adminSupabase.rpc("refund_mockup_render", {
    target_user_id: userId,
    target_job_id: jobId,
    error_code_value: errorCode,
  });
  const refund = Array.isArray(data) ? data[0] : data;
  return refund?.status === "refunded";
}

async function saveProviderOutput({ providerImage, shot, userId, job }) {
  const fetched = await fetchWithSSRFProtection(providerImage.url, {
    allowedHosts: getAllowedProviderHosts(),
    maxBytes: 30 * 1024 * 1024,
    allowedContentTypes: ["image/", "application/octet-stream"],
  });
  const mimeType = fetched.response.headers.get("content-type")?.split(";")[0] || providerImage.content_type || "image/png";
  const metadata = await sharp(fetched.buffer).metadata();
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const fileUrl = await uploadToR2(
    fetched.buffer,
    `users/${userId}/mockups/${job.project_id}/outputs/${job.id}-${shot.key}.${extension}`,
    mimeType,
  );
  const { data, error } = await adminSupabase.from("mockup_outputs").upsert({
    job_id: job.id,
    project_id: job.project_id,
    user_id: userId,
    view_type: shot.key,
    file_url: fileUrl,
    mime_type: mimeType,
    width: metadata.width || providerImage.width || null,
    height: metadata.height || providerImage.height || null,
  }, { onConflict: "job_id,view_type" }).select("*").single();
  if (error) throw error;
  return data;
}

async function loadCampaignReferences(userId, job, requests, outputByView) {
  const [{ project }, assetsResult] = await Promise.all([
    loadOwnedMockupProject(userId, job.project_id),
    loadMockupAssets(userId, job.project_id),
  ]);
  if (!project) throw new Error("Mockup project is unavailable.");
  const assets = orderedAssets(project, assetsResult.data || []);
  const boardUrl = requests._referenceBoard;
  const heroUrl = outputByView.get("hero")?.file_url;
  if (!boardUrl || !heroUrl) throw new Error("Campaign references are incomplete.");
  return { project, assets, boardUrl, heroUrl };
}

async function restoreFailedRetry(userId, job, requests) {
  const restored = { ...requests, _phase: "retry_failed" };
  await adminSupabase.from("mockup_jobs").update({
    provider_requests: restored,
    status: "completed",
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).eq("id", job.id).eq("user_id", userId);
  return restored;
}

export async function processMockupJob({ userId, jobId, job: suppliedJob }) {
  const loaded = suppliedJob ? { job: suppliedJob } : await loadOwnedMockupJob(userId, jobId);
  const job = loaded.job;
  if (!job || job.user_id !== userId) return { notFound: true };

  const { data: storedOutputs } = await adminSupabase.from("mockup_outputs").select("*")
    .eq("job_id", job.id).eq("user_id", userId);
  if (["completed", "refunded", "failed"].includes(job.status)) {
    return { job: { id: job.id, status: job.status, errorCode: job.error_code }, outputs: storedOutputs || [] };
  }

  const outputByView = new Map((storedOutputs || []).map(output => [output.view_type, output]));
  let requests = { ...(job.provider_requests || {}) };
  const retryView = requests._phase === "retry" ? requests._retryView : null;
  let retryCompleted = false;
  let providerFailed = false;
  let providerPending = false;
  const phaseUpdatedAt = Date.parse(job.updated_at || job.created_at);
  const isStale = Date.now() - phaseUpdatedAt > STALE_PHASE_MS;
  const providerRequestCount = MOCKUP_SHOTS.filter(shot => Boolean(requests[shot.key])).length;

  if (isStale && requests._phase === "campaign_queueing") {
    const refunded = await refundJob(userId, job.id, "INTERRUPTED_CAMPAIGN_SUBMISSION");
    return { job: { id: job.id, status: refunded ? "refunded" : "failed" }, outputs: storedOutputs || [], refunded };
  }
  if (isStale && requests._phase === "retry_queueing") {
    requests = await restoreFailedRetry(userId, job, requests);
    return { job: { id: job.id, status: "completed", retryFailed: true }, outputs: storedOutputs || [] };
  }
  if (!providerRequestCount && isStale) {
    const refunded = await refundJob(userId, job.id, "INTERRUPTED_MOCKUP_RENDER");
    return { job: { id: job.id, status: refunded ? "refunded" : "failed" }, outputs: storedOutputs || [], refunded };
  }
  if (!providerRequestCount) {
    return { job: { id: job.id, status: job.status }, outputs: storedOutputs || [] };
  }

  for (const shot of MOCKUP_SHOTS) {
    const isRetry = retryView === shot.key;
    if (outputByView.has(shot.key) && !isRetry) continue;
    const providerId = isRetry ? requests._retryRequest : requests[shot.key];
    if (!providerId) continue;
    try {
      const provider = await getMockupProviderResult(providerId);
      if (provider.status === "FAILED") {
        providerFailed = true;
        break;
      }
      if (provider.status !== "COMPLETED" || !provider.image?.url) {
        providerPending = true;
        continue;
      }
      const saved = await saveProviderOutput({ providerImage: provider.image, shot, userId, job });
      if (saved) outputByView.set(shot.key, saved);
      if (isRetry) {
        retryCompleted = true;
        requests._phase = "complete";
      }
    } catch (error) {
      console.warn(`[Mockup processor] ${shot.key} is not ready:`, error?.message);
      if (isStale) providerFailed = true;
    }
  }

  if (isStale && providerPending) providerFailed = true;

  if (providerFailed) {
    if (retryView) {
      await restoreFailedRetry(userId, job, requests);
      return { job: { id: job.id, status: "completed", retryFailed: true }, outputs: [...outputByView.values()] };
    }
    const refunded = await refundJob(userId, job.id, "PROVIDER_RENDER_FAILED");
    return { job: { id: job.id, status: refunded ? "refunded" : "failed" }, outputs: [...outputByView.values()], refunded };
  }

  if (outputByView.has("hero") && requests._phase === "hero") {
    const reservedRequests = { ...requests, _phase: "campaign_queueing" };
    const { data: reservation } = await adminSupabase.from("mockup_jobs").update({
      provider_requests: reservedRequests,
      status: "processing",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("user_id", userId).contains("provider_requests", { _phase: "hero" }).select("id").maybeSingle();

    if (reservation) {
      try {
        const refs = await loadCampaignReferences(userId, job, requests, outputByView);
        const campaignRequests = await submitMockupViews({
          imageUrls: [refs.boardUrl, refs.heroUrl, ...refs.assets.map(asset => asset.file_url)],
          assetRoles: ["production_board", "canonical_hero", ...refs.assets.map(asset => asset.role)],
          style: refs.project.style_preset,
          colors: refs.project.colors || {},
          garmentType: refs.project.garment_type,
          shots: MOCKUP_SHOTS.filter(shot => shot.key !== "hero"),
          webhookUrl: createMockupWebhookUrl(job.id),
        });
        requests = { ...reservedRequests, ...campaignRequests, _phase: "campaign" };
        await adminSupabase.from("mockup_jobs").update({
          provider_requests: requests,
          status: "processing",
          updated_at: new Date().toISOString(),
        }).eq("id", job.id).eq("user_id", userId);
      } catch (error) {
        console.error("[Mockup processor] Could not start campaign phase:", error?.message);
        const refunded = await refundJob(userId, job.id, "CAMPAIGN_SUBMIT_FAILED");
        return { job: { id: job.id, status: refunded ? "refunded" : "failed" }, outputs: [...outputByView.values()], refunded };
      }
    }
  }

  const outputs = MOCKUP_SHOTS.map(shot => outputByView.get(shot.key)).filter(Boolean);
  const retryPending = retryView && !retryCompleted;
  const completed = outputs.length === MOCKUP_SHOTS.length && !retryPending;
  const now = new Date().toISOString();
  if (completed || retryCompleted || job.status !== "processing") {
    await adminSupabase.from("mockup_jobs").update({
      status: completed ? "completed" : "processing",
      updated_at: now,
      ...(retryCompleted ? { provider_requests: requests } : {}),
      ...(completed ? { completed_at: now } : {}),
    }).eq("id", job.id).eq("user_id", userId);
  }
  if (completed) {
    await adminSupabase.from("mockup_projects").update({ status: "completed", updated_at: now })
      .eq("id", job.project_id).eq("user_id", userId);
  }
  return { job: { id: job.id, status: completed ? "completed" : "processing" }, outputs };
}
