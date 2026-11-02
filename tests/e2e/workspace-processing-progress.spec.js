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
  await page.getByRole("button", { name: "Close crop modal" }).click();
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
  await expect(bar).toHaveAttribute("aria-valuenow", "67");
  await page.clock.fastForward(300000);
  await expect(bar).toHaveAttribute("aria-valuenow", "95");
  releases[2]();
  await expect(bar).toHaveCount(0);
});
