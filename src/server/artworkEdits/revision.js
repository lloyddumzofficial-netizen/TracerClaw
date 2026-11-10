// A slow pre-edit upscale/vector request must not attach itself to newer artwork.
// Old deployments without migration 036 keep their established query shape.
export function guardArtworkRevision(query, project) {
  return Number.isInteger(project.artwork_revision) ? query.eq("artwork_revision", project.artwork_revision) : query;
}
