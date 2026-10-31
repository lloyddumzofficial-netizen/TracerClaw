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

async function setupCrop(page, traceType = "standard") {
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
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: route.request().url().includes("/projects")
    ? { id: "crop-test", name: "Crop test", trace_type: traceType, original_image_url: "https://crop.test/source.svg", generated_image_url: null }
    : { credits: 10 } }));
  await page.route("**/api/proxy?*", route => route.fulfill({ contentType: "image/svg+xml", body: sourceSvg }));
  await page.route("**/crop-guide-*.mp4", route => route.fulfill({ status: 204, body: "" }));
  await page.goto("/workspace/crop-test");
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

for (const mode of ["standard", "logo", "pattern"]) {
  test(`${mode} crop keeps its source geometry through drag, resize, zoom and reset`, async ({ page }) => {
    await setupCrop(page, mode);
    const selection = await drawCrop(page);
    const initial = await selectionInSourcePixels(page);
    await page.locator(".crop-workspace-modal").getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(page.locator(".crop-zoom-controls strong")).toHaveText("115%");
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
    await expect(page.locator(".crop-zoom-controls strong")).toHaveText("90%");
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
