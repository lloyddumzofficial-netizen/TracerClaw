// Local-only qualification. Usage: node scripts/qualify-design-extract.cjs config.json
// config: [{name, path, crop?: {left,top,width,height}}]. Explicitly sends inputs to fal.
require('@next/env').loadEnvConfig(process.cwd());
const fs = require('node:fs/promises');
const sharp = require('sharp');
const { fal } = require('@fal-ai/client');
(async () => {
  const cases = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  for (const item of cases) {
    if (!/^[a-z0-9-]+$/.test(item.name)) throw new Error('Invalid case name');
    const dir = `output/design-extract-qualification/${item.name}`;
    await fs.mkdir(dir, { recursive: true });
    let source = sharp(item.path);
    if (item.crop) source = source.extract(item.crop);
    const buffer = await source.png().toBuffer();
    await fs.writeFile(`${dir}/source.png`, buffer);
    const url = await fal.storage.upload(new Blob([buffer], { type: 'image/png' }));
    const started = Date.now();
    const { data, requestId } = await fal.subscribe('fal-ai/qwen-image-layered', {
      input: { image_url: url, num_layers: 4, output_format: 'png', enable_safety_checker: true }, timeout: 240000,
    });
    const layers = [];
    for (const [index, image] of data.images.entries()) {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error('Output download failed');
      const bytes = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      await fs.writeFile(`${dir}/layer-${index}.png`, bytes);
      layers.push({ width: meta.width, height: meta.height, alpha: meta.hasAlpha });
    }
    const report = { name: item.name, requestId, durationMs: Date.now() - started, layers, billing: 'Check fal dashboard against requestId; API response does not report billed cost.' };
    await fs.writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
