import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import sportsTshirtTemplate from "@/features/mockup-studio/templates/sports-tshirt-v1.json";
import poloJerseyTemplate from "@/features/mockup-studio/templates/polo-jersey-v1.json";
import { normalizeMockupColors } from "@/features/mockup-studio/config";
import { fetchWithSSRFProtection, getAllowedStorageHosts } from "@/lib/ssrf";

const OUTPUT_WIDTH = 1024;
const OUTPUT_HEIGHT = 1280;
const TEMPLATE_BY_GARMENT = Object.freeze({
  sports_tshirt: sportsTshirtTemplate,
  polo_jersey: poloJerseyTemplate,
});

const COLOR_ROLE = Object.freeze({
  collar: "collar",
  placket: "placket",
  left_cuff: "leftCuff",
  right_cuff: "rightCuff",
});

function publicFile(resourcePath) {
  return path.join(process.cwd(), "public", resourcePath.replace(/^\/+/, ""));
}

function artworkRole(partRole, view) {
  if (partRole === "body" || partRole === "body_bleed") return view;
  return partRole;
}

function partBounds(part, width, height) {
  const left = Math.max(0, Math.round(width * part.left / 100));
  const top = Math.max(0, Math.round(height * part.top / 100));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(width * part.width / 100))),
    height: Math.max(1, Math.min(height - top, Math.round(height * part.height / 100))),
  };
}

async function applyMask(input, maskPath, width, height) {
  const mask = await sharp(publicFile(maskPath))
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp(input)
    .ensureAlpha()
    .resize(width, height, { fit: "cover", position: "centre" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function loadArtwork(asset, cache) {
  if (!asset?.file_url) return null;
  if (!cache.has(asset.file_url)) {
    cache.set(asset.file_url, fetchWithSSRFProtection(asset.file_url, {
      allowedHosts: getAllowedStorageHosts(),
      maxBytes: 30 * 1024 * 1024,
      allowedContentTypes: ["image/", "application/octet-stream"],
    }).then(result => result.buffer));
  }
  return cache.get(asset.file_url);
}

function backdropSvg(colors) {
  const presetOpacity = {
    cinematic_gradient: 0.48,
    team_color_glow: 0.68,
    blackout: 0.18,
    brushed_studio: 0.34,
  }[colors.backdropPreset] || 0.48;
  return Buffer.from(`
    <svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="43%" r="68%">
          <stop offset="0%" stop-color="${colors.backdrop}" stop-opacity="${presetOpacity}"/>
          <stop offset="58%" stop-color="#080b0e" stop-opacity="0.96"/>
          <stop offset="100%" stop-color="#030405"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="#030405"/>
      <rect width="100%" height="100%" fill="url(#bg)"/>
    </svg>
  `);
}

/**
 * Builds a source-locked product view. Uploaded pixels are fitted into the
 * exported PSD masks; no generative model can redraw text, logos or colors.
 */
export async function renderSourceLockedView({ assets, colors: inputColors, garmentType, view }) {
  const template = TEMPLATE_BY_GARMENT[garmentType];
  const viewTemplate = template?.views?.[view];
  if (!viewTemplate || !["front", "back"].includes(view)) {
    throw new Error(`A source-locked ${view} template is unavailable for ${garmentType}.`);
  }

  const colors = normalizeMockupColors(inputColors);
  const basePath = publicFile(viewTemplate.base);
  const base = await readFile(basePath);
  const metadata = await sharp(base).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("The garment master has invalid dimensions.");

  const assetByRole = new Map(assets.map(asset => [asset.role, asset]));
  const assetCache = new Map();
  const layers = [];

  for (const [partRole, part] of Object.entries(viewTemplate.parts)) {
    const bounds = partBounds(part, width, height);
    const colorKey = COLOR_ROLE[partRole];
    let input;
    if (colorKey) {
      input = await sharp({
        create: { width: bounds.width, height: bounds.height, channels: 4, background: colors[colorKey] },
      }).png().toBuffer();
    } else {
      input = await loadArtwork(assetByRole.get(artworkRole(partRole, view)), assetCache);
    }
    if (!input) continue;
    layers.push({
      input: await applyMask(input, part.mask, bounds.width, bounds.height),
      left: bounds.left,
      top: bounds.top,
    });
  }

  const mappedArtwork = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(layers).png().toBuffer();

  const garment = await sharp(mappedArtwork)
    .composite([{ input: base, blend: "multiply" }])
    .png()
    .toBuffer();
  const fittedGarment = await sharp(garment)
    .resize({ width: 900, height: 1170, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp(backdropSvg(colors))
    .composite([{ input: fittedGarment, gravity: "centre" }])
    .png()
    .toBuffer();
}
