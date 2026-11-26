import sharp from "sharp";

const glyphs = [
  ["01110","10001","10001","11111","10001","10001","10001"],
  ["11110","10001","10001","11110","10001","10001","11110"],
  ["11111","10000","10000","11110","10000","10000","11111"],
  ["10001","11011","10101","10101","10001","10001","10001"],
  ["01110","10001","10001","10001","10001","10001","01110"],
  ["11110","10001","10001","11110","10100","10010","10001"],
  ["01111","10000","10000","01110","00001","00001","11110"],
];
const categories = ["wordmark", "fine-text", "garment-curve", "similar-colors", "gradient", "overlap"];

export async function pilotCase(index) {
  const category = categories[index % categories.length], word = category === "wordmark" || category === "fine-text";
  const variant = Math.floor(index / categories.length);
  const width = variant % 2 ? 768 : 1024, height = variant % 2 ? 1024 : 640;
  const x = variant < 2 ? 92 : 125, y = variant % 2 ? 280 : 222;
  const unit = category === "fine-text" ? 6 + variant : 17 + variant;
  const letters = Array.from({ length: 4 + variant % 2 }, (_, letter) => glyphs[(variant * 3 + letter) % glyphs.length]
    .flatMap((row, yi) => [...row].map((value, xi) => value === "1"
      ? `<rect x="${x + (letter * 6 + xi) * unit}" y="${y + yi * unit}" width="${unit}" height="${unit}"/>` : "")).join(""));
  const curve = `<path d="M${x} ${y}c144 -137 320 -78 454 47c-169 -79 -308 -103 -454 47z"/>`;
  const symbol = `<path fill-rule="evenodd" d="M${x + 226} ${y - 70}l142 110 -74 141 -167 -25 -31 -146z m1 77 -66 49 29 70 73 9 33 -71z"/>`;
  const target = word ? letters.join("") : category === "garment-curve" || category === "gradient" ? curve : symbol;
  const cover = category === "overlap" ? `<circle cx="${x + 285}" cy="${y + 110}" r="85"/>` : "";
  const background = ["#182d42", "#e1c4a3", "#225a50", "#e5dfcc"][variant];
  const ink = category === "similar-colors" ? ["#213547", "#d5b692", "#30655b", "#d7d4c4"][variant] :
    category === "gradient" ? "url(#gradient)" : ["#d4ed74", "#9e2e58", "#f8ad60", "#293151"][variant];
  const svg = content => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="gradient"><stop stop-color="#f8bb56"/><stop offset="100%" stop-color="#f28ea1"/></linearGradient></defs>${content}</svg>`);
  const source = await sharp(svg(`<rect width="100%" height="100%" fill="${background}"/><circle cx="${width - 130}" cy="${y - 45}" r="${25 + variant * 7}" fill="#68aacc"/><path d="M40 ${height - 125} Q ${width * .55} ${height - 300} ${width - 20} ${height - 75} L ${width - 20} ${height - 44} Q ${width * .55} ${height - 225} 40 ${height - 75}Z" fill="#a184ad"/><g fill="${ink}">${target}</g><g fill="#ea776c">${cover}</g>`)).png().toBuffer();
  const label = await sharp(svg(`<g fill="white">${target}</g><g fill="black">${cover}</g>`)).flatten({ background: "black" }).greyscale().raw().toBuffer();
  const letterRanges = word ? letters.map((_, letter) => [x + letter * 6 * unit, x + (letter * 6 + 5) * unit]) : [];
  const description = word ? "the complete block lettering as one wordmark" : category === "garment-curve" || category === "gradient" ? "the upper curved ribbon" : "the visible five-sided emblem with a hole";
  return { source, label, letterRanges, width, height, name: `${index + 1}-${category}`, description, partition: index < 12 ? "tuning" : "holdout" };
}

export function measurePilotMask(mask, { label, width, height, letterRanges }) {
  let intersection = 0, union = 0, size = 0;
  const ref = [], predicted = [], refBits = new Uint8Array(label.length), predBits = new Uint8Array(label.length);
  const letterPixels = new Uint32Array(letterRanges.length), included = new Uint32Array(letterRanges.length);
  for (let i = 0; i < label.length; i++) {
    const truth = refBits[i] = Number(label[i] >= 128), actual = predBits[i] = Number(mask[i] >= 128);
    intersection += truth && actual;
    union += truth || actual;
    size += actual;
    if (truth && letterRanges.length) {
      const x = i % width;
      const letter = letterRanges.findIndex(([left, right]) => x >= left && x < right);
      if (letter >= 0) { letterPixels[letter]++; included[letter] += actual; }
    }
  }
  const edge = (bits, i, x, y) => bits[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !bits[i - 1] || !bits[i + 1] || !bits[i - width] || !bits[i + width]);
  const refEdges = new Uint8Array(label.length), predEdges = new Uint8Array(label.length);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    if (edge(refBits, i, x, y)) { refEdges[i] = 1; ref.push(i); }
    if (edge(predBits, i, x, y)) { predEdges[i] = 1; predicted.push(i); }
  }
  const near = (i, bits) => {
    const x = i % width, y = Math.floor(i / width);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy <= 4 && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && bits[i + dy * width + dx]) return true;
    }
    return false;
  };
  const precision = predicted.filter(i => near(i, refEdges)).length / (predicted.length || 1);
  const recall = ref.filter(i => near(i, predEdges)).length / (ref.length || 1);
  return { iou: intersection / (union || 1), boundary: 2 * precision * recall / (precision + recall || 1),
    grouped: letterRanges.length ? intersection / (size || 1) >= .8 && letterPixels.every((count, i) => count > 0 && included[i] / count >= .85) : null };
}
