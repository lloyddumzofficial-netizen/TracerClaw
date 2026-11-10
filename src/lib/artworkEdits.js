// Shared, provider-independent selection format. Coordinates refer to the source image.
export const MAX_EDIT_INSTRUCTIONS = 5;
export const MAX_EDIT_BODY_BYTES = 256 * 1024;
export const MAX_SELECTION_SHAPES = 40;
export const MAX_SELECTION_POINTS = 2000;
export const MAX_STROKE_POINTS = 400;
export const EDIT_MODEL = "fal-ai/nano-banana-2/edit";

export function isGarmentProject(project) {
  return Boolean(project && !["logo", "pattern", "upscale", "bg_remover", "bg-remover"].includes(project.trace_type));
}

export function isCompleteDesignProject(project) {
  if (!isGarmentProject(project) || project.trace_type === "mockup_erase" || project.ai_prompt === "ERASE_LOGOS") return false;
  return project.trace_type === "mockup_preserve" || project.ai_prompt === "PRESERVE_LOGOS"
    || (["standard", "mockup"].includes(project.trace_type) && !project.ai_prompt);
}

export function validateEditInstructions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_EDIT_INSTRUCTIONS) throw new Error("Add between 1 and 5 instructions.");
  let points = 0;
  const unit = n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return input.map((item, index) => {
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!prompt || prompt.length > 1000) throw new Error(`Instruction ${index + 1} needs 1–1,000 characters.`);
    if (!Array.isArray(item.shapes) || !item.shapes.length) throw new Error(`Select an area for instruction ${index + 1}.`);
    if (item.shapes.length > MAX_SELECTION_SHAPES) throw new Error(`Instruction ${index + 1} has too many strokes. Undo or clear its selection.`);
    if (item.shapes.filter(shape => shape.kind === "rect").length > 1) throw new Error("Use one rectangle per instruction. Add another instruction for a separate area.");
    const shapes = item.shapes.map(shape => {
      if (shape.kind === "rect") {
        if (![shape.x, shape.y, shape.width, shape.height].every(unit) || shape.width <= 0 || shape.height <= 0 || shape.x + shape.width > 1.000001 || shape.y + shape.height > 1.000001) throw new Error("Invalid rectangle selection.");
        return { kind: "rect", x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      }
      if (shape.kind !== "brush" || !unit(shape.radius) || shape.radius < .001 || shape.radius > .25 || !Array.isArray(shape.points) || !shape.points.length) throw new Error("Invalid brush selection.");
      points += shape.points.length;
      if (points > MAX_SELECTION_POINTS || shape.points.length > MAX_STROKE_POINTS) throw new Error("Selection is too complex. Simplify the brush strokes.");
      const path = shape.points.map(p => {
        if (!unit(p.x) || !unit(p.y)) throw new Error("Selection must stay inside the image.");
        return { x: p.x, y: p.y };
      });
      return { kind: "brush", points: path, radius: shape.radius, erase: shape.erase === true };
    });
    return { id: index + 1, prompt, shapes };
  });
}

export function nextSelectionShapes(shapes, shape) {
  // Redrawing a rectangle replaces the region; it never stacks more boxes.
  if (shape.kind === "rect") return [shape];
  if (shapes.length >= MAX_SELECTION_SHAPES) throw new Error("Selection limit reached. Undo or clear this area before adding more strokes.");
  return [...shapes, shape];
}

export function selectionPointCount(instructions) {
  return instructions.reduce((total, item) => total + item.shapes.reduce((count, shape) => count + (shape.kind === "brush" ? shape.points.length : 0), 0), 0);
}

export function shapeSvg(shape, width, height) {
  const color = shape.erase ? "black" : "white";
  if (shape.kind === "rect") return `<rect x="${shape.x * width}" y="${shape.y * height}" width="${shape.width * width}" height="${shape.height * height}" fill="white"/>`;
  const radius = shape.radius * width;
  const path = shape.points.map((p, i) => `${i ? "L" : "M"}${p.x * width},${p.y * height}`).join(" ");
  const first = shape.points[0];
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${radius * 2}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${first.x * width}" cy="${first.y * height}" r="${radius}" fill="${color}"/>`;
}

export function selectionSvg(shapes, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="black"/>${shapes.map(s => shapeSvg(s, width, height)).join("")}</svg>`;
}
