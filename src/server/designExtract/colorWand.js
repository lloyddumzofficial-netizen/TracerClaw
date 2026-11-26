import sharp from "sharp";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";

export async function renderColorWand(source, { box, points, tolerance, width, height }) {
  const image = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  const metadata = await image.metadata();
  validateDesignImage(metadata);
  if (metadata.width !== width || metadata.height !== height) return null;

  const { data, info } = await image.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sample = ({ x, y }) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] === 0) return null;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const include = points.filter(point => point.label === 1).map(sample).filter(Boolean);
  const exclude = points.filter(point => point.label === 0).map(sample).filter(Boolean);
  if (!include.length) return null;

  const limit = tolerance ** 2;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (!data[offset + 3]) continue;
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
        data[offset + 3] = 0;
        continue;
      }
      const foreground = nearestColor(data, offset, include);
      if (foreground > limit || foreground >= nearestColor(data, offset, exclude)) {
        data[offset + 3] = 0;
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return null;
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const raster = sharp(data, { raw: info });
  return { bounds, image: raster, trimmed: await raster.clone().extract(bounds).png().toBuffer() };
}

function nearestColor(data, offset, samples) {
  let distance = Infinity;
  for (const [red, green, blue] of samples) {
    const squared = (data[offset] - red) ** 2 + (data[offset + 1] - green) ** 2 + (data[offset + 2] - blue) ** 2;
    if (squared === 0) return 0;
    distance = Math.min(distance, squared);
  }
  return distance;
}
