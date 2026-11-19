import { it, expect } from 'vitest';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { automaticCutouts } from '@/server/designExtract/automaticCutouts';

// Opt-in because this deliberately exercises the maximum native image size.
// Run with DESIGN_RESOURCE_CHECK=1; never calls a provider or external storage.
it.skipIf(process.env.DESIGN_RESOURCE_CHECK !== '1')('renders 24 MP within the 32-layer budget without retaining output frames', async () => {
  const width = 4000, height = 6000, count = width * height;
  const source = await sharp({ create: { width, height, channels: 4, background: { r: 18, g: 90, b: 130, alpha: 1 } } }).png().toBuffer();
  const masks = [];
  for (let n = 0; n < 32; n++) {
    const pixels = Buffer.alloc(count);
    for (let y = 0; y < height; y++) pixels.fill(255, y * width + n * 125, y * width + (n + 1) * 125);
    masks.push(await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer());
  }
  const started = performance.now();
  let outputs = 0;
  for await (const layer of automaticCutouts(source, masks.map((_, i) => ({ url: String(i) })), { readMask: async url => masks[Number(url)], limit: 32 })) {
    const metadata = await sharp(layer.bytes).metadata();
    expect(metadata).toMatchObject({ width, height, hasAlpha: true });
    outputs++;
  }
  expect(outputs).toBe(32);
  const report = {
    nativePixels: count, outputs, durationSeconds: (performance.now() - started) / 1000,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    environment: `${process.platform} Node ${process.versions.node}; synthetic input; no network or deployment measurement`,
  };
  await mkdir('output', { recursive: true });
  await writeFile('output/design-extract-resources.json', JSON.stringify(report, null, 2));
}, 120000);
