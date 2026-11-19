import {sleep,getWorkflowMetadata} from 'workflow';
import {advanceDesignWorkflowStep} from './designExtractSteps';

export async function processDesignExtract(jobId,generation) {
  'use workflow';
  const {workflowRunId}=getWorkflowMetadata();
  console.log('[Design Extract workflow] Started',{jobId,generation});
  let failures=0;
  for(let round=0;round<600;round++) {
    const result=await advanceDesignWorkflowStep(jobId,generation,workflowRunId);
    if(result.done) {console.log('[Design Extract workflow] Finished',{jobId,generation,outcome:result.outcome});return {outcome:result.outcome};}
    failures=result.retryable?failures+1:0;
    await sleep(Math.min(60000, Math.max(result.delayMs||5000,failures?5000*2**Math.min(failures,4):0)));
  }
  // The watchdog can fence and replace this run without repeating paid POSTs.
  console.warn('[Design Extract workflow] Wakeup budget reached',{jobId,generation});
  return {outcome:'watchdog_required'};
}
