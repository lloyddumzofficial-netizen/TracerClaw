import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";

loadEnvConfig(process.cwd());

const sourceWidth = 1536;
const sourceHeight = 1024;
const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
  <path fill="#e02020" d="M0 0h768v512H0z"/>
  <path fill="#20c020" d="M768 0h768v512H768z"/>
  <path fill="#e0c020" d="M0 512h768v512H0z"/>
  <path fill="#2020e0" d="M768 512h768v512H768z"/>
</svg>`;

async function setupCrop(page, traceType = "standard", dismissGuide = true) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const user = { id: "crop-test-user", email: "crop@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test`,
    refresh_token: "crop-test-refresh", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  await page.addInitScript(({ key, value }) => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 0 });
    localStorage.setItem("cookie_consent", "declined");
    localStorage.setItem("desaynclaw_crop_guide_dismissed", "1");
    document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`;
  }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route("**/api/**", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: route.request().url().includes("/projects")
    ? { id: "crop-test", name: "Crop test", trace_type: traceType, original_image_url: "https://crop.test/source.svg", generated_image_url: null }
    : { credits: 10 } }));
  await page.route("**/api/proxy?*", route => route.fulfill({ contentType: "image/svg+xml", body: sourceSvg }));
  await page.route("**/crop-guide-*.mp4", route => route.fulfill({ status: 204, body: "" }));
  await page.goto("/workspace/crop-test");
  const guide = page.getByRole("dialog", { name: /Crop it right|Keep the complete logo|Frame the exact pattern/ });
  await expect(guide).toBeVisible();
  if (dismissGuide) {
    const proceed = guide.getByRole("button", { name: "Continue to crop", exact: true });
    await expect(proceed).toBeEnabled({ timeout: 10000 });
    await proceed.click();
  }
  await expect(page.getByAltText("Crop source", { exact: true })).toBeVisible();
  await expect(page.locator(".crop-source-meta span")).toContainText("1536 x 1024");
}

async function drawCrop(page) {
  const source = await page.getByAltText("Crop source", { exact: true }).boundingBox();
  await page.mouse.move(source.x + source.width * .2, source.y + source.height * .25);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width * .7, source.y + source.height * .75, { steps: 16 });
  await page.mouse.up();
  return page.locator(".designer-crop .ReactCrop__crop-selection");
}

test("crop reminder requires five seconds and appears again on every crop", async ({ page }) => {
  await setupCrop(page, "standard", false);
  const guide = page.getByRole("dialog", { name: "Crop it right. Get a cleaner result." });
  const close = guide.getByRole("button", { name: "Close crop guide and continue to crop" });
  await expect(guide.getByRole("img", { name: /Wrong crop includes sleeves/ })).toBeVisible();
  await expect(close).toBeDisabled();
  await expect(guide.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".crop-workspace-modal")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await page.keyboard.press("Tab");
  await expect(guide).toBeVisible();
  await page.screenshot({ path: "test-results/crop-intro-guide-desktop.png" });
  await page.waitForTimeout(3500);
  await expect(close).toBeDisabled();
  const proceed = guide.getByRole("button", { name: "Continue to crop", exact: true });
  await expect(proceed).toBeEnabled({ timeout: 10000 });
  await proceed.click();
  await expect(guide).toHaveCount(0);
  await drawCrop(page);
  await page.getByRole("button", { name: "Close crop modal", exact: true }).click();
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", { name: /Continue in [45]s/ })).toBeDisabled();
  await expect(close).toBeDisabled();
  await page.setViewportSize({ width: 900, height: 650 });
  const bounds = await guide.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(650);
  await page.screenshot({ path: "test-results/crop-intro-guide-compact.png" });
});

test("logo crop guide stays fixed with both examples visible", async ({ page }) => {
  await setupCrop(page, "logo");
  const panel = page.locator(".is-logo-workspace .crop-guide-panel");
  await expect(panel.getByRole("heading", { name: "Frame the complete logo." })).toBeVisible();
  await expect(panel.getByRole('img', { name: /Correct crop:.*lion logo/ })).toBeVisible();
  await expect(panel.getByRole('img', { name: /Wrong crop:.*lion logo/ })).toBeVisible();
  for (const height of [900, 768, 650]) {
    await page.setViewportSize({ width: 1366, height });
    await expect.poll(() => panel.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    const before = await panel.boundingBox();
    await panel.hover();
    await page.mouse.wheel(0, 800);
    await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBe(0);
    await page.mouse.wheel(0, -800);
    await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBe(0);
    for (const example of await panel.locator("figure").all()) {
      const bounds = await example.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(before.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(before.y + before.height + 1);
    }
    await page.screenshot({ path: `test-results/logo-guide-fixed-${height}.png` });
  }
});

async function selectionInSourcePixels(page) {
  const source = await page.getByAltText("Crop source", { exact: true }).boundingBox();
  const selection = await page.locator(".designer-crop .ReactCrop__crop-selection").boundingBox();
  return {
    x: (selection.x - source.x) / source.width * sourceWidth,
    y: (selection.y - source.y) / source.height * sourceHeight,
    width: selection.width / source.width * sourceWidth,
    height: selection.height / source.height * sourceHeight,
  };
}

for (const mode of ["mockup", "logo", "pattern"]) {
  test(`${mode} uses cursor-anchored zoom and pans without moving the crop`, async ({ page }) => {
    await setupCrop(page, mode);
    await drawCrop(page);
    const initial = await selectionInSourcePixels(page);
    const modal = page.locator(".crop-workspace-modal");
    const stage = page.locator(".crop-canvas-stage");
    await modal.getByRole("button", { name: "Actual size, 100 percent" }).click();
    await expect(modal.locator(".crop-zoom-controls strong")).toHaveText("100%");
    const bounds = await stage.boundingBox();
    const point = { x: bounds.x + bounds.width * .5, y: bounds.y + bounds.height * .45 };
    const sourcePoint = async () => {
      const image = await page.getByAltText("Crop source", { exact: true }).boundingBox();
      return { x: (point.x - image.x) / image.width, y: (point.y - image.y) / image.height, width: image.width };
    };
    const before = await sourcePoint();
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -160);
    await expect.poll(async () => (await sourcePoint()).width).toBeGreaterThan(before.width * 1.2);
    const after = await sourcePoint();
    expect(Math.abs(before.x - after.x) * sourceWidth).toBeLessThan(3);
    expect(Math.abs(before.y - after.y) * sourceHeight).toBeLessThan(3);
    await modal.getByRole("button", { name: "Pan tool", exact: true }).click();
    const startScroll = await stage.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 55, point.y + 40, { steps: 10 });
    await page.mouse.up();
    const endScroll = await stage.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
    expect(startScroll.x - endScroll.x).toBeCloseTo(55, 0);
    expect(startScroll.y - endScroll.y).toBeCloseTo(40, 0);
    const panned = await selectionInSourcePixels(page);
    for (const key of ["x", "y", "width", "height"]) expect(Math.abs(panned[key] - initial[key])).toBeLessThan(1);
    await modal.getByRole("button", { name: "Crop tool", exact: true }).click();
    await stage.focus();
    await page.keyboard.down("Space");
    await expect(stage).toHaveAttribute("data-tool", "hand");
    await page.keyboard.up("Space");
    await expect(stage).toHaveAttribute("data-tool", "crop");
    await page.keyboard.press("0");
    const fitted = await page.getByAltText("Crop source", { exact: true }).boundingBox();
    expect(fitted.width).toBeLessThan(bounds.width);
    expect(fitted.height).toBeLessThan(bounds.height);
    await page.screenshot({ path: `test-results/crop-navigation-${mode}.png` });
  });
}

for (const mode of ["standard", "logo", "pattern"]) {
  test(`${mode} crop keeps its source geometry through drag, resize, zoom and reset`, async ({ page }) => {
    await setupCrop(page, mode);
    const selection = await drawCrop(page);
    const initial = await selectionInSourcePixels(page);
    await page.locator(".crop-workspace-modal").getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(async () => {
      const box = await page.getByAltText("Crop source", { exact: true }).boundingBox();
      return page.locator(".crop-zoom-controls strong").textContent().then(text => text === `${Math.round(box.width / sourceWidth * 100)}%`);
    }).toBe(true);
    const zoomed = await selectionInSourcePixels(page);
    for (const key of ["x", "y", "width", "height"]) expect(Math.abs(zoomed[key] - initial[key])).toBeLessThan(1);

    const beforeMove = await selection.boundingBox();
    await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeMove.x + beforeMove.width / 2 + 32, beforeMove.y + beforeMove.height / 2 + 20, { steps: 12 });
    await page.mouse.up();
    const moved = await selection.boundingBox();
    expect(moved.x - beforeMove.x).toBeCloseTo(32, 0);
    expect(moved.y - beforeMove.y).toBeCloseTo(20, 0);

    await selection.locator('.ReactCrop__drag-handle[data-ord="e"]').hover();
    await page.mouse.down();
    await page.mouse.move(moved.x + moved.width - 28, moved.y + moved.height / 2, { steps: 12 });
    await page.mouse.up();
    const resized = await selection.boundingBox();
    expect(resized.width).toBeLessThan(moved.width - 25);
    expect(resized.height).toBeCloseTo(moved.height, 0);

    await selection.focus();
    await page.keyboard.press("ArrowRight");
    const keyboardMoved = await selection.boundingBox();
    expect(keyboardMoved.x).toBeGreaterThan(resized.x);
    await expect(page.locator(".crop-toolbar-right > span")).not.toHaveText("No selection");
    await page.getByRole("button", { name: "Reset selection", exact: true }).click();
    await expect(selection).toHaveCount(0);
    await expect(page.locator(".crop-toolbar-right > span")).toHaveText("No selection");
    await drawCrop(page);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(selection).toHaveCount(0);
    const resetSource = await page.getByAltText("Crop source", { exact: true }).boundingBox();
    await expect(page.locator(".crop-zoom-controls strong")).toHaveText(`${Math.round(resetSource.width / sourceWidth * 100)}%`);
  });
}

test("applying a crop after zoom exports the selected source pixels with the existing upload contract", async ({ page }) => {
  await setupCrop(page);
  let uploadRequest;
  let savedCrop;
  let uploadedImage;
  await page.route("**/api/upload-url", route => {
    uploadRequest = route.request().postDataJSON();
    return route.fulfill({ json: { uploadUrl: "https://crop.test/upload", publicUrl: "https://crop.test/crop_saved.jpg" } });
  });
  await page.route("https://crop.test/upload", route => {
    uploadedImage = route.request().postDataBuffer();
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/crop", route => {
    savedCrop = route.request().postDataJSON();
    return route.fulfill({ json: { success: true } });
  });
  await drawCrop(page);
  await page.locator(".crop-workspace-modal").getByRole("button", { name: "Zoom in", exact: true }).click();
  const expected = await selectionInSourcePixels(page);
  await page.getByRole("button", { name: "Apply Crop & Extract", exact: true }).click();
  await expect(page.locator(".crop-workspace-modal")).toHaveCount(0);
  expect(uploadRequest).toMatchObject({ contentType: "image/jpeg", purpose: "standard" });
  expect(savedCrop).toEqual({ projectId: "crop-test", croppedImageUrl: "https://crop.test/crop_saved.jpg" });
  const metadata = await sharp(uploadedImage).metadata();
  expect(Math.abs(metadata.width - expected.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metadata.height - expected.height)).toBeLessThanOrEqual(1);
  const { data, info } = await sharp(uploadedImage).raw().toBuffer({ resolveWithObject: true });
  const topLeft = [...data.subarray((10 * info.width + 10) * info.channels, (10 * info.width + 10) * info.channels + 3)];
  const bottomRightIndex = ((info.height - 10) * info.width + info.width - 10) * info.channels;
  const bottomRight = [...data.subarray(bottomRightIndex, bottomRightIndex + 3)];
  expect(topLeft[0]).toBeGreaterThan(180);
  expect(topLeft[1]).toBeLessThan(60);
  expect(bottomRight[0]).toBeLessThan(60);
  expect(bottomRight[2]).toBeGreaterThan(180);
});
