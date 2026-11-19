import {advanceDesignWorkflowJob} from '@/server/designExtract/processing/worker';

export async function advanceDesignWorkflowStep(jobId,generation,runId) {
  'use step';
  console.log('[Design Extract workflow] Checking saved operation',{jobId,generation});
  return advanceDesignWorkflowJob(jobId,generation,runId);
}
// Database and provider submission markers, rather than framework retries,
// decide whether a side effect can run. Safe transient failures return a delay.
advanceDesignWorkflowStep.maxRetries=3;
