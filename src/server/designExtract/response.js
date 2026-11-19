import { serializeDesignData } from "./storage";

export async function designResponse(data, options = {}) {
  let output = data;
  if (data?.job) {
    const { input: _input, request_id, model: _model, idempotency_key: _key, processing_lease_token: _lease, processing_lease_until: _until, processor_run_id: _run, ...job } = data.job;
    job.canRecover = Boolean(request_id);
    if (job.result?.enhancement?.items) job.result = { ...job.result, enhancement: { ...job.result.enhancement, items: job.result.enhancement.items.map(({ requestId: _requestId, outputUrl: _outputUrl, ...item }) => item) } };
    output = { ...data, job };
  }
  return Response.json(await serializeDesignData(output), { ...options, headers: { "Cache-Control": "private, no-store", ...options.headers } });
}
