// Generated object names contain their upload timestamp. This prevents a new
// attempt from being settled against an older output on the same project.
export function getRecoverableAttemptOutput(attempt, project) {
  const operation = attempt?.operation;
  const url = operation === 'trace' ? project?.generated_image_url
    : operation === 'precision_svg' ? project?.svg_url : null;
  if (!url || url === 'REFUNDED') return null;
  const createdAtMs = Date.parse(attempt?.created_at || attempt?.attempt_created_at || '');
  if (!Number.isFinite(createdAtMs)) return null;
  const filePattern = operation === 'trace' ? /\/generated_flat_(\d{13})\.[^/]+$/
    : /\/vector_(\d{13})\.svg$/;
  let filename;
  try { filename = new URL(url).pathname; } catch { return null; }
  const savedAtMs = Number(filename.match(filePattern)?.[1]);
  return Number.isFinite(savedAtMs) && savedAtMs >= createdAtMs - 5_000 ? url : null;
}
