import { getGarmentParts } from "../garmentCatalog";
import { getPanelPreparationSpec } from "../panelPreparation/panelSpecs";

function rgb(hex) {
  const value = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
}

function colorDistance(left, right) {
  const a = rgb(left);
  const b = rgb(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.sqrt(a.reduce((sum, channel, index) => sum + ((channel - b[index]) ** 2), 0));
}

export function buildMockupQualityChecks({ garmentType, assets = {}, colors = {} }) {
  const parts = getGarmentParts(garmentType);
  const exactPanels = parts.required.every(role => {
    const asset = assets[role];
    const spec = getPanelPreparationSpec(garmentType, role);
    return asset && (!spec || (Number(asset.width) === spec.width && Number(asset.height) === spec.height));
  });
  const trimColors = garmentType === "polo_jersey"
    ? [colors.collar, colors.placket, colors.leftCuff, colors.rightCuff]
    : [colors.collar, colors.leftCuff, colors.rightCuff];
  const lowContrast = trimColors.some(color => colorDistance(color, colors.backdrop) < 34);

  return [
    {
      key: "panels",
      tone: exactPanels ? "pass" : "block",
      title: exactPanels ? "Production panels are fitted" : "A required panel needs refitting",
      detail: exactPanels ? "All required artwork matches its locked panel map." : "Open the affected upload and fit it to the exact safe area.",
    },
    {
      key: "reference",
      tone: assets.style_reference ? "pass" : "note",
      title: assets.style_reference ? "Style reference supplied" : "No optional style reference",
      detail: assets.style_reference ? "It will guide lighting only; the production panels remain authoritative." : "The selected campaign preset will control lighting and composition.",
    },
    {
      key: "contrast",
      tone: lowContrast ? "note" : "pass",
      title: lowContrast ? "Trim may blend into the backdrop" : "Trim and backdrop are distinct",
      detail: lowContrast ? "This is allowed, but fine collar or cuff edges may be less visible." : "The selected colors have enough separation for a clear presentation.",
    },
    {
      key: "sequence",
      tone: "pass",
      title: "Hero-first consistency is enabled",
      detail: "The hero view becomes the photographic anchor for the remaining four views.",
    },
  ];
}
