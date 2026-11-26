import sharp from "sharp";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";

const columns = 3;
const rows = 3;

export function canAutoAcceptNanoLayers(job, project) {
  return Boolean(job?.status === "ready" && job.kind === "extract" && job.processor === "local" &&
    job.input?._desaynclaw?.nanoElements && job.result?.layers?.length && project?.manifest &&
    job.base_revision === project.revision &&
    !(job.result.replaceExtraction && project.manifest.layers.length));
}

function whitenBackdrop(data, { width, height, channels }) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let length = 0;
  const add = index => {
    const p = index * channels;
    if (visited[index] || Math.min(data[p], data[p + 1], data[p + 2]) < 244) return;
    visited[index] = 1;
    queue[length++] = index;
  };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add((y + 1) * width - 1); }
  for (let head = 0; head < length; head++) {
    const i = queue[head], p = i * channels, x = i % width;
    data[p] = data[p + 1] = data[p + 2] = 255;
    if (x > 0) add(i - 1);
    if (x + 1 < width) add(i + 1);
    if (i >= width) add(i - width);
    if (i + width < total) add(i + width);
  }
}

export function nanoElementInput(sourceUrl, layout = "grid", sourceAspect = null) {
  const panels = layout === "columns";
  return {
    image_urls: [sourceUrl],
    prompt: [
      "Perform conservative image extraction for a sublimation print designer. This is a reproduction and separation task. Do not design, complete, embellish or reinterpret anything.",
      panels
        ? "The reference contains exactly THREE independent tall crops already separated by two vertical white gutters. The left crop has ONLY the left panel, the middle crop has ONLY the ornament, the right crop has ONLY the right panel. Edit each crop in place. Do not duplicate a crop or move artwork between columns. Preserve the heights and column centers."
        : "Before rendering, inventory the top, middle, bottom, and all sides of the reference. Count independent subjects, secondary motifs, and removable decorative graphics. A three-item summary is incomplete when more reusable elements are visible. Use up to eight foreground cells with distinct assets, including smaller motifs, rather than stopping after the largest subjects.",
      ...(!panels ? [
        "Keep separately placed subjects separate even if they are the same kind or overlap: a large fish near the top edge and a smaller school elsewhere are two assets, while the school stays together. An element partially obscured by another graphic or cut by the edge still qualifies. Keep its visible silhouette without inventing parts beyond the source.",
        "Look for reusable scene accents as well as subjects. A stylized wave with foam, a defined sun with its rays, a small cluster of flying birds, or an intentional stripe or pattern panel can qualify as its own asset when visible. Keep coherent parts together, such as a wave and its own foam or a sun and its rays. Skip plain backdrop fill and generic texture.",
        "After placing the foreground subjects, inspect the lower half again before leaving the last row blank. A clearly shaped curling wave is standalone artwork even when it touches other water or occupies a large area. If visible, isolate a complete crest and its foam in one cell. If a visually distinct ribbon stripe or framed pattern panel is visible, use another cell for it.",
        "Use the bottom-right cell (row 3, column 3) only for a separate full rectangular background plate. Remove the dominant subjects, logos, vehicles, animals and badges. Reconstruct the backdrop visibly implied behind them without holes. Keep its original framing, water, scenery, gradients, decorative stripes and base patterns where present. A wave or sun can also be provided separately as a reusable asset. Do not leave the background cell blank for a colored or illustrated design.",
        ...(sourceAspect ? [`Keep the background rectangle at the source width-to-height ratio of approximately ${sourceAspect.toFixed(3)}, surrounded by clean white space so all four edges are visible.`] : []),
        "Before finishing, compare your sheet with your inventory. Use an empty foreground cell to add an omitted visible element. Prioritize distinct subjects and clearly outlined decoration if more than eight foreground assets qualify.",
      ] : []),
      "For other layouts, keep whole logos, badges, wordmarks, connected illustrations and their intentional details together. Do not take multiple samples from a single assembly. Do not fill the sheet with variants, mirrored duplicates, invented wings, flourishes, or pieces clipped from a larger design. A graphic running off the source edge stays exactly as visibly cropped there. Leave extra slots empty even when only one asset is present.",
      panels
        ? "Output one square image in the exact same three-column, one-row layout. Keep the white gutters clear, leave white margins around each asset, and remove all original dark background within each crop while preserving dark ink inside the graphic."
        : "Output one square image with a strict invisible grid of exactly 3 equally sized columns and 3 equally sized rows. Place foreground graphics in the first eight cells, one per cell, and the full background in the ninth. Center each asset within its cell, with at least 8% pure white padding on every side. Leave unused foreground cells pure white. No visible grid lines, frames, labels, numbers, headings, mockups, collages, or drop shadows. Never cross a cell boundary.",
      "Put every asset on solid pure white #FFFFFF. Treat this as carefully cutting and pasting the visible pixels onto white paper. Remove only the backdrop and shadows outside each asset. Preserve intentional dark ink, every existing curve and motif, exact colors, aspect ratio, spelling and orientation. Do not redraw the original curves or turn them into different shapes. Scale each complete asset uniformly as large as the cell padding allows. Before finishing, check that every copied item has the same silhouette and details as its location in the reference.",
    ].join("\n"),
    aspect_ratio: "1:1", num_images: 1, resolution: "4K", output_format: "png",
    limit_generations: true, thinking_level: "medium", enable_web_search: false,
  };
}

