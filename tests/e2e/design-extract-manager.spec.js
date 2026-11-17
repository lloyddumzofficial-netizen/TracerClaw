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
  let design = { id: "existing-layers", name: "Jersey elements", trace_type: "design_extract", created_at: new Date().toISOString(), original_image_url: source };
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: route.request().url().includes("/projects") ? [{ id: "garment-1", name: "Garment artwork", trace_type: "mockup", created_at: new Date().toISOString(), original_image_url: source }] : { credits: 10 } }));
  await page.route("**/api/public-stats", route => route.fulfill({ json: { success: true, totalUsers: 100, reviewCount: 0, avatars: [] } }));
  await page.route("**/api/welcome-trial", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/api/referrals/status", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/api/referral-rewards", route => route.fulfill({ json: { notifications: [], balance: 10 } }));
  await page.route("**/api/proxy?*", route => route.fulfill({ body: png, contentType: "image/png" }));
  await page.route("https://manager.test/**", route => route.fulfill({ body: png, contentType: "image/png" }));
  await page.route("**/api/design-extract**", route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname === "/api/design-extract") {
      if (method === "POST") { expect(route.request().postDataJSON().imageUrl).toBe(source); return route.fulfill({ json: { project: { id: "new-layers" } } }); }
      return route.fulfill({ json: { enabled: true, projects: [design] } });
    }
    if (method === "PATCH") { const body = route.request().postDataJSON(); expect(body.action).toBe("rename"); design = { ...design, name: body.newName }; return route.fulfill({ json: { project: design } }); }
    return route.fulfill({ json: { project: { id: "new-layers", revision: 0, source_url: source, manifest: { width: 60, height: 80, layers: [] } }, job: null } });
  });
  await page.route("**/api/upload-url", route => { expect(route.request().postDataJSON().purpose).toBe("design_extract"); return route.fulfill({ json: { uploadUrl: "https://manager.test/upload", publicUrl: source } }); });
  await page.goto("/");
  await expect(page.locator(".recent-card")).toHaveCount(2);
  const card = page.locator(".recent-card").filter({ hasText: "Jersey elements" });
  await expect(card.locator(".recent-tool-label")).toHaveText("Design Extract");
  await expect(card.locator(".recent-thumb")).toHaveCSS("background-image", /manager\.test/);
  await card.locator(".dots-btn").click(); await card.getByRole("button", { name: "Rename", exact: true }).click();
  await page.locator(".inline-edit input").fill("Production elements"); await page.locator(".inline-edit input").press("Enter");
  await expect(page.locator(".recent-name").filter({ hasText: "Production elements" })).toBeVisible();
  await page.screenshot({ path: "output/design-extract-project-manager.png", fullPage: true });
  await page.locator(".recent-card").filter({ hasText: "Production elements" }).click();
  await expect(page).toHaveURL(/\/design-extract\/existing-layers/);
  await expect(page.getByRole("button", { name: "Extract layers", exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".recent-card")).toHaveCount(2);
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  const options = page.locator(".new-project-category-grid [data-workspace-card]");
  await expect(options.nth(0)).toHaveAttribute("data-workspace-card", "garment");
  await expect(options.nth(1)).toHaveAttribute("data-workspace-card", "design_extract");
  await expect(page.locator('.new-project-category-grid [data-workspace-card="mockup_studio"]')).toHaveCount(0);
  await page.screenshot({ path: "output/design-extract-picker.png", fullPage: true });
  const choosing = page.waitForEvent("filechooser");
  await page.locator('.new-project-category-grid [data-workspace-card="design_extract"]').click();
  await (await choosing).setFiles({ name: "flat.png", mimeType: "image/png", buffer: png });
  await expect(page).toHaveURL(/\/design-extract\/new-layers/);
  await expect(page.getByRole("button", { name: "Extract layers", exact: true })).toBeVisible();
  await page.goto("/design-extract");
  await expect(page).toHaveURL(/\/#start$/);
  // An unavailable/admin-restricted API must not silently remove the option.
  await page.route("**/api/design-extract", route => route.fulfill({ status: 403, json: { error: "Admin access required" } }));
  await page.reload();
  await expect(page.locator(".recent-card")).toHaveCount(1);
  await page.getByRole("button", { name: "New Project", exact: true }).first().click();
  await expect(page.locator('.new-project-category-grid [data-workspace-card]').nth(0)).toHaveAttribute("data-workspace-card", "garment");
  await expect(page.locator('.new-project-category-grid [data-workspace-card]').nth(1)).toHaveAttribute("data-workspace-card", "design_extract");
  await page.screenshot({ path: "output/design-extract-picker-access-unavailable.png", fullPage: true });
});
