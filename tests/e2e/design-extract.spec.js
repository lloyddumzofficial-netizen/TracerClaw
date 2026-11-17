import { test, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";
import JSZip from "jszip";
import { readPsd } from "ag-psd";
import { readFile, writeFile } from "node:fs/promises";
loadEnvConfig(process.cwd());

test("project editor → layers → arrange/refine → refresh → PNG, ZIP and PSD", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const user = { id: "design-admin", email: "admin@test.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test`, refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  await page.addInitScript(({ key, value }) => { document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`; localStorage.setItem("cookie_consent", "declined"); }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  const fixture = await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 240, g: 30, b: 70, alpha: .7 } } }).png().toBuffer();
  await page.route("https://layers.test/**", route => route.fulfill({ contentType: "image/png", body: fixture }));
  const initial = { id: "project-1", revision: 0, source_url: "https://layers.test/source.png", manifest: { version: 1, width: 400, height: 600, layers: [] } };
  let project = structuredClone(initial), job = null, submissions = 0;
  const elements = [0, 1].map(i => ({ id: `layer-${i}`, name: i ? "Logo" : "Subject", url: `https://layers.test/${i}.png`, width: 40, height: 60, visible: true, locked: false, composition: { x: i * 50, y: 20, scale: 1 }, layout: { x: 300 + i * 260, y: 0, scale: 2 } }));
  await page.route("**/api/design-extract**", async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname.endsWith("/asset")) return route.fulfill({ contentType: "image/png", body: fixture });
    if (url.pathname === "/api/design-extract") {
      if (method === "POST") { expect(route.request().postDataJSON().sourceProjectId).toBe("garment-1"); return route.fulfill({ json: { project } }); }
      return route.fulfill({ json: { enabled: true, projects: [] } });
    }
    if (method === "GET") {
      if (job?.status === "queued") job = { ...job, status: "ready", result: { layers: elements } };
      return route.fulfill({ json: { project, job } });
    }
    const body = route.request().postDataJSON();
    if (method === "PATCH") { project = { ...project, revision: project.revision + 1, manifest: { ...project.manifest, layers: body.layers } }; return route.fulfill({ json: { project } }); }
    if (body.action === "accept") { project = { ...project, revision: project.revision + 1, manifest: { ...project.manifest, layers: structuredClone(elements) } }; job = { ...job, status: "accepted" }; return route.fulfill({ json: { project, job } }); }
    if (body.action === "reject") { job = { ...job, status: "rejected" }; return route.fulfill({ json: { project, job } }); }
    if (body.kind === "segment") { expect(body.point.x).toBeGreaterThanOrEqual(0); expect(body.point.x).toBeLessThan(40); expect(body.point.y).toBeLessThan(60); }
    submissions++; job = { id: `job-${submissions}`, kind: body.kind, status: "queued" }; return route.fulfill({ json: { job } });
  });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/design-extract/project-1");
  await expect(page.getByRole("button", { name: "Extract layers", exact: true })).toBeVisible();
  await expect(page.getByText(/admin beta/i)).toHaveCount(0);
  await expect(page).toHaveURL(/\/design-extract\/project-1/);
  await page.getByRole("button", { name: "Extract layers", exact: true }).click();
  await expect(page.getByText("Waiting for AI", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("progressbar").locator("span")).toHaveCSS("animation-name", /extractionLoading/);
  await page.locator('section[aria-label="Design extraction progress"]').screenshot({ path: "output/design-extract-loading.png" });
  await expect(page.getByRole("heading", { name: "Review extracted layers" })).toBeVisible();
  await page.getByRole("button", { name: "Accept layers", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Design canvas", exact: true });
  const board = page.locator("[data-design-board]");
  const camera = () => board.evaluate(element => { const matrix = new DOMMatrix(getComputedStyle(element).transform); return { x: matrix.m41, y: matrix.m42, zoom: matrix.a }; });
  const initialCamera = await camera(), viewport = await canvas.boundingBox();
  const pointer = { x: Math.round(viewport.x + viewport.width * .6), y: Math.round(viewport.y + viewport.height * .5) };
  const artworkX = (pointer.x - viewport.x - initialCamera.x) / initialCamera.zoom;
  const artworkY = (pointer.y - viewport.y - initialCamera.y) / initialCamera.zoom;
  const pageScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(pointer.x, pointer.y); await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(initialCamera.zoom * Math.exp(.6), 3);
  const zoomed = await camera();
  expect((pointer.x - viewport.x - zoomed.x) / zoomed.zoom).toBeCloseTo(artworkX, 1);
  expect((pointer.y - viewport.y - zoomed.y) / zoomed.zoom).toBeCloseTo(artworkY, 1);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(initialCamera.zoom, 3);
  // Pan empty space, then pan across an element without editing that layer.
  const panStart = await camera();
  await page.mouse.move(viewport.x + viewport.width - 150, viewport.y + viewport.height - 130);
  await page.mouse.down(); await page.mouse.move(viewport.x + viewport.width - 70, viewport.y + viewport.height - 170, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await camera()).x).toBeCloseTo(panStart.x + 80, 0);
  await expect.poll(async () => (await camera()).y).toBeCloseTo(panStart.y - 40, 0);
  const beforeSpace = await camera();
  let subjectBox = await page.getByRole("button", { name: "Select Subject", exact: true }).boundingBox();
  await page.keyboard.down("Space");
  await page.mouse.move(subjectBox.x + subjectBox.width / 2, subjectBox.y + subjectBox.height / 2); await page.mouse.down();
  await page.mouse.move(subjectBox.x + subjectBox.width / 2 + 50, subjectBox.y + subjectBox.height / 2 + 30, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Space");
  await expect.poll(async () => (await camera()).x).toBeCloseTo(beforeSpace.x + 50, 0);
  await expect.poll(async () => (await camera()).y).toBeCloseTo(beforeSpace.y + 30, 0);
  const beforeMiddle = await camera();
  subjectBox = await page.getByRole("button", { name: "Select Subject", exact: true }).boundingBox();
  await page.mouse.move(subjectBox.x + subjectBox.width / 2, subjectBox.y + subjectBox.height / 2); await page.mouse.down({ button: "middle" });
  await page.mouse.move(subjectBox.x + subjectBox.width / 2 - 35, subjectBox.y + subjectBox.height / 2 - 25, { steps: 8 }); await page.mouse.up({ button: "middle" });
  await expect.poll(async () => (await camera()).x).toBeCloseTo(beforeMiddle.x - 35, 0);
  expect(project.manifest.layers).toEqual(elements);
  const movingAnchor = await canvas.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const read = () => new DOMMatrix(getComputedStyle(element.querySelector("[data-design-board]")).transform);
    const first = { x: Math.round(rect.left + rect.width * .2), y: Math.round(rect.top + rect.height * .3) };
    const second = { x: Math.round(rect.left + rect.width * .8), y: Math.round(rect.top + rect.height * .7) };
    element.dispatchEvent(new WheelEvent("wheel", { clientX: first.x, clientY: first.y, deltaY: -180, bubbles: true, cancelable: true }));
    const before = read();
    const local = { x: second.x - rect.left, y: second.y - rect.top };
    element.dispatchEvent(new WheelEvent("wheel", { clientX: second.x, clientY: second.y, deltaY: -180, bubbles: true, cancelable: true }));
    return { ...local, worldX: (local.x - before.m41) / before.a, worldY: (local.y - before.m42) / before.a, zoom: before.a * Math.exp(.54) };
  });
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(movingAnchor.zoom, 3);
  const pinnedCamera = await camera();
  expect((movingAnchor.x - pinnedCamera.x) / pinnedCamera.zoom).toBeCloseTo(movingAnchor.worldX, 1);
  expect((movingAnchor.y - pinnedCamera.y) / pinnedCamera.zoom).toBeCloseTo(movingAnchor.worldY, 1);
  const fittedZoom = await canvas.evaluate(element => Math.max(.05, Math.min(1, (element.clientWidth - 72) / 1400, (element.clientHeight - 108) / 600)));
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(fittedZoom, 3);
  await page.getByRole("button", { name: "Select Subject", exact: true }).click();
  const beforeLayerDrag = await camera();
  subjectBox = await page.getByRole("button", { name: "Select Subject", exact: true }).boundingBox();
  const layerPointer = { x: Math.round(subjectBox.x + subjectBox.width / 2), y: Math.round(subjectBox.y + subjectBox.height / 2) };
  await page.mouse.move(layerPointer.x, layerPointer.y); await page.mouse.down(); await page.mouse.move(layerPointer.x + 42, layerPointer.y + 21, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel("Overview x", { exact: true }).inputValue())).toBeCloseTo(300 + 42 / beforeLayerDrag.zoom, 1);
  expect((await camera()).x).toBeCloseTo(beforeLayerDrag.x, 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Overview x", { exact: true })).toHaveValue("300");
  await page.getByLabel("Overview x", { exact: true }).fill("350");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => project.manifest.layers[0].layout.x).toBe(350);
  expect(project.manifest.layers[0].composition.x).toBe(0);
  await page.getByRole("button", { name: "Composition", exact: true }).click();
  await expect(page.getByLabel("Composition x", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Overview x", { exact: true })).toHaveValue("300");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Overview x", { exact: true })).toHaveValue("350");
  await page.getByRole("button", { name: "Split further · AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard result" })).toBeVisible();
  await page.getByRole("button", { name: "Discard result" }).click();
  expect(project.manifest.layers).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", { name: "Select Subject", exact: true }).click();
  await expect(page.getByLabel("Overview x", { exact: true })).toHaveValue("350");
  await page.getByRole("button", { name: "Extract selected element", exact: true }).click();
  await page.getByRole("button", { name: "Select Subject", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard result" })).toBeVisible();
  await page.getByRole("button", { name: "Discard result" }).click();
  await page.getByRole("button", { name: "Select Subject", exact: true }).click();
  await page.getByRole("button", { name: "Composition", exact: true }).click();
  await page.getByLabel("Composition scale", { exact: true }).fill("1.5");
  await page.getByLabel("Lock layer", { exact: true }).check();
  await expect(page.getByLabel("Composition scale", { exact: true })).toBeDisabled();
  await page.getByLabel("Lock layer", { exact: true }).uncheck();
  await page.getByLabel("Show Logo", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => project.manifest.layers[0].composition.scale).toBe(1.5);
  await page.screenshot({ path: "output/design-extract-workspace.png", fullPage: true });
  for (const [name, extension] of [["Download PNG", "png"], ["Download all · ZIP", "zip"], ["Export layered PSD", "psd"]]) {
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const file = await waiting; expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const bytes = await readFile(await file.path());
    if (extension === "png") expect((await sharp(bytes).metadata()).hasAlpha).toBe(true);
    if (extension === "zip") { const zip = await JSZip.loadAsync(bytes); const manifest = JSON.parse(await zip.file("manifest.json").async("string")); expect(manifest.layers[0].composition.x).toBe(0); expect(Object.keys(zip.files)).toHaveLength(3); }
    if (extension === "psd") { const psd = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true }); expect(psd.width).toBe(400); expect(psd.children.map(child => child.name)).toEqual(["Original reference", "Subject", "Logo"]); expect(psd.children[0].hidden).toBe(true); expect(psd.children[1].left).toBe(0); expect(psd.children[1].top).toBe(20); expect(psd.children[1].right - psd.children[1].left).toBe(60); expect(psd.children[1].bottom - psd.children[1].top).toBe(90); expect(psd.children[2].hidden).toBe(true); await writeFile("output/design-extract-test.psd", bytes); }
  }
  expect(submissions).toBe(3); expect(errors).toEqual([]);
});
