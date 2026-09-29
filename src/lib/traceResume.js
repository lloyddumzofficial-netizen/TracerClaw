// A saved raster is paid output. Continue the remaining stages without
// starting a second extraction or charging the base Claw again.
export function getTraceResumePlan(project, svgEngine = "standard") {
  const hasExtract = Boolean(project?.generated_image_url && project.generated_image_url !== "REFUNDED");
  const hasUpscale = Boolean(project?.upscaled_image_url);
  const hasSvg = Boolean(project?.svg_url);
  const resumeVectorization = hasUpscale && !hasSvg;
  const resumeUpscale = hasExtract && !hasUpscale && !hasSvg;
  const hasSavedOutput = resumeVectorization || resumeUpscale;

  return {
    resumeVectorization,
    resumeUpscale,
    creditCost: (hasSavedOutput ? 0 : 1) + (svgEngine === "precision" ? 1 : 0),
  };
}