export async function nanoColumnGuide(source, { withBackdrop = false } = {}) {
  const { data, info } = await sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).toColourspace("srgb")
    .ensureAlpha().resize({ width: 750, height: 1200, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (height < width * 1.25 || width < 120) return null;
  const colors = new Map();
  let mode = 0, most = 0, samples = 0;
  for (let y = 0; y < height; y += 4) for (let x = Math.floor(width * .34); x < width * .66; x += 4) {
    const p = (y * width + x) * 4;
    if (data[p + 3] < 250) continue;
    const color = data[p] * 65536 + data[p + 1] * 256 + data[p + 2];
    const count = (colors.get(color) || 0) + 1;
    colors.set(color, count); samples++;
    if (count > most) { most = count; mode = color; }
  }
  if (most < samples * .45 || samples < width * height * .012) return null;
  const r = mode >> 16, g = mode >> 8 & 255, b = mode & 255;
  const ink = new Uint16Array(width);
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p += 4) {
    if (data[p + 3] >= 250 && Math.max(Math.abs(data[p] - r), Math.abs(data[p + 1] - g), Math.abs(data[p + 2] - b)) > 16) ink[x]++;
  }
  const gaps = [];
  let start = -1;
  for (let x = Math.floor(width * .32); x <= Math.ceil(width * .68); x++) {
    if (ink[x] <= height * .009) { if (start < 0) start = x; continue; }
    if (start >= 0 && x - start >= width * .012) gaps.push((start + x) >>> 1);
    start = -1;
  }
  const sides = [gaps.filter(x => x < width * .49).at(-1), gaps.find(x => x > width * .51)];
  if (sides.some(x => x === undefined) || sides[1] - sides[0] > width * .23 ||
      !ink.slice(sides[0], sides[1]).some(value => value > height * .12)) return null;
  const bounds = [0, ...sides, width];
  const size = 1536;
  const tiles = await Promise.all(bounds.slice(0, -1).map(async (x, index) => {
    const { data: bytes } = await sharp(data, { raw: info }).extract({ left: x, top: 0, width: bounds[index + 1] - x, height })
      .resize({ width: 470, height: 1420, fit: "contain", background: "#FFFFFF" }).png().toBuffer({ resolveWithObject: true });
    return { input: bytes, top: 58, left: index * 512 + 21 };
  }));
  const guide = await sharp({ create: { width: size, height: size, channels: 3, background: "#FFFFFF" } }).composite(tiles).png().toBuffer();
  return withBackdrop ? { guide, backdrop: { r, g, b } } : guide;
}

