function parseSvgLength(value) {
  const match = String(value || "").trim().match(/^([0-9]*\.?[0-9]+)(?:px)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Makes an SVG fit a preview without changing the document's own geometry.
 *
 * Some vector providers intentionally return a square viewBox together with a
 * portrait width/height and preserveAspectRatio="none". Removing those root
 * attributes changes the artwork's coordinate mapping and visibly warps it.
 * Keep the intrinsic dimensions and provider mapping; CSS max constraints then
 * scale the complete SVG proportionally inside the preview surface.
 */
export function scaleSvgToContainer(svgText) {
  return String(svgText || "").replace(/<svg([^>]*?)>/i, (_, attrs) => {
    const widthMatch = attrs.match(/\swidth=["']([^"']+)["']/i);
    const heightMatch = attrs.match(/\sheight=["']([^"']+)["']/i);
    const viewBoxMatch = attrs.match(/\sviewBox=["']([^"']+)["']/i);
    const width = parseSvgLength(widthMatch?.[1]);
    const height = parseSvgLength(heightMatch?.[1]);
    let clean = attrs.replace(/\s+style=["'][^"']*["']/gi, "");

    if (!viewBoxMatch && width && height) {
      clean += ` viewBox="0 0 ${width} ${height}"`;
    }

    const sizing = width && height
      ? "width:auto;height:auto;max-width:100%;max-height:100%;display:block;flex:none;"
      : "width:100%;height:100%;display:block;";

    return `<svg${clean} style="${sizing}">`;
  });
}
