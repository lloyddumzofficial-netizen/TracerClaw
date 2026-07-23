import DOMPurify from "dompurify";

export const MAX_SWATCHES = 512;
export const MAX_CLUSTER_CHILDREN = 12;
export const MAX_BITMAP_EXPORT_SIDE = 4096;
export const QUICK_COLORS = ["#ffd700", "#ffffff", "#111111", "#c1121f", "#0b4f9c", "#00a86b", "#ff7a00", "#7c3aed"];
export const DEFAULT_BUBBLE_LAYOUT = [
  { x: 58, y: 12, size: 118 },
  { x: 8, y: 14, size: 96 },
  { x: 32, y: 42, size: 96 },
  { x: 8, y: 60, size: 78 },
  { x: 84, y: 64, size: 64 },
];

export function expandHex(value) {
  const hex = value.replace("#", "").trim().toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex.split("").map(ch => ch + ch).join("")}`;
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return null;
}

function rgbToHex(value) {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(",").map(part => part.trim());
  const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
  if (Number.isFinite(alpha) && alpha <= 0) return null;

  const channels = parts.slice(0, 3).map(part => {
    const num = part.endsWith("%") ? Math.round((Number(part.replace("%", "")) / 100) * 255) : Number(part);
    return Math.max(0, Math.min(255, Math.round(num || 0)));
  });

  return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeColor(value) {
  if (!value) return null;
  const color = value.trim().toLowerCase();
  if (!color || color === "none" || color === "transparent" || color === "currentcolor" || color === "inherit") return null;
  if (color.startsWith("url(") || color.includes("var(")) return null;
  if (color.startsWith("#")) return expandHex(color);
  if (color.startsWith("rgb")) return rgbToHex(color);
  return null;
}

export function extractPalette(svgText) {
  const counts = new Map();
  const rawValues = new Map();
  const add = (rawColor) => {
    const color = normalizeColor(rawColor);
    if (!color) return;
    counts.set(color, (counts.get(color) || 0) + 1);
    if (!rawValues.has(color)) rawValues.set(color, new Set());
    rawValues.get(color).add(rawColor.trim());
  };

  for (const match of svgText.matchAll(/(?:fill|stroke|stop-color)\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
  for (const match of svgText.matchAll(/(?:fill|stroke|stop-color)\s*:\s*([^;"'}]+)/gi)) add(match[1]);

  return [...counts.entries()]
    .map(([color, count]) => ({ color, count, rawValues: [...(rawValues.get(color) || [])] }))
    .sort((a, b) => b.count - a.count);
}

function serializeSvgDocument(document) {
  return new XMLSerializer().serializeToString(document.documentElement);
}

function updatePaintStyle(styleText, targetColors, nextColor) {
  return styleText.replace(/(^|;)\s*(fill|stroke|stop-color)\s*:\s*([^;]+)/gi, (match, prefix, prop, value) => {
    const color = normalizeColor(value);
    if (!color || !targetColors.has(color)) return match;
    return `${prefix}${prop}:${nextColor}`;
  });
}

export function replacePaletteColor(svgText, paletteItem, nextColor) {
  if (!svgText || !paletteItem || !/^#[0-9a-f]{6}$/i.test(nextColor)) return svgText;
  if (typeof DOMParser === "undefined") return svgText;

  const targetColors = new Set([paletteItem.color, ...(paletteItem.rawValues || [])]
    .map(value => normalizeColor(value))
    .filter(Boolean));
  if (targetColors.size === 0) return svgText;

  const parser = new DOMParser();
  const document = parser.parseFromString(svgText, "image/svg+xml");
  if (document.querySelector("parsererror")) return svgText;

  document.querySelectorAll("*").forEach((element) => {
    ["fill", "stroke", "stop-color"].forEach((attr) => {
      const color = normalizeColor(element.getAttribute(attr));
      if (color && targetColors.has(color)) element.setAttribute(attr, nextColor);
    });

    const style = element.getAttribute("style");
    if (style) {
      const nextStyle = updatePaintStyle(style, targetColors, nextColor);
      if (nextStyle !== style) element.setAttribute("style", nextStyle);
    }
  });

  document.querySelectorAll("style").forEach((styleElement) => {
    const text = styleElement.textContent || "";
    const nextText = updatePaintStyle(text, targetColors, nextColor);
    if (nextText !== text) styleElement.textContent = nextText;
  });

  return serializeSvgDocument(document);
}

export function hexToRgb(hex) {
  const clean = expandHex(hex);
  if (!clean) return null;
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

export function colorDistance(a, b) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return 999;
  return Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getClusterChildPosition(index) {
  const positions = [
    { left: 48, top: 18 },
    { left: 30, top: 27 },
    { left: 66, top: 27 },
    { left: 17, top: 45 },
    { left: 48, top: 44 },
    { left: 79, top: 45 },
    { left: 30, top: 63 },
    { left: 66, top: 63 },
    { left: 12, top: 76 },
    { left: 48, top: 79 },
    { left: 84, top: 76 },
    { left: 48, top: 72 },
  ];
  if (positions[index]) return positions[index];

  const angle = index * 2.399963229728653;
  const radius = 18 + (index % 6) * 4;
  return {
    left: clamp(50 + Math.cos(angle) * radius, 18, 82),
    top: clamp(50 + Math.sin(angle) * radius, 18, 82),
  };
}

function scaleSvgToContainer(svgText) {
  return svgText.replace(/<svg([^>]*?)>/i, (_, attrs) => {
    const clean = attrs
      .replace(/\s+width=["'][^"']*["']/gi, "")
      .replace(/\s+height=["'][^"']*["']/gi, "")
      .replace(/\s+preserveAspectRatio=["'][^"']*["']/gi, "")
      .replace(/\s+style=["'][^"']*["']/gi, "");

    return `<svg${clean} style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">`;
  });
}

export function sanitizeSvg(svgText) {
  return DOMPurify.sanitize(scaleSvgToContainer(svgText), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onbegin", "onend"],
  });
}

export function getSvgDimensions(svgText) {
  const svgTag = svgText.match(/<svg\b[^>]*>/i)?.[0] || "";
  const viewBox = svgTag.match(/viewBox=["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const nums = viewBox.split(/\s+/).map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite)) {
      return { width: Math.max(1, Math.round(nums[2])), height: Math.max(1, Math.round(nums[3])) };
    }
  }
  const width = svgTag.match(/\swidth=["']([^"']+)["']/i)?.[1]?.replace(/px/i, "");
  const height = svgTag.match(/\sheight=["']([^"']+)["']/i)?.[1]?.replace(/px/i, "");
  if (width && height) {
    return {
      width: Math.max(1, Math.round(parseFloat(width))),
      height: Math.max(1, Math.round(parseFloat(height))),
    };
  }
  return null;
}

export function getSvgSize(svgText) {
  const dimensions = getSvgDimensions(svgText);
  if (dimensions) return `${dimensions.width} x ${dimensions.height} px`;
  return "SVG vector";
}

export function prepareSvgForBitmap(svgText, width, height) {
  return svgText.replace(/<svg([^>]*?)>/i, (_, attrs) => {
    const clean = attrs
      .replace(/\s+width=["'][^"']*["']/gi, "")
      .replace(/\s+height=["'][^"']*["']/gi, "");
    const xmlns = /\sxmlns=["']/i.test(clean) ? "" : ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${clean}${xmlns} width="${width}" height="${height}">`;
  });
}