export async function splitNanoElements(bytes, layout = "grid", sourceAspect = null) {
  const sheet = sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  const metadata = await sheet.metadata();
  validateDesignImage(metadata);
  if (!["jpeg", "png", "webp"].includes(metadata.format) || metadata.pages > 1 || Math.abs(metadata.width / metadata.height - 1) > .03) {
    throw Object.assign(new Error("The artwork sheet did not use the expected square layout."), { status: 422, designExtractError: true });
  }
  const { data, info } = await sheet.toColourspace("srgb").flatten({ background: "#FFFFFF" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let tiles = [];
  let clipped = 0;
  const rowCount = layout === "columns" ? 1 : rows;
  const horizontalInk = new Uint32Array(height);
  if (layout !== "columns") {
    for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p += channels) {
      if (Math.min(data[p], data[p + 1], data[p + 2]) < 239) horizontalInk[y]++;
    }
  }
  const rowEdges = sheetEdges(height, rowCount, horizontalInk);
  for (let row = 0; row < rowCount; row++) {
    const y0 = rowEdges[row], y1 = rowEdges[row + 1];
    const verticalInk = new Uint32Array(width);
    if (layout !== "columns") {
      for (let y = y0; y < y1; y++) for (let x = 0, p = y * width * channels; x < width; x++, p += channels) {
        if (Math.min(data[p], data[p + 1], data[p + 2]) < 239) verticalInk[x]++;
      }
    }
    const columnEdges = sheetEdges(width, columns, verticalInk);
    for (let column = 0; column < columns; column++) {
      const x0 = columnEdges[column], x1 = columnEdges[column + 1];
      let left = x1, top = y1, right = -1, bottom = -1, ink = 0, edgeInk = 0;
      const border = Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) * (layout === "columns" ? .025 : .006)));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = (y * width + x) * channels;
        if (Math.min(data[p], data[p + 1], data[p + 2]) >= 239) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        ink++;
        const nearEdge = layout === "columns"
          ? column > 0 && x < x0 + border || column < columns - 1 && x >= x1 - border
          : x < x0 + border || x >= x1 - border || y < y0 + border || y >= y1 - border;
        if (nearEdge) edgeInk++;
      }
      if (ink < Math.max(16, (x1 - x0) * (y1 - y0) * .00012)) continue;
      if (edgeInk > Math.max(5, border * .35)) { clipped++; continue; }
      const slot = row * columns + column + 1;
      const artWidth = right - left + 1, artHeight = bottom - top + 1;
      const background = sourceAspect && layout === "grid" && slot === 9 &&
        Math.abs(artWidth / artHeight / sourceAspect - 1) < .16 && ink > artWidth * artHeight * .70 &&
        hasRectangularEdges(data, info, { left, top, width: artWidth, height: artHeight });
      const padding = background ? 0 : Math.max(6, Math.round(Math.max(artWidth, artHeight) * .035));
      const bounds = {
        left: Math.max(x0, left - padding), top: Math.max(y0, top - padding),
        width: Math.min(x1, right + padding + 1) - Math.max(x0, left - padding),
        height: Math.min(y1, bottom + padding + 1) - Math.max(y0, top - padding),
      };
      tiles.push({ slot, bounds, ...(background && { background: true }) });
    }
  }
  if (clipped && sourceAspect && layout === "grid") {
    const recovered = await recoverSeparatedGraphics(data, info, sourceAspect);
    if (recovered.length > tiles.length || recovered.length === tiles.length &&
        recovered.some(tile => tile.background) && !tiles.some(tile => tile.background)) {
      clipped = 0;
      tiles = recovered;
    }
  }
  const elements = [];
  for (const { slot, bounds, background } of tiles) {
    const crop = await sharp(data, { raw: info }).extract(bounds).raw().toBuffer({ resolveWithObject: true });
    if (!background) whitenBackdrop(crop.data, crop.info);
    const png = await sharp(crop.data, { raw: crop.info }).png().toBuffer();
    elements.push({ slot, width: bounds.width, height: bounds.height, bytes: png, ...(background && { background: true }) });
  }
  return { elements, clipped };
}

