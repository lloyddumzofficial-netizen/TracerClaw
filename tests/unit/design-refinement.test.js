import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { prepareRefinement, refinementFrame, refinementOptions, REFINE_MODEL } from "@/server/designExtract/refinement";

it("prepares one fixed-prompt three-image request and preserves the native source framing and alpha", async () => {
  const width = 160, height = 107;
  const frame = refinementFrame(width, height);
  expect(frame.ratio).toBe("3:2");
  const source = await sharp({ create: { width, height, channels: 4, background: { r: 23, g: 71, b: 42, alpha: 0.5 } } }).png().toBuffer();
  const upload = vi.fn(async () => "private-image");
  const request = await prepareRefinement(source, frame, upload, async () => "https://example.test/signed.png");
  expect(request).toMatchObject({ num_images: 3, resolution: "1K", thinking_level: "minimal", enable_web_search: false, output_format: "png", aspect_ratio: "3:2" });
  expect(request.prompt).toContain("Preserve exact wording");
  expect(request.prompt).toContain("Straighten segments that visibly wobble");
  expect(request.prompt).toContain("Never add traces, branches, terminals");
  expect(request.prompt).toContain("Preserve deliberate angles, curves, and asymmetry");
  expect(await sharp(upload.mock.calls[0][0]).metadata()).toMatchObject({ width: frame.canvasWidth, height: frame.canvasHeight });

  const render = background => sharp({ create: { width: 300, height: 200, channels: 3, background } }).png().toBuffer();
  const first = await render("#123456");
  const second = await render("#154535");
  const saveOption = vi.fn(async (_, index) => "option-" + index);
  const layers = await refinementOptions(source, [{ url: "first" }, { url: "duplicate" }, { url: "second" }], { manifest: { width, height } }, { id: "job" }, {
    readAsset: async url => url === "second" ? second : first, saveOption,
  });
  expect(layers.map(layer => layer.name)).toEqual(["Option 1", "Option 3"]);
  expect(saveOption).toHaveBeenCalledTimes(2);
  const { data, info } = await sharp(saveOption.mock.calls[0][0]).raw().toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: layers[0].width, height: layers[0].height, channels: 4 });
  expect(data[3]).toBe(128);
});

it.skipIf(process.env.DESIGN_REFINED_LIVE !== "1")("runs one fal batch on synthetic print artwork", async () => {
  const { fal } = await import("@fal-ai/client");
  const { submitDesignOperation } = await import("@/server/designExtract/submission");
  const dir = ".tmp/design-refined-geometry";
  await mkdir(dir, { recursive: true });
  const width = 640, height = 800;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800">
    <defs><linearGradient id="shade"><stop stop-color="#819891"/><stop offset="1" stop-color="#0D3936"/></linearGradient></defs>
    <path fill="#12554D" d="M0 0H640V800H0Z"/><path fill="url(#shade)" opacity=".5" d="M0 0L310 0 410 800 50 800Z"/>
    <path fill="none" stroke="#EACB6E" stroke-width="13" d="M50 66L592 61 586 734 45 736Z"/>
    <circle cx="320" cy="320" r="166" fill="#EACB6E"/><ellipse cx="320" cy="331" rx="98" ry="113" fill="#D69167"/>
    <path fill="#321F20" d="M222 305Q220 191 320 200Q423 210 418 305Q360 237 222 305Z"/>
    <circle cx="285" cy="330" r="9" fill="#321F20"/><circle cx="353" cy="332" r="8" fill="#321F20"/>
    <path d="M285 386Q320 419 357 385" fill="none" stroke="#973746" stroke-width="8"/>
    <text x="320" y="590" text-anchor="middle" fill="#F4F4F1" font-family="Arial" font-size="54" font-weight="bold">RIVER CLUB</text>
    <text x="320" y="640" text-anchor="middle" fill="#F4F4F1" font-family="Arial" font-size="23">EST. 1986</text>
    <g fill="none" stroke="#EACB6E" stroke-width="4" stroke-linecap="round">
      <path d="M88 716L154 666Q166 663 178 667L265 666"/>
      <circle cx="272" cy="666" r="7"/>
      <path d="M390 684L446 683Q457 681 466 685L492 708 540 709"/>
      <circle cx="547" cy="709" r="7"/>
      <path opacity=".34" d="M97 719L152 676 187 677 M481 709L501 719 534 720"/>
    </g>
    </svg>`;
  const source = await sharp(Buffer.from(svg)).blur(.85).jpeg({ quality: 65 }).toBuffer();
  await writeFile(dir + "/source.jpg", source);
  const input = await prepareRefinement(source, refinementFrame(width, height), async bytes => "data:image/png;base64," + bytes.toString("base64"), async url => url);
  const { request_id: requestId } = await submitDesignOperation(REFINE_MODEL, { input });
  await writeFile(dir + "/receipt.json", JSON.stringify({ requestId, model: REFINE_MODEL }));
  console.log("Design Refined fal receipt", requestId);
  await expect.poll(async () => (await fal.queue.status(REFINE_MODEL, { requestId, logs: false })).status, { timeout: 150_000, interval: 3500 }).toBe("COMPLETED");
  const { data } = await fal.queue.result(REFINE_MODEL, { requestId });
  const layers = await refinementOptions(source, data.images, { manifest: { width, height } }, { id: "synthetic" }, {
    readAsset: async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw Object.assign(new Error("Could not read preview"), { status: response.status });
      return Buffer.from(await response.arrayBuffer());
    },
    saveOption: async (bytes, index) => { const path = dir + "/option-" + (index + 1) + ".png"; await writeFile(path, bytes); return path; },
  });
  expect(layers).toHaveLength(3);
}, 200_000);
