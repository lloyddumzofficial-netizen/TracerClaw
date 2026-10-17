import { expect, test } from "@playwright/test";

const portraitSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200" viewBox="0 0 600 1200">
    <rect width="600" height="1200" fill="#b50018" />
    <path d="M80 1100L300 90l220 1010z" fill="#111" />
    <circle cx="300" cy="540" r="120" fill="#eee" />
  </svg>
`;

test("Pattern Workspace keeps the shared production tools with pattern-specific guidance", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 0 });
    localStorage.setItem("cookie_consent", "declined");
  });

  await page.route("**/rest/v1/projects*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "pattern-workspace-test",
        name: "Pattern workspace test",
        original_image_url: "https://assets.test/crop_pattern.svg",
        generated_image_url: "https://assets.test/generated.svg",
        upscaled_image_url: "https://assets.test/upscaled.svg",
        svg_url: "https://assets.test/output.svg",
        trace_type: "pattern",
        ai_prompt: "PATTERN_PRESERVE",
      }),
    });
  });

  await page.route("**/api/proxy?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: portraitSvg });
  });

  await page.goto("/workspace/pattern-workspace-test");

  await expect(page.getByText("PATTERN WORKSPACE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1. PATTERN RETRACE" })).toBeVisible();
  await expect(page.getByText("AI Retrace Settings", { exact: true })).toBeVisible();
  await expect(page.getByText("Crop to the exact artwork boundary before retracing.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export as SVG/i })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Download All/i })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Palette Preview/i })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Before.*After Compare/i })).toBeEnabled();
});

test("zoomed portrait artwork pans without resizing either canvas pane", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 0 });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(pointer: coarse)"
      ? { ...nativeMatchMedia(query), matches: false }
      : nativeMatchMedia(query);
    localStorage.setItem("cookie_consent", "declined");
  });

  await page.route("**/rest/v1/projects*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "canvas-navigation-test",
        name: "Canvas navigation test",
        original_image_url: "https://assets.test/original.svg",
        generated_image_url: "https://assets.test/generated.svg",
        upscaled_image_url: "https://assets.test/upscaled.svg",
        svg_url: "https://assets.test/output.svg",
        trace_type: "standard",
      }),
    });
  });

  await page.route("**/api/proxy?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: portraitSvg });
  });

  await page.goto("/workspace/canvas-navigation-test");
  const panes = page.locator(".garment-canvas-pane");
  await expect(panes).toHaveCount(2);
  await expect(panes.first()).toBeVisible();

  const initialWidths = await panes.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(Math.abs(initialWidths[0] - initialWidths[1])).toBeLessThanOrEqual(1);

  const leftSurface = page.locator(".workspace-canvas-surface").first();
  const box = await leftSurface.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, -180);
  }

  await expect(page.locator(".workspace-zoom-value")).toHaveText(/(?:4\d\d|500)%/);
  await page.waitForTimeout(250);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 120, { steps: 12 });
  await page.mouse.up();

  const result = await page.evaluate(() => {
    const paneElements = [...document.querySelectorAll(".garment-canvas-pane")];
    const surfaces = [...document.querySelectorAll(".workspace-canvas-surface")];
    const zoomSpaces = [...document.querySelectorAll(".workspace-canvas-zoom-space")];
    const artworks = [...document.querySelectorAll(".workspace-canvas-artwork")];
    return {
      paneWidths: paneElements.map((element) => element.getBoundingClientRect().width),
      surfaceWidths: surfaces.map((element) => element.clientWidth),
      scrollLeft: surfaces.map((element) => element.scrollLeft),
      scrollTop: surfaces.map((element) => element.scrollTop),
      horizontalMargins: zoomSpaces.map((space, index) => (
        space.getBoundingClientRect().width - artworks[index].getBoundingClientRect().width
      )),
    };
  });

  expect(Math.abs(result.paneWidths[0] - result.paneWidths[1])).toBeLessThanOrEqual(1);
  expect(Math.abs(result.paneWidths[0] - initialWidths[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(result.surfaceWidths[0] - result.surfaceWidths[1])).toBeLessThanOrEqual(1);
  expect(Math.abs(result.scrollLeft[0] - result.scrollLeft[1])).toBeLessThanOrEqual(1);
  expect(Math.abs(result.scrollTop[0] - result.scrollTop[1])).toBeLessThanOrEqual(1);
  expect(result.horizontalMargins.every((margin) => margin >= 47 && margin <= 49)).toBe(true);
});

test("stage switch keeps the outline loader visible until the preview is decoded", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("cookie_consent", "declined");
  });

  await page.route("**/rest/v1/projects*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "preview-transition-test",
        name: "Preview transition test",
        original_image_url: "https://assets.test/original.svg",
        generated_image_url: "https://assets.test/generated.svg",
        upscaled_image_url: "https://assets.test/upscaled.svg",
        svg_url: "https://assets.test/output.svg",
        trace_type: "standard",
      }),
    });
  });

  await page.route("**/api/proxy?*", async (route) => {
    if (route.request().url().includes("upscaled.svg")) {
      await new Promise((resolve) => setTimeout(resolve, 360));
    }
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: portraitSvg });
  });

  await page.goto("/workspace/preview-transition-test");
  await page.getByRole("button", { name: "2. HD UPSCALE" }).click();

  const transition = page.locator(".workspace-output-transition");
  await expect(transition).toBeVisible();
  const animatedMark = transition.locator(".workspace-output-mark");
  await expect(animatedMark.locator("svg")).toBeVisible();
  await expect(transition).toContainText("Preparing preview");
  await expect(page.locator(".garment-canvas-pane.is-output .workspace-canvas-artwork")).toHaveClass(/is-preview-preparing/);

  const orbitBefore = await animatedMark.evaluate((element) => getComputedStyle(element, "::before").transform);
  await page.waitForTimeout(140);
  const orbitAfter = await animatedMark.evaluate((element) => getComputedStyle(element, "::before").transform);
  expect(orbitAfter).not.toBe(orbitBefore);

  await expect(transition).toHaveCount(0, { timeout: 2500 });
  await expect(page.locator(".garment-canvas-pane.is-output .workspace-output-raster > img")).toHaveCSS("opacity", "1");
});
