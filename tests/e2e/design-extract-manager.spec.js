import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";
loadEnvConfig(process.cwd());
test("Design Extract shares the project manager, thumbnail labels and direct upload flow", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const user = { id: "manager-admin", email: "admin@test.com", app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`, refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem("cookie_consent", "declined"); localStorage.setItem("ai_disclaimer_seen", "1"); localStorage.setItem("desaynclaw_onboarded", "true");
    document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`;
  }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  const png = await sharp({ create: { width: 60, height: 80, channels: 4, background: "#146c48" } }).png().toBuffer();
  const source = "https://manager.test/design.png";
  let releaseCreation;
  const creationGate = new Promise(resolve => { releaseCreation = resolve; });
  let releaseFirstList;
  const firstList = new Promise(resolve => { releaseFirstList = resolve; });
  let firstListRequested = false;
  let design = { id: "existing-layers", name: "Jersey elements", trace_type: "design_extract", created_at: new Date().toISOString(), original_image_url: source };
  let existingProject = { id: design.id, revision: 0, source_url: source, manifest: { width: 60, height: 80, layers: [{
    id: "logo", url: source, name: "Logo", width: 60, height: 80, visible: true, locked: false,
    layout: { x: 300, y: 0, scale: 1 }, composition: { x: 0, y: 0, scale: 1 },
  }] } };
  const billing = { mode: "paid", balance: 10, prices: { extract: 2, split: 2, segment: 1 } };
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: route.request().url().includes("/projects") ? [{ id: "garment-1", name: "Garment artwork", trace_type: "mockup", created_at: new Date().toISOString(), original_image_url: source }, { id: "logo-1", name: "Company logo", trace_type: "logo", created_at: new Date().toISOString(), original_image_url: source }] : { credits: 10 } }));
  await page.route("**/api/public-stats", route => route.fulfill({ json: { success: true, totalUsers: 100, reviewCount: 0, avatars: [] } }));
  await page.route("**/api/welcome-trial", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/api/referrals/status", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/api/referral-rewards", route => route.fulfill({ json: { notifications: [], balance: 10 } }));
  await page.route("**/api/proxy?*", route => route.fulfill({ body: png, contentType: "image/png" }));
  await page.route("https://manager.test/**", route => route.fulfill({ body: png, contentType: "image/png" }));
  await page.route("**/api/design-extract**", async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname === "/api/design-extract") {
      if (method === "POST") { expect(route.request().postDataJSON().imageUrl).toBe(source); await creationGate; return route.fulfill({ json: { project: { id: "new-layers", revision: 0, source_url: source, manifest: { width: 60, height: 80, layers: [] } } } }); }
      if (url.searchParams.get("scope") === "availability") return route.fulfill({ json: { enabled: true } });
      if (url.searchParams.get("scope") === "access") return route.fulfill({ json: { enabled: true } });
      if (!firstListRequested) {
        firstListRequested = true;
        await firstList;
        return route.fulfill({ status: 503, json: { error: "Recent projects unavailable" } });
      }
      return route.fulfill({ json: { enabled: true, projects: [design] } });
    }
    if (method === "PATCH") {
      const body = route.request().postDataJSON();
      if (body.action === "rename") {
        design = { ...design, name: body.newName };
        return route.fulfill({ json: { project: design } });
      }
      expect(body.revision).toBe(existingProject.revision);
      existingProject = { ...existingProject, revision: existingProject.revision + 1, manifest: { ...existingProject.manifest, layers: body.layers } };
      return route.fulfill({ json: { project: existingProject } });
    }
    const project = url.pathname.endsWith("/existing-layers") ? existingProject : { id: "new-layers", revision: 0, source_url: source, manifest: { width: 60, height: 80, layers: [] } };
    return route.fulfill({ json: { project, job: null, billing, guidedCutouts: true } });
  });
  await page.route("**/api/upload-url", route => { expect(route.request().postDataJSON().purpose).toBe("design_extract"); return route.fulfill({ json: { uploadUrl: "https://manager.test/upload", publicUrl: source } }); });
  await page.goto("/");
  await expect.poll(() => firstListRequested).toBe(true);
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  const designChoice = page.locator('.new-project-category-grid [data-workspace-card="design_extract"]');
  await expect(designChoice).toBeVisible();
  releaseFirstList();
  await expect(page.locator(".recent-card")).toHaveCount(2);
  await expect(designChoice).toBeVisible();
  await page.getByRole("button", { name: "Close workspace chooser" }).click();
  await page.reload();
  await expect(page.locator(".recent-card")).toHaveCount(3);
  const card = page.locator(".recent-card").filter({ hasText: "Jersey elements" });
  await expect(card.locator(".recent-tool-label")).toHaveText("Design Extract");
  await expect(page.locator(".recent-card").filter({hasText:"Garment artwork"}).locator(".recent-tool-label")).toHaveText("Garment Extract");
  await expect(page.locator(".recent-card").filter({hasText:"Company logo"}).locator(".recent-tool-label")).toHaveText("Logo Vectorizer");
  await expect(card.locator(".recent-thumb")).toHaveCSS("background-image", /manager\.test/);
  await card.locator(".dots-btn").click(); await card.getByRole("button", { name: "Rename", exact: true }).click();
  await page.locator(".inline-edit input").fill("Production elements"); await page.locator(".inline-edit input").press("Enter");
  await expect(page.locator(".recent-name").filter({ hasText: "Production elements" })).toBeVisible();
  await page.screenshot({ path: "output/design-extract-project-manager.png", fullPage: true });
  await page.locator(".recent-card").filter({ hasText: "Production elements" }).click();
  await expect(page).toHaveURL(/\/design-extract\/existing-layers/);
  const wholeDesign = page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true });
  await expect(wholeDesign).toBeEnabled();
  await page.getByRole("button", { name: /^Logo\s/ }).click();
  await page.getByRole("textbox", { name: "Layer name" }).fill("Renamed logo");
  await expect.poll(() => existingProject.revision).toBe(1);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to Home", exact: true }).click();
  await page.locator(".recent-card").filter({ hasText: "Production elements" }).click();
  await expect(wholeDesign).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Renamed logo\s/ })).toBeVisible();
  await page.getByRole("button", { name: "Go to Home", exact: true }).click();
  await expect(page.locator(".recent-card")).toHaveCount(3);
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  const options = page.locator(".new-project-category-grid [data-workspace-card]");
  await expect(options.nth(0)).toHaveAttribute("data-workspace-card", "garment");
  await expect(options.nth(1)).toHaveAttribute("data-workspace-card", "design_extract");
  await expect(page.locator('.new-project-category-grid [data-workspace-card="mockup_studio"]')).toHaveCount(0);
  await page.screenshot({ path: "output/design-extract-picker.png", fullPage: true });
  const choosing = page.waitForEvent("filechooser");
  await page.locator('.new-project-category-grid [data-workspace-card="design_extract"]').click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await (await choosing).setFiles({ name: "flat.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("heading", { name: "Opening Design Extract", exact: true })).toBeVisible();
  const openingRing = page.locator(".workspace-opening-icon > span");
  const firstFrame = await openingRing.evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => openingRing.evaluate(el => getComputedStyle(el).transform)).not.toBe(firstFrame);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedFrame = await openingRing.evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => openingRing.evaluate(el => getComputedStyle(el).transform)).not.toBe(reducedFrame);
  const track = page.locator(".workspace-opening-track span");
  const trackFrame = await track.evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => track.evaluate(el => getComputedStyle(el).transform)).not.toBe(trackFrame);
  await expect(page.locator(".workspace-opening-card")).toHaveCSS("background-color", "rgb(17, 19, 21)");
  await page.screenshot({ path: "output/design-extract-opening-transition.png" });
  releaseCreation();
  await expect(page).toHaveURL(/\/design-extract\/new-layers/);
  await expect(wholeDesign).toBeEnabled();
  await page.goto("/design-extract");
  await expect(page).toHaveURL(/\/#start$/);
  // Hosted pauses and access denial hide entry points as well as project cards.
  await page.route(url => url.pathname === "/api/design-extract", route => route.fulfill({ status: 403, json: { error: "Admin access required" } }));
  await page.reload();
  await expect(page.locator(".recent-card")).toHaveCount(2);
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  await expect(page.locator('.new-project-category-grid [data-workspace-card]').nth(0)).toHaveAttribute("data-workspace-card", "garment");
  await expect(page.locator('.new-project-category-grid [data-workspace-card="design_extract"]')).toHaveCount(0);
  await expect(page.locator('.desktop-tools-shelf').getByRole('heading', {name:'Design Extract',exact:true})).toHaveCount(0);
  await expect(page.locator('.new-project-category-grid [data-workspace-card]').nth(1)).toHaveAttribute("data-workspace-card", "logo");
  const chooser = page.locator('.new-project-category-grid');
  await expect(chooser.locator('[data-workspace-card]')).toHaveCount(4);
  for (const width of [1440, 1000]) {
    await page.setViewportSize({width,height:1000});
    await expect.poll(async () => {
      const grid = await chooser.boundingBox();
      const last = await chooser.locator('[data-workspace-card]').last().boundingBox();
      return Math.abs(grid.x + grid.width - last.x - last.width);
    }).toBeLessThan(2);
  }
  await page.screenshot({ path: "output/design-extract-picker-access-unavailable.png", fullPage: true });

  // A temporary access failure must not hide an enabled workspace.
  let availabilityStatus = 200;
  let workspaceEnabled = true;
  await page.route(url => url.pathname === "/api/design-extract", route => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    return scope === "availability"
      ? route.fulfill({ status: availabilityStatus, json: { enabled: workspaceEnabled } })
      : route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
  });
  await page.reload();
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  await expect(page.locator('.new-project-category-grid [data-workspace-card="design_extract"]')).toBeVisible();

  // A reload during a double outage uses the last known availability.
  availabilityStatus = 503;
  const unavailable = page.waitForResponse(response => response.url().includes("scope=availability") && response.status() === 503);
  await page.reload();
  await unavailable;
  await expect(page.locator(".recent-card")).toHaveCount(2);
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  const designCard = page.locator('.new-project-category-grid [data-workspace-card="design_extract"]');
  await expect(designCard).toBeVisible();

  // A successful retry respects an explicit production pause.
  availabilityStatus = 200;
  workspaceEnabled = false;
  await expect(designCard).toHaveCount(0);
});
