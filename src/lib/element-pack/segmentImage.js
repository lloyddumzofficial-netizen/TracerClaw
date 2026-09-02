import sharp from "sharp";
import { ELEMENT_PACK_LIMITS } from "./constants";

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function estimateBorderColor(data, width, height) {
  const sample = [];
  const pushPixel = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 8) return;
    sample.push([data[i], data[i + 1], data[i + 2]]);
  };

  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  for (let x = 0; x < width; x += step) {
    pushPixel(x, 0);
    pushPixel(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    pushPixel(0, y);
    pushPixel(width - 1, y);
  }

  if (!sample.length) return [255, 255, 255];
  sample.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  return sample[Math.floor(sample.length / 2)];
}

function buildForegroundMask(data, width, height) {
  let hasUsefulAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0 && data[i] < 250) {
      hasUsefulAlpha = true;
      break;
    }
  }

  const background = estimateBorderColor(data, width, height);
  const mask = new Uint8Array(width * height);

  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const alpha = data[i + 3];
    if (alpha < 20) continue;
    if (hasUsefulAlpha && alpha > 35) {
      mask[p] = 1;
      continue;
    }
    const distance = colorDistance([data[i], data[i + 1], data[i + 2]], background);
    if (distance > 38) mask[p] = 1;
  }

  return mask;
}

function componentBoxes(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const boxes = [];
  const queue = [];
  const minPixels = Math.max(
    ELEMENT_PACK_LIMITS.minComponentPixels,
    Math.floor(width * height * ELEMENT_PACK_LIMITS.minComponentAreaRatio)
  );

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      pixels++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let yy = y - 1; yy <= y + 1; yy++) {
        if (yy < 0 || yy >= height) continue;
        for (let xx = x - 1; xx <= x + 1; xx++) {
          if (xx < 0 || xx >= width || (xx === x && yy === y)) continue;
          const next = yy * width + xx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (pixels >= minPixels && boxWidth >= 12 && boxHeight >= 12) {
      boxes.push({
        minX,
        minY,
        maxX,
        maxY,
        width: boxWidth,
        height: boxHeight,
        pixels,
        indices: Uint32Array.from(queue),
      });
    }
  }

  return boxes
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, ELEMENT_PACK_LIMITS.maxElements);
}

function paddedBox(box, width, height) {
  const pad = ELEMENT_PACK_LIMITS.cropPadding;
  const left = Math.max(0, box.minX - pad);
  const top = Math.max(0, box.minY - pad);
  const right = Math.min(width - 1, box.maxX + pad);
  const bottom = Math.min(height - 1, box.maxY + pad);
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    sourcePixels: box.pixels,
    indices: box.indices,
  };
}

async function cropTransparentElement({ data, width, box }) {
  const crop = Buffer.alloc(box.width * box.height * 4);

  for (const pixelIndex of box.indices) {
    const sourceX = pixelIndex % width;
    const sourceY = Math.floor(pixelIndex / width);
    if (
      sourceX < box.left ||
      sourceX >= box.left + box.width ||
      sourceY < box.top ||
      sourceY >= box.top + box.height
    ) {
      continue;
    }

    const src = pixelIndex * 4;
    const dst = ((sourceY - box.top) * box.width + (sourceX - box.left)) * 4;
    crop[dst] = data[src];
    crop[dst + 1] = data[src + 1];
    crop[dst + 2] = data[src + 2];
    crop[dst + 3] = data[src + 3];
  }

  return sharp(crop, {
    raw: { width: box.width, height: box.height, channels: 4 },
  }).png({ compressionLevel: 9 }).toBuffer();
}

export async function segmentImageToElements(sourceBuffer) {
  const normalized = await sharp(sourceBuffer)
    .rotate()
    .resize({
      width: ELEMENT_PACK_LIMITS.maxAnalysisSize,
      height: ELEMENT_PACK_LIMITS.maxAnalysisSize,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = normalized;
  const mask = buildForegroundMask(data, info.width, info.height);
  const boxes = componentBoxes(mask, info.width, info.height).map((box) => paddedBox(box, info.width, info.height));
  const previewPng = await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();

  const elements = [];
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    const buffer = await cropTransparentElement({ data, width: info.width, box });
    elements.push({ index, box, buffer });
  }

  return {
    width: info.width,
    height: info.height,
    previewPng,
    elements,
  };
}
