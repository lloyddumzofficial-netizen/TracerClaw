import { serializeDesignData } from "./storage";
import { isQualityPilotJob, isQualityReviewJob, PILOT_MASK_MODEL, PILOT_PREPARATION_LIMIT_MS } from "./qualityPilot";
import { guidedCutout, GUIDED_CUTOUT_MODEL, isAutomaticSeparationJob } from "./guidedCutout";
import { REFINE_MODEL } from "./refinement";
import { canAutoAcceptNanoLayers } from "./nanoElements";

export async function designResponse(data, options = {}) {
  let output = data;
  if (data?.job) {
    const { input: _input, request_id, model: _model, idempotency_key: _key, processing_lease_token: _lease, processing_lease_until: _until, processor_run_id: _run, ...job } = data.job;
    job.canRecover = Boolean(request_id);
    if (isQualityPilotJob(data.job)) {
      job.qualityPilot = true;
      job.preparingPilot = job.status === "submitting" && (data.job.model !== PILOT_MASK_MODEL || Date.now() - Date.parse(job.dispatch_started_at || job.created_at) < PILOT_PREPARATION_LIMIT_MS);
    }
    if (isQualityReviewJob(data.job)) job.qualityReview = true;
    if (isAutomaticSeparationJob(data.job)) job.automaticSeparation = true;
    if (job.automaticSeparation && data.job.input?._desaynclaw?.whiteElements) job.whiteElements = true;
    if (canAutoAcceptNanoLayers(data.job, data.project)) job.autoAccept = true;
    if (guidedCutout(data.job) || job.automaticSeparation) {
      job.guided = true;
      if (job.result?.backgroundFill) {
        const { backgroundFill: _fill, ...result } = job.result;
        job.result = result;
        job.fillingBackground = job.status === "saving";
      }
      if (job.result?.cutoutBatch) {
        const { cutoutBatch: _batch, ...result } = job.result;
        job.result = result;
        job.separatingTargets = job.status === "saving";
      }
      if (job.result?.whiteOutput) {
        const { whiteOutput: _whiteOutput, ...result } = job.result;
        job.result = result;
      }
      if (job.result?.productionOutput) {
        const { productionOutput: _productionOutput, ...result } = job.result;
        job.result = result;
      }
      job.preparingPilot = job.status === "submitting" && (data.job.input?._desaynclaw?.nanoElements && data.job.processor === "legacy" || data.job.model !== (job.whiteElements ? REFINE_MODEL : GUIDED_CUTOUT_MODEL) || Date.now() - Date.parse(job.dispatch_started_at || job.created_at) < PILOT_PREPARATION_LIMIT_MS);
    }
    if (job.result?.enhancement?.items) job.result = { ...job.result, enhancement: { ...job.result.enhancement, items: job.result.enhancement.items.map(({ requestId: _requestId, outputUrl: _outputUrl, ...item }) => item) } };
    output = { ...data, job };
  }
  return Response.json(await serializeDesignData(output), { ...options, headers: { "Cache-Control": "private, no-store", ...options.headers } });
}
