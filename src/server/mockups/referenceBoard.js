import sharp from "sharp";
import { fetchWithSSRFProtection, getAllowedStorageHosts } from "@/lib/ssrf";
import { normalizeMockupColors } from "@/features/mockup-studio/config";

const PANEL_LAYOUT = Object.freeze({
  front: { left: 50, top: 130, width: 690, height: 1160, label: "FRONT BODY" },
  back: { left: 760, top: 130, width: 690, height: 1160, label: "BACK BODY" },
  left_sleeve: { left: 1470, top: 130, width: 480, height: 480, label: "LEFT SLEEVE" },
  right_sleeve: { left: 1470, top: 630, width: 480, height: 480, label: "RIGHT SLEEVE" },
});

export function getProductionReferenceSwatches(garmentType, colors) {
  return [
    ["COLLAR", colors.collar],
    ...(garmentType === "polo_jersey" ? [["PLACKET", colors.placket]] : []),
    ["LEFT CUFF", colors.leftCuff],
    ["RIGHT CUFF", colors.rightCuff],
  ];
}

function boardSvg(colors, garmentLabel, garmentType) {
  const swatches = getProductionReferenceSwatches(garmentType, colors);
  return Buffer.from(`<svg width="2000" height="1400" xmlns="http://www.w3.org/2000/svg">
    <rect width="2000" height="1400" fill="#080808"/>
    <text x="50" y="52" fill="#f2f2f2" font-family="Arial" font-size="26" font-weight="700">DESAYNCLAW PRODUCTION REFERENCE</text>
    <text x="50" y="84" fill="#777" font-family="Arial" font-size="16">${garmentLabel} · fixed artwork maps · selector-authoritative trim colors</text>
    ${Object.values(PANEL_LAYOUT).map(frame => `<rect x="${frame.left}" y="${frame.top}" width="${frame.width}" height="${frame.height}" rx="10" fill="#111" stroke="#343434"/><text x="${frame.left + 18}" y="${frame.top + 34}" fill="#bdbdbd" font-family="Arial" font-size="15" font-weight="700">${frame.label}</text>`).join("")}
    <rect x="1470" y="1130" width="480" height="160" rx="10" fill="#111" stroke="#343434"/>
    ${swatches.map(([label, color], index) => `<rect x="${1490 + (index % 2) * 225}" y="${1152 + Math.floor(index / 2) * 62}" width="34" height="34" rx="4" fill="${color}" stroke="#666"/><text x="${1536 + (index % 2) * 225}" y="${1174 + Math.floor(index / 2) * 62}" fill="#ddd" font-family="Arial" font-size="13" font-weight="700">${label}</text><text x="${1536 + (index % 2) * 225}" y="${1192 + Math.floor(index / 2) * 62}" fill="#777" font-family="Arial" font-size="11">${color}</text>`).join("")}
    <text x="50" y="1360" fill="#666" font-family="Arial" font-size="14">Use as production authority. Do not copy this board layout, labels, frames or typography into the final photograph.</text>
  </svg>`);
}

export async function createProductionReferenceBoard({ assets, colors, garmentLabel, garmentType }) {
  const safeColors = normalizeMockupColors(colors);
  const required = Object.keys(PANEL_LAYOUT).map(role => assets.find(asset => asset.role === role)).filter(Boolean);
  if (required.length !== Object.keys(PANEL_LAYOUT).length) throw new Error("Production reference board requires all four artwork panels.");

  const overlays = await Promise.all(required.map(async asset => {
    const frame = PANEL_LAYOUT[asset.role];
    const fetched = await fetchWithSSRFProtection(asset.file_url, {
      allowedHosts: getAllowedStorageHosts(),
      maxBytes: 30 * 1024 * 1024,
      allowedContentTypes: ["image/"],
    });
    if (!fetched.response.ok) throw new Error(`Could not load ${asset.role} for the production reference board.`);
    const input = await sharp(fetched.buffer).resize(frame.width - 28, frame.height - 70, {
      fit: "contain", background: { r: 10, g: 10, b: 10, alpha: 1 },
    }).png().toBuffer();
    return { input, left: frame.left + 14, top: frame.top + 52 };
  }));

  return sharp(boardSvg(safeColors, garmentLabel, garmentType)).composite(overlays).png({ compressionLevel: 9 }).toBuffer();
}
