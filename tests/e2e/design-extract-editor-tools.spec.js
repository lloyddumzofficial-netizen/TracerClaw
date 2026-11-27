import { test, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

test("layer search, visibility filters, focus and safe keyboard editing", async ({ page }) => {
  const user = { id: "editor-user", email: "admin@test.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test`, refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  await page.addInitScript(({ key, value }) => { document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`; localStorage.setItem("cookie_consent", "declined"); }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  const source = "https://editor-assets.test/source.svg";
  const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#FFD700"/><circle cx="50" cy="70" r="30" fill="#111"/></svg>';
  await page.route("https://editor-assets.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: artwork }));
  let project = { id: "editor-tools", revision: 0, source_url: source, manifest: { version: 1, width: 800, height: 1200, layers: ["Team mark", "Print pattern"].map((name, index) => ({ id: `layer-${index}`, name, url: source, width: 100, height: 140, visible: !index, locked: false, layout: { x: 300 + index * 300, y: 0, scale: 1 }, composition: { x: index * 100, y: 0, scale: 1 } })) } };
  let saves = 0, generations = 0;
  let finishAllowance = { state: "locked", remaining: { upscale: 2, svg: 2 } };
  await page.route("**/api/design-extract/editor-tools/finish?*", route => route.fulfill({ json: { allowance: finishAllowance } }));
  await page.route("**/api/design-extract/editor-tools", route => {
    if (route.request().method() === "PATCH") {
      saves++; project = { ...project, revision: project.revision + 1, manifest: { ...project.manifest, layers: route.request().postDataJSON().layers } };
      return route.fulfill({ json: { project } });
    }
    if (route.request().method() === "POST") { generations++; return route.fulfill({ status: 400, json: { error: "No AI operations expected" } }); }
    return route.fulfill({ json: { project, job: null } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/design-extract/editor-tools");
  const list = page.locator('[class*="layerList"]');
  const search = page.getByRole("textbox", { name: "Search layers", exact: true });
  await expect(list.getByRole("button")).toHaveCount(2);
  await search.fill("team");
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByRole("button", { name: /Team mark/ })).toBeVisible();
  await search.fill("");
  await page.getByRole("combobox", { name: "Filter layers" }).selectOption("hidden");
  await expect(list.getByRole("button")).toHaveCount(1);
  await list.getByRole("button", { name: /Print pattern/ }).click();
  await expect(page.getByRole("button", { name: "Focus layer", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Show Print pattern", exact: true }).click();
  await expect(page.getByText("No matching layers", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(2);
  await list.getByRole("button", { name: /Team mark/ }).click();
  const selected = page.getByRole("button", { name: "Select Team mark", exact: true });
  await page.keyboard.press("f");
  await expect(selected).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Shift+F");
  await expect(page.getByAltText("Original flat design", { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Select Print pattern", exact: true })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Delete");
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(list.getByRole("button")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(list.getByRole("button")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await list.getByRole("button", { name: /Team mark/ }).click();
  const name = page.getByLabel("Layer name", { exact: true });
  await name.fill("Team badge");
  await name.press("Delete");
  await expect(list.getByRole("button")).toHaveCount(2);
  await name.press("Control+s");
  await expect.poll(() => project.manifest.layers[0].name).toBe("Team badge");
  expect(saves).toBeGreaterThan(0);
  await page.getByLabel("Keyboard shortcuts", { exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts", exact: true })).toBeHidden();
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel("Keyboard shortcuts", { exact: true }).click();
    await expect(page.locator("[data-shortcut-popover]")).toBeInViewport({ ratio: 1 });
    expect(await page.getByRole("group", { name: "Extract artwork" }).locator("..").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
  }
  expect(project.manifest.layers).toHaveLength(2);
  expect(project.source_url).toBe(source);
  expect(generations).toBe(0);
  await page.screenshot({ path: "output/design-extract-editor-tools.png" });

  let checks = 0;
  await page.route("**/api/design-extract/editor-tools/remove-background", route => {
    if (++checks === 1) return route.fulfill({ status: 202, json: { pending: true } });
    const cutout = { ...project.manifest.layers[0], id: "cutout", name: "Team badge · Cutout",
      backgroundRemoval: true, layout: { x: 360, y: 2600, scale: 1 } };
    project = { ...project, revision: project.revision + 1, manifest: { ...project.manifest, layers: [...project.manifest.layers, cutout] } };
    return route.fulfill({ json: { project, layerId: cutout.id } });
  });
  await list.getByRole("button", { name: /Team badge/ }).click();
  await expect(page.getByText("Unlock both once · 1 Claw", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove background", exact: true }).click();
  await expect(page.getByRole("button", { name: "Removing background…" })).toBeDisabled();
  const sourceLayer = page.getByRole("button", { name: "Select Team badge", exact: true });
  const sourceRow = list.getByRole("button", { name: /Team badge/ });
  await expect(sourceLayer.getByRole("region", { name: "Background removal progress" })).toBeVisible();
  await expect.poll(async () => (await sourceLayer.boundingBox())?.width).toBeGreaterThan(240);
  await expect(sourceRow.locator('[class*="thumbnailProgress"]')).toBeVisible();
  const cutout = page.getByRole("button", { name: "Select Team badge · Cutout", exact: true });
  await expect(cutout).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => (await cutout.boundingBox())?.width).toBeGreaterThan(160);
  await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue("Team badge · Cutout");
  await expect(sourceLayer.getByRole("region", { name: "Background removal progress" })).toHaveCount(0);
  await expect(list.locator('[class*="thumbnailProgress"]')).toHaveCount(0);
  expect(checks).toBe(2);

  let finishUpscale;
  const upscaleResponse = new Promise(resolve => { finishUpscale = resolve; });
  await page.route("**/api/design-extract/editor-tools/upscale", async route => {
    await upscaleResponse;
    finishAllowance = { state: "unlocked", remaining: { upscale: 1, svg: 2 } };
    return route.fulfill({ json: { project } });
  });
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect.poll(async () => (await cutout.boundingBox())?.width).toBeLessThan(110);
  await page.getByRole("button", { name: "Upscale image", exact: true }).click();
  const cutoutRow = list.getByRole("button", { name: /Team badge · Cutout/ });
  try {
    await expect(cutout.getByRole("region", { name: "Image upscale progress" })).toBeVisible();
    await expect.poll(async () => (await cutout.boundingBox())?.width).toBeGreaterThan(240);
    await expect(cutoutRow.locator('[class*="thumbnailProgress"]')).toBeVisible();
  } finally {
    finishUpscale();
  }
  await expect(cutout.getByRole("region", { name: "Image upscale progress" })).toHaveCount(0);
  await expect(cutoutRow.locator('[class*="thumbnailProgress"]')).toHaveCount(0);
  await expect(page.getByText("Unlocked for this extraction", { exact: true })).toBeVisible();
  await expect(page.getByText("1 left", { exact: true })).toBeVisible();
  await expect(page.getByText("2 left", { exact: true })).toBeVisible();
});
