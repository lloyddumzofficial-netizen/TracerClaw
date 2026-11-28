import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const source = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><path fill="#404a52" d="M0 0h600v800H0z"/><path fill="#ddd" d="M0 500L600 200v160L0 660z"/></svg>';

test("garment loading percentage advances within real stages and never completes on a timer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  const user = { id: "progress-test-user", email: "progress@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const session = {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test`,
    refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  await page.addInitScript(({ key, value }) => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 0 });
    localStorage.setItem("cookie_consent", "declined");
    localStorage.setItem("desaynclaw_crop_guide_dismissed", "1");
    document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`;
  }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/api/design-extract?scope=access", route => route.fulfill({ json: { enabled: true, refinement: true } }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: route.request().url().includes("/projects")
    ? { id: "progress-test", name: "Progress test", trace_type: "standard", original_image_url: "https://progress.test/crop_source.svg", generated_image_url: null }
    : { credits: 10 } }));
  await page.route("**/api/proxy?*", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
  await page.route("**/progress.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
  await page.route("**/crop-guide-*.mp4", route => route.fulfill({ status: 204, body: "" }));
  const releases = [];
  const stages = [0, 1, 2].map(index => new Promise(resolve => { releases[index] = resolve; }));
  await page.route("**/api/trace", async route => {
    const step = route.request().postDataJSON().step;
    await stages[step - 1];
    await route.fulfill({ json: { persisted: true, fileUrl: `https://progress.test/step-${step}.svg`, mimeType: "image/png" } });
  });
  await page.route("**/api/trace-step3", async route => {
    await stages[2];
    await route.fulfill({ json: { svg_url: "https://progress.test/final.svg" } });
  });
  await page.goto("/workspace/progress-test");
  await expect(page.getByRole("button", { name: "Refine design", exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to crop', exact: true }).click();
  await page.getByRole("button", { name: "Close crop modal" }).click();
  await expect(page.getByLabel("Maya, your garment panel agent")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download all (ZIP)" })).toBeVisible();
  const beforeTracing = page.getByRole("complementary", { name: "Before tracing" });
  await expect(beforeTracing).toBeInViewport({ ratio: 1 });
  const settings = page.locator(".workspace-properties-panel");
  const verifySidebar = async height => {
    await page.setViewportSize({ width: 1440, height });
    await expect(settings.locator(".pp-scroll-region")).toHaveCSS("overflow-y", "clip");
    await expect.poll(() => settings.evaluate(panel => {
      const region = panel.querySelector(".pp-scroll-region");
      const { top, bottom } = region.getBoundingClientRect();
      const items = [...region.querySelectorAll("button, select, aside, dl")];
      const outside = items.filter(item => {
        const rect = item.getBoundingClientRect();
        return !rect.height || rect.top < top - 1 || rect.bottom > bottom + 1;
      }).map(item => item.textContent.trim());
      return { overflow: Math.max(0, region.scrollHeight - region.clientHeight - 1), outside };
    }), { message: `Keep Complete Design controls fit at ${height}px` }).toEqual({ overflow: 0, outside: [] });
  };
  for (const height of [920, 760, 680, 600]) await verifySidebar(height);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("complementary", { name: "Before printing" })).toHaveCount(0);
  await page.getByRole("button", { name: /Run Auto-Trace/ }).click();
  const header = page.locator(".processing-layer-header");
  const bar = page.getByRole("progressbar");
  await expect(header).toContainText("Stage 1 of 3");
  await expect(bar).toHaveAttribute("aria-valuenow", "2");
  await page.clock.fastForward(15000);
  await expect(bar).toHaveAttribute("aria-valuenow", "20");
  await expect(header).toContainText("20%");
  await expect(header).not.toContainText("elapsed");
  await expect(bar).toHaveAttribute("aria-valuetext", /estimated/);
  expect(await bar.evaluate(element => Math.round(element.firstElementChild.getBoundingClientRect().width / element.clientWidth * 100))).toBe(20);
  await page.locator(".processing-layer-panel").screenshot({ path: "scratch/workspace-percentage-restored.png" });
  await page.clock.fastForward(300000);
  await expect(bar).toHaveAttribute("aria-valuenow", "33");
  releases[0]();
  await expect(header).toContainText("Stage 2 of 3");
  await expect(bar).toHaveAttribute("aria-valuenow", "34");
  await page.clock.fastForward(300000);
  await expect(bar).toHaveAttribute("aria-valuenow", "66");
  releases[1]();
  await expect(header).toContainText("Stage 3 of 3");
  const vectorTab = page.getByRole("button", { name: "3. VECTOR SVG", exact: true });
  const hdTab = page.getByRole("button", { name: "2. HD UPSCALE", exact: true });
  await expect(vectorTab).toHaveAttribute("aria-pressed", "true");
  await expect(bar).toHaveAttribute("aria-valuenow", "67");
  await page.clock.fastForward(300000);
  await expect(bar).toHaveAttribute("aria-valuenow", "95");
  releases[2]();
  await expect(bar).toHaveCount(0);
  await expect(hdTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: "Output", exact: true })).toHaveAttribute("src", /step-2\.svg$/);
  await expect(page.getByRole("button", { name: "Close comparison", exact: true })).toHaveCount(0);
  await vectorTab.click();
  await expect(vectorTab).toHaveAttribute("aria-pressed", "true");
  await hdTab.click();
  await expect(page.getByText("Reference · Flat extract · HD upscale · Vector SVG", { exact: true })).toBeVisible();
  const checklist = page.getByRole("complementary", { name: "Before printing" });
  await expect(beforeTracing).toHaveCount(0);
  await expect(checklist).toBeInViewport({ ratio: 1 });
  const alignment = await checklist.evaluate(card => {
    const border = card.getBoundingClientRect();
    const slot = card.parentElement.getBoundingClientRect();
    const actions = card.closest(".pp-scroll-region").querySelector(".pp-actions-section .pp-svg-btn").parentElement.getBoundingClientRect();
    return { top: border.top - slot.top, bottom: slot.bottom - border.bottom, left: border.left - actions.left, right: border.right - actions.right };
  });
  expect(Math.abs(alignment.top - alignment.bottom)).toBeLessThan(1);
  expect(Math.abs(alignment.left)).toBeLessThan(1);
  expect(Math.abs(alignment.right)).toBeLessThan(1);
  await verifySidebar(600);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/design-extract", async route => {
    expect(route.request().postDataJSON()).toEqual({ sourceProjectId: "progress-test" });
    await route.fulfill({ json: { project: { id: "refined-handoff", source_url: "https://progress.test/step-1.svg", manifest: { width: 600, height: 800, layers: [], workspaceMode: "refine" } } } });
  });
  await page.route("**/api/design-extract/refined-handoff", route => route.fulfill({ json: {
    project: { id: "refined-handoff", source_url: "https://progress.test/step-1.svg", manifest: { width: 600, height: 800, layers: [], workspaceMode: "refine" } },
    job: null, billing: { mode: "paid", priceVersion: "design-extract-v1", prices: { refine: 2 }, balance: 10 },
  } }));
  await page.getByRole("button", { name: "Refine design", exact: true }).click();
  await expect(page).toHaveURL(/\/design-extract\/refined-handoff$/);
  await expect(page.getByRole("button", { name: "Refine design · 2 Claws", exact: true })).toBeEnabled();
});
