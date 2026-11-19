export const layerVisible = (layer, view = "composition") => layer.visibility?.[view === "layout" ? "overview" : "composition"] ?? layer.visible !== false;
export const alreadyUpscaled = layer => Boolean(layer?.enhancedVariant || layer?.enhancement || layer?.upscale?.state === "done");
