const SAMPLE_ASSET_ROOT =
  "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/sample_outputs/Desaynclaw_samples-Front%26Back";
const TABAKO_ASSET_ROOT = "/samples/garment_workspace/TABAKO_SHIRT_SAMPLE";

export const GARMENT_SAMPLES = [
  {
    id: "front",
    number: "01",
    title: "Front panel",
    originalUrl: `${SAMPLE_ASSET_ROOT}/FRONT/ORIGINAL_FRONT.png`,
    extractedUrl: `${SAMPLE_ASSET_ROOT}/FRONT/EXTRACTED_FRONT.png`,
    originalAlt: "Original jersey front mockup",
    extractedAlt: "Extracted flat jersey front artwork",
  },
  {
    id: "back",
    number: "02",
    title: "Back panel",
    originalUrl: `${SAMPLE_ASSET_ROOT}/BACK/BACK_ORIGINAL.png`,
    extractedUrl: `${SAMPLE_ASSET_ROOT}/BACK/BACK_EXTRACETED.png`,
    originalAlt: "Original jersey back mockup",
    extractedAlt: "Extracted flat jersey back artwork",
  },
  {
    id: "tabako",
    number: "03",
    title: "Tabako Festival",
    originalUrl: `${TABAKO_ASSET_ROOT}/FRONT_MOCKUP.jpg`,
    extractedUrl: `${TABAKO_ASSET_ROOT}/EXTRACTED_DESIGN.png`,
    originalAlt: "Original Tabako Festival front mockup",
    extractedAlt: "Extracted flat Tabako Festival artwork",
  },
];
