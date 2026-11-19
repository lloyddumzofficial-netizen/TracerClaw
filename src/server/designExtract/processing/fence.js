// A replaced workflow may finish an old HTTP request. It must not overwrite
// the replacement's checkpoint, including after its lease has expired.
export function fenceDesignJob(query, job) {
  if (job.processor !== 'workflow') return query;
  if (!job.processing_lease_token || !Number.isInteger(job.processor_generation)) {
    throw Object.assign(new Error('Processing lease must be renewed'), { status: 409, designExtractError: true });
  }
  return query.eq('processor_generation', job.processor_generation)
    .eq('processing_lease_token', job.processing_lease_token)
    .gt('processing_lease_until', new Date().toISOString());
}
