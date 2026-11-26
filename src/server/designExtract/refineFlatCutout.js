const maxCropPixels = 4_000_000;
const edgeContrast = 18;

// Try native-pixel separation only when the crop has a nearly uniform border.
// On fabric, gradients, and crowded crops, the guided mask remains authoritative.
export function refineFlatCutout(original, box, provider, otherBoxes) {
  const { width, height, left, top } = box;
  const count = width * height;
  if (width < 32 || height < 32 || count > maxCropPixels) return null;
  const sourceWidth = original.info.width;
  const pixels = original.data;
  const offsetAt = (x, y) => ((top + y) * sourceWidth + left + x) * 4;
  const border = [];
  for (let x = 0; x < width; x += 4) border.push(offsetAt(x, 0), offsetAt(x, height - 1));
  for (let y = 0; y < height; y += 4) border.push(offsetAt(0, y), offsetAt(width - 1, y));
  const background = [0, 1, 2].map(channel => border.map(offset => pixels[offset + channel]).sort((a, b) => a - b)[border.length >> 1]);
  const contrast = offset => Math.max(Math.abs(pixels[offset] - background[0]), Math.abs(pixels[offset + 1] - background[1]), Math.abs(pixels[offset + 2] - background[2]));
  if (border.filter(offset => pixels[offset + 3] >= 250 && contrast(offset) <= 12).length < border.length * .86) return null;

  const candidate = new Uint8Array(count);
  let plain = 0, providerArea = 0;
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const offset = offsetAt(x, y), difference = contrast(offset);
    if (pixels[offset + 3] >= 250 && difference <= 12) plain++;
    if (provider[i] >= 128) providerArea++;
    if (pixels[offset + 3] > 0 && difference >= edgeContrast) candidate[i] = 1;
  }
  if (plain < count * .5 || providerArea < 8) return null;

  const refined = new Uint8Array(count);
  const queue = new Uint32Array(count);
  const smaller = otherBoxes.filter(other => other.width * other.height < count * .8);
  let retained = 0, matched = 0, groups = 0;
  for (let start = 0; start < count; start++) {
    if (!candidate[start]) continue;
    if (++groups > 400) return null;
    let end = 1, minX = width, minY = height, maxX = -1, maxY = -1, overlap = 0;
    queue[0] = start;
    candidate[start] = 0;
    for (let head = 0; head < end; head++) {
      const i = queue[head], x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (provider[i] >= 128) overlap++;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const next = ny * width + nx;
          if (!candidate[next]) continue;
          candidate[next] = 0;
          queue[end++] = next;
        }
      }
    }
    const clipped = minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1;
    const belongsElsewhere = smaller.some(other => left + minX >= other.left && top + minY >= other.top &&
      left + maxX < other.left + other.width && top + maxY < other.top + other.height);
    // A tight neighboring box takes its disconnected letters/marks together.
    // At crop edges retain only components already convincingly selected by AI.
    if (belongsElsewhere || end < 8 && overlap < 2 || clipped && overlap < end * .65) continue;
    retained += end;
    matched += overlap;
    for (let j = 0; j < end; j++) refined[queue[j]] = 255;
  }
  if (retained < providerArea * .55 || matched < providerArea * .40) return null;

  // Lower only the opacity of pixels mixed with the original backdrop.
  // Solid ink and native RGB stay unchanged.
  const opacity = refined.slice();
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    if (!refined[i]) continue;
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1 &&
      refined[i - 1] && refined[i + 1] && refined[i - width] && refined[i + width]) continue;
    const current = contrast(offsetAt(x, y));
    let strongest = current;
    for (let ny = Math.max(0, y - 2); ny <= Math.min(height - 1, y + 2); ny++) {
      for (let nx = Math.max(0, x - 2); nx <= Math.min(width - 1, x + 2); nx++) {
        if (refined[ny * width + nx]) strongest = Math.max(strongest, contrast(offsetAt(nx, ny)));
      }
    }
    opacity[i] = Math.round(255 * Math.max(0, Math.min(1, (current / strongest - .3) / .55)));
  }
  return opacity;
}
