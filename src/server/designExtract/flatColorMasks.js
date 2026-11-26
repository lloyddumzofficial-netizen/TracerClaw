const binsPerChannel = 32;
const binCount = binsPerChannel ** 3;
const colorBin = (r, g, b) => (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
const colorAt = index => [(index >> 10) * 8 + 4, ((index >> 5) & 31) * 8 + 4, (index & 31) * 8 + 4];
const distance = ([r, g, b], [red, green, blue]) => (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;

function hue([r, g, b]) {
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  if (delta < 24) return null;
  return (60 * (r === max ? (g - b) / delta : g === max ? 2 + (b - r) / delta : 4 + (r - g) / delta) + 360) % 360;
}

function sameInk(a, b) {
  const first = hue(a), second = hue(b);
  if (first === null || second === null) return false;
  const separation = Math.abs(first - second);
  return Math.min(separation, 360 - separation) < 16 && distance(a, b) < 58 ** 2;
}

function inkName(rgb) {
  const tone = hue(rgb);
  if (tone === null) return Math.max(...rgb) < 112 ? "Dark artwork" : "Light artwork";
  if (tone > 315 && tone < 353) return "Pink artwork";
  if (tone >= 45 && tone < 108 && Math.max(...rgb) - Math.min(...rgb) < 105) return "Olive artwork";
  if (tone >= 145 && tone < 185) return "Teal artwork";
  const names = ["Red", "Orange", "Gold", "Lime", "Green", "Teal", "Cyan", "Blue", "Blue", "Violet", "Purple", "Pink"];
  return names[Math.round(tone / 30) % names.length] + " artwork";
}

// Use this only for opaque, limited-palette prints. A strong peak alone is
// insufficient: photos with a solid backdrop still have to pass the palette
// coverage gate. Classify native pixels after sampling; never resize artwork.
export function flatColorMasks({ data, info: { width, height } }, capacity) {
  if (width < 32 || height < 32 || capacity < 3) return null;
  const histogram = new Uint32Array(binCount);
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 384));
  let opaque = 0, sampled = 0;
  for (let y = Math.floor(step / 2); y < height; y += step) for (let x = Math.floor(step / 2); x < width; x += step) {
    const offset = (y * width + x) * 4;
    sampled++;
    if (data[offset + 3] < 248) continue;
    opaque++;
    histogram[colorBin(data[offset], data[offset + 1], data[offset + 2])]++;
  }
  if (!sampled || opaque / sampled < .97) return null;

  const peaks = Array.from(histogram.keys()).filter(index => histogram[index] >= opaque * .004)
    .sort((a, b) => histogram[b] - histogram[a]);
  const swatches = [];
  for (const index of peaks) {
    const rgb = colorAt(index);
    if (swatches.some(swatch => distance(rgb, swatch.rgb) <= 21 ** 2)) continue;
    const sibling = swatches.find(swatch => sameInk(rgb, swatch.rgb));
    const group = sibling?.group ?? swatches.length;
    swatches.push({ rgb, group });
    if (swatches.length > 9) return null;
  }
  if (swatches.length < 3) return null;
  const groups = new Map();
  for (const swatch of swatches) if (!groups.has(swatch.group)) groups.set(swatch.group, { ...swatch, support: 0 });

  const owners = new Uint8Array(binCount), opacity = new Uint8Array(binCount);
  let accounted = 0;
  for (let index = 0; index < binCount; index++) {
    const rgb = colorAt(index);
    let closest, squared = Infinity;
    for (const swatch of swatches) {
      const current = distance(rgb, swatch.rgb);
      if (current < squared) { closest = swatch; squared = current; }
    }
    owners[index] = closest.group;
    // Include darker or lighter shades when their hue stays with the same ink.
    // Leave near-neutral and mixed boundary pixels in the remainder.
    const edge = sameInk(rgb, closest.rgb) ? 53 : 31;
    opacity[index] = Math.max(0, Math.min(255, Math.round((edge - Math.sqrt(squared)) * 255 / 10)));
    if (squared <= 23 ** 2) {
      accounted += histogram[index];
      groups.get(closest.group).support += histogram[index];
    }
  }
  if (accounted / opaque < .965) return null;
  const inks = [...groups.values()].filter(group => !(group.group === 0 && hue(group.rgb) === null) && group.support >= opaque * .008);
  if (inks.length < 2 || inks.length >= capacity || inks.length > 6) return null;
  const names = inks.map(ink => inkName(ink.rgb));
  return inks.map(({ group, rgb }, index) => ({
    name: names.filter(name => name === names[index]).length > 1
      ? `${names[index]} · #${rgb.map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`
      : names[index],
    groupedByColor: true,
    nativeCoverage() {
      const coverage = Buffer.alloc(width * height);
      for (let i = 0, offset = 0; i < coverage.length; i++, offset += 4) {
        const bin = colorBin(data[offset], data[offset + 1], data[offset + 2]);
        if (owners[bin] === group) coverage[i] = opacity[bin];
      }
      return coverage;
    },
  }));
}
