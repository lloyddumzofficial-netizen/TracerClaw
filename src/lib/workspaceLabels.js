export function getWorkspaceTitle(traceType) {
  if (traceType === "logo") return "LOGO WORKSPACE";
  if (traceType === "bg_remover") return "BG REMOVER STUDIO";
  if (traceType === "upscale") return "UPSCALE STUDIO";
  return "GARMENT WORKSPACE";
}

export function getWorkspaceLabel(traceType) {
  if (traceType === "logo") return "Logo Workspace";
  if (traceType === "bg_remover") return "BG Remover Studio";
  if (traceType === "upscale") return "Upscale Studio";
  return "Garment Workspace";
}
