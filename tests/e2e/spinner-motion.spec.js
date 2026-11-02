import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import JSZip from "jszip";

loadEnvConfig(process.cwd());
const source = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><path fill="#ddd" d="M0 0h600v800H0z"/></svg>';

async function expectRotating(spinner) {
  await expect(spinner).toBeVisible();
  const first = await spinner.evaluate(element => {
    const animation = element.getAnimations().find(item => item.playState === "running");
    return { time: animation?.currentTime, transform: getComputedStyle(element).transform, iterations: animation?.effect.getTiming().iterations };
  });
  expect(first.iterations).toBe(Infinity);
  await expect.poll(() => spinner.evaluate(element => getComputedStyle(element).transform)).not.toBe(first.transform);
  expect(await spinner.evaluate(element => element.getAnimations()[0].currentTime)).toBeGreaterThan(first.time);
}

for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`ZIP download and shared spinners keep rotating with motion ${reducedMotion}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion });
    const user = { id: "spinner-test-user", email: "spinner@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
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
      ? { id: "spinner-test", name: "Spinner test", trace_type: "standard", original_image_url: "https://spinner.test/crop_source.svg", generated_image_url: null }
      : { credits: 10 } }));
    const zip = new JSZip();
    zip.file("source.svg", source);
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    await page.route("**/api/proxy?*", route => route.fulfill(route.request().url().includes("output.zip")
      ? { contentType: "application/zip", body: zipBytes }
      : { contentType: "image/svg+xml", body: source }));
    await page.route("**/spinner.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
    await page.route("**/crop-guide-*.mp4", route => route.fulfill({ status: 204, body: "" }));
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let request;
    await page.route("**/api/prepare-zip", async route => {
      request = route.request().postDataJSON();
      await pending;
      await route.fulfill({ json: { zipUrl: "https://spinner.test/output.zip", fileName: "Spinner-test.zip" } });
    });
    await page.goto("/workspace/spinner-test");
    await page.getByRole("button", { name: "Close crop modal" }).click();
    const button = page.getByRole("button", { name: /Download All \(ZIP\)/i });
    await button.click();
    await expect(button).toBeDisabled();
    const spinner = button.locator(".pp-spin");
    // Let one animation cycle finish: a one-shot reduced-motion animation
    // would now be frozen even though the download request remains pending.
    await page.waitForTimeout(2000);
    await expectRotating(spinner);
    expect(request).toEqual({ projectId: "spinner-test" });
    const download = page.waitForEvent("download");
    release();
    expect((await download).suggestedFilename()).toBe("Spinner-test.zip");
    await expect(spinner).toHaveCount(0);
    await expect(button).toBeEnabled();

    // Exercise the shared CSS used by upload, sign-in, crop-save and palette
    // indicators inside the same route-level reduced-motion cascade.
    await page.locator(".garment-workspace-ui").evaluate(container => {
      for (const className of ["animate-spin", "crop-saving-spinner", "node-spinner"]) {
        const element = document.createElement("span");
        element.className = className;
        element.dataset.motionProbe = className;
        element.style.cssText = "position:fixed;top:100px;left:100px;width:20px;height:20px;display:block";
        container.appendChild(element);
      }
    });
    for (const className of ["animate-spin", "crop-saving-spinner", "node-spinner"]) {
      await expectRotating(page.locator(`[data-motion-probe="${className}"]`));
    }
  });
}
