const STAGE_RANGES = [[2, 34], [34, 67], [67, 96]];

// Display estimate only: provider completion is still controlled by the real job.
// Leave the end of each range for an actual stage transition, never a timer.
export function estimateProcessingProgress(elapsedSeconds, stageIndex = 0) {
  const index = Number.isFinite(stageIndex) ? Math.max(0, Math.min(2, Math.floor(stageIndex))) : 0;
  const [start, end] = STAGE_RANGES[index];
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  return Math.min(end - 1, Math.floor(start + (end - start) * (1 - Math.exp(-elapsed / 18))));
}
