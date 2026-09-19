function safeBaseName(value) {
  return String(value || "mockup-campaign")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 72) || "mockup-campaign";
}

async function fetchImageBlob(url) {
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`Could not download a generated view (${response.status}).`);
  return response.blob();
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadBitmap(url) {
  const blob = await fetchImageBlob(url);
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode a generated view."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawImageCover(context, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawBoardPanel(context, image, frame, label) {
  const { x, y, width, height } = frame;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  drawImageCover(context, image, x, y, width, height);
  const shade = context.createLinearGradient(0, y + height * 0.64, 0, y + height);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.82)");
  context.fillStyle = shade;
  context.fillRect(x, y, width, height);
  context.restore();
  context.strokeStyle = "rgba(255,255,255,.16)";
  context.lineWidth = 2;
  context.strokeRect(x, y, width, height);
  context.fillStyle = "rgba(255,255,255,.88)";
  context.font = "600 20px Arial, sans-serif";
  context.fillText(label.toUpperCase(), x + 24, y + height - 24);
}

export async function downloadMockupSetZip({ outputs, projectName, shots }) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const baseName = safeBaseName(projectName);
  await Promise.all(shots.map(async shot => {
    const output = outputs.find(item => item.view_type === shot.key);
    if (!output) return;
    zip.file(`desaynclaw-${baseName}-${shot.key}.png`, await fetchImageBlob(output.file_url));
  }));
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  saveBlob(blob, `desaynclaw-${baseName}-mockup-set.zip`);
}

export async function exportCampaignBoard({ outputs, projectName, garmentLabel, backdrop, shots }) {
  const ordered = shots.map(shot => ({ shot, output: outputs.find(item => item.view_type === shot.key) })).filter(item => item.output);
  if (ordered.length !== shots.length) throw new Error("All five views must be ready before exporting a campaign board.");

  const images = await Promise.all(ordered.map(item => loadBitmap(item.output.file_url)));
  const canvas = document.createElement("canvas");
  canvas.width = 2400;
  canvas.height = 1600;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas export is unavailable in this browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.fillStyle = "#070707";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(760, 650, 40, 760, 650, 1050);
  glow.addColorStop(0, `${backdrop || "#071827"}CC`);
  glow.addColorStop(1, "rgba(7,7,7,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(255,255,255,.46)";
  context.font = "700 18px Arial, sans-serif";
  context.fillText("DESAYNCLAW / MOCKUP STUDIO", 72, 62);
  context.fillStyle = "#FFFFFF";
  context.font = "600 42px Arial, sans-serif";
  context.fillText(projectName || "Premium Jersey Campaign", 72, 116);
  context.fillStyle = "rgba(255,255,255,.52)";
  context.font = "400 20px Arial, sans-serif";
  context.fillText(`${garmentLabel} · Five-view campaign`, 72, 150);

  const frames = [
    { x: 72, y: 190, width: 910, height: 1328 },
    { x: 1014, y: 190, width: 637, height: 648 },
    { x: 1683, y: 190, width: 645, height: 648 },
    { x: 1014, y: 870, width: 637, height: 648 },
    { x: 1683, y: 870, width: 645, height: 648 },
  ];
  images.forEach((image, index) => drawBoardPanel(context, image, frames[index], ordered[index].shot.label));

  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not create the campaign board.")), "image/png"));
  images.forEach(image => image.close?.());
  saveBlob(blob, `desaynclaw-${safeBaseName(projectName)}-campaign-board.png`);
}