async function recoverSeparatedGraphics(data, info, sourceAspect) {
  const preview = await sharp(data, { raw: info }).resize(720, 720, { fit: "inside", withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = preview.info;
  const count = width * height;
  const ink = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += channels) {
    ink[i] = Math.min(preview.data[p], preview.data[p + 1], preview.data[p + 2]) < 235 ? 1 : 0;
  }
  const queue = new Int32Array(count), components = [];
  for (let i = 0; i < count; i++) {
    if (!ink[i]) continue;
    let length = 1, left = width, top = height, right = -1, bottom = -1;
    queue[0] = i; ink[i] = 0;
    for (let head = 0; head < length; head++) {
      const index = queue[head], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const next = ny * width + nx;
          if (!ink[next]) continue;
          ink[next] = 0; queue[length++] = next;
        }
      }
    }
    if (length >= Math.max(5, count * .00004)) components.push({ left, top, right, bottom, area: length });
  }
  if (components.length > 300) return [];
  components.sort((a, b) => b.area - a.area);
  const graphics = [];
  const cell = box => Math.floor((box.top + box.bottom) * rows / (2 * height)) * columns +
    Math.floor((box.left + box.right) * columns / (2 * width));
  for (const component of components) {
    const parent = graphics.find(({ anchor: box }) => {
      const large = count * .004;
      if (box.area >= large && component.area >= large) return false;
      const dx = Math.max(0, box.left - component.right, component.left - box.right);
      const dy = Math.max(0, box.top - component.bottom, component.top - box.bottom);
      const near = box.area >= large ? .023 : .065;
      return dx === 0 && dy === 0 || cell(box) === cell(component) && Math.hypot(dx, dy) < width * near;
    });
    if (parent) {
      parent.left = Math.min(parent.left, component.left); parent.top = Math.min(parent.top, component.top);
      parent.right = Math.max(parent.right, component.right); parent.bottom = Math.max(parent.bottom, component.bottom);
      parent.area += component.area;
    } else graphics.push({ ...component, anchor: component });
  }
  return graphics.filter(box => box.area >= Math.max(24, count * .00045) &&
    box.right - box.left < width * .7 && box.bottom - box.top < height * .7
  ).sort((a, b) => cell(a) - cell(b) || a.left - b.left).slice(0, 9).map((box, index) => {
    const sx = info.width / width, sy = info.height / height;
    const left = Math.floor(box.left * sx), top = Math.floor(box.top * sy);
    const right = Math.min(info.width, Math.ceil((box.right + 1) * sx));
    const bottom = Math.min(info.height, Math.ceil((box.bottom + 1) * sy));
    const core = { left, top, width: right - left, height: bottom - top };
    const background = cell(box) === 8 && Math.abs(core.width / core.height / sourceAspect - 1) < .20 &&
      hasRectangularEdges(data, info, core);
    const margin = background ? 0 : Math.max(4, Math.round(Math.min(sx, sy) * .8));
    const x = Math.max(0, left - margin), y = Math.max(0, top - margin);
    return {
      slot: index + 1, ...(background && { background: true }),
      bounds: { left: x, top: y, width: Math.min(info.width, right + margin) - x, height: Math.min(info.height, bottom + margin) - y },
    };
  });
}

function hasRectangularEdges(data, info, box) {
  const ink = (x, y) => {
    const p = (y * info.width + x) * info.channels;
    return Math.min(data[p], data[p + 1], data[p + 2]) < 239;
  };
  const x = box.left + Math.floor(box.width * .035);
  const right = box.left + box.width - 1 - Math.floor(box.width * .035);
  const y = box.top + Math.floor(box.height * .035);
  const bottom = box.top + box.height - 1 - Math.floor(box.height * .035);
  let topInk = 0, bottomInk = 0, leftInk = 0, rightInk = 0;
  for (let i = 0; i < 16; i++) {
    const sampleX = Math.round(x + (right - x) * i / 15);
    const sampleY = Math.round(y + (bottom - y) * i / 15);
    topInk += Number(ink(sampleX, y));
    bottomInk += Number(ink(sampleX, bottom));
    leftInk += Number(ink(x, sampleY));
    rightInk += Number(ink(right, sampleY));
  }
  return Math.min(topInk, bottomInk, leftInk, rightInk) >= 12;
}

function sheetEdges(length, count, ink) {
  const cell = length / count;
  const radius = Math.max(2, Math.round(cell * .006));
  const search = Math.max(radius, Math.floor(cell * .12));
  const edges = [0];
  for (let i = 1; i < count; i++) {
    const expected = Math.round(i * cell);
    let edge = expected, start = expected - search, best = Infinity;
    for (let position = start; position <= expected + search + 1; position++) {
      if (position <= expected + search && !ink[position]) continue;
      if (position - start >= radius * 2 + 1) {
        const candidate = Math.max(start + radius, Math.min(expected, position - radius - 1));
        const distance = Math.abs(candidate - expected);
        if (distance < best) { edge = candidate; best = distance; }
      }
      start = position + 1;
    }
    edges.push(edge);
  }
  return [...edges, length];
}
