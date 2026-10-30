export function getProjectWorkspacePath(project) {
  const id = encodeURIComponent(project.id);
  if (project.trace_type === "upscale") return `/upscale?projectId=${id}`;
  if (project.trace_type === "bg_remover") return `/bg-remover/${id}`;
  return `/workspace/${id}`;
}
