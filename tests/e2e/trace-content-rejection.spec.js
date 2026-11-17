import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

for (const code of ["AI_CONTENT_BLOCKED", "AI_PROVIDER_UNAVAILABLE"]) {
test(`${code} explains the provider failure without a console exception or automatic retry`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const user = { id: "moderation-test-user", email: "moderation@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test`, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  await page.addInitScript(({ key, value }) => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 0 });
    localStorage.setItem("cookie_consent", "declined");
    localStorage.setItem("desaynclaw_crop_guide_dismissed", "1");
    document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`;
  }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: route.request().url().includes("/projects")
    ? { id: "moderation-test", name: "Moderation test", trace_type: "mockup", original_image_url: "https://rejection.test/crop_source.svg", generated_image_url: null }
    : { credits: 10 } }));
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><path fill="#404a52" d="M0 0h600v800H0z"/></svg>';
  await page.route("**/api/proxy?*", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
  await page.route("**/rejection.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
  await page.route("**/api/integrations/status", route => route.fulfill({ json: { googleDrive: { connected: false } } }));
  let requests = 0, refundRequests = 0;
  const message = (code === "AI_CONTENT_BLOCKED"
    ? "The AI provider's automated content check stopped this generation. Your workspace is still available."
    : "The AI provider couldn't complete this request right now. Your workspace is still available.")
    + " The Claw used for this attempt has been refunded.";
  await page.route("**/api/trace", route => { requests++; return route.fulfill({ status: code === "AI_CONTENT_BLOCKED" ? 422 : 503, json: { error: message, code, refunded: true, retryable: false } }); });
  await page.route("**/api/refund", route => { refundRequests++; return route.fulfill({ json: { success: true } }); });
  const exceptions = [];
  page.on("pageerror", error => exceptions.push(error.message));
  page.on("console", event => { if (event.type() === "error" && event.text().includes("[Trace Error]")) exceptions.push(event.text()); });
  await page.goto("/workspace/moderation-test");
  await page.getByRole("button", { name: "Close crop modal" }).click();
  const run = page.getByRole("button", { name: /Run Auto-Trace/ });
  await run.click();
  await expect(page.getByText(message, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('alert').getByText("We couldn't finish this step", { exact: true })).toBeVisible();
  await expect(page.getByText('Your source image is still available.', { exact: false })).toBeVisible();
  await expect(run).toBeEnabled();
  expect(requests).toBe(1);
  expect(refundRequests).toBe(0);
  expect(exceptions).toEqual([]);
});
}
