import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";

loadEnvConfig(process.cwd());
const assetHost = "https://image-tool.test";
const user = { id: "image-tool-test-user", email: "image-tool@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };

async function setup(page, { completed = false, credits = 16 } = {}) {
  await page.setViewportSize({ width: 1800, height: 1000 });
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const tokenPart = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${tokenPart({ alg: "HS256", typ: "JWT" })}.${tokenPart({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test-signature`;
  const session = { access_token: token, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  await page.addInitScript(({ cookie, session }) => {
    localStorage.setItem("cookie_consent", "declined");
    document.cookie = `${cookie}=base64-${session}; path=/; SameSite=Lax`;
  }, { cookie: `sb-${reference}-auth-token`, session: Buffer.from(JSON.stringify(session)).toString("base64url") });

  const cutout = await readFile("public/tool-agent-cutouts/yellow-v2/04-bg-remover-agent.png");
  const source = await sharp(cutout).flatten({ background: "#dce0dc" }).png().toBuffer();
  const project = { id: "bg-ui-test", name: "Cora sample", trace_type: "bg_remover", original_image_url: `${assetHost}/source.png`, generated_image_url: completed ? `${assetHost}/cutout.png` : null };
  const requests = { uploads: [], removals: [], storage: 0 };
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => {
    const url = route.request().url();
    return route.fulfill({ json: url.includes("trace_type=eq.upscale") ? [] : url.includes("/projects") ? project : url.includes("/profiles") ? { credits } : [] });
  });
  await page.route(`${assetHost}/**`, route => {
    if (route.request().method() === "PUT") { requests.storage++; return route.fulfill({ status: 200, body: "" }); }
    return route.fulfill({ contentType: "image/png", body: route.request().url().endsWith("cutout.png") ? cutout : source });
  });
  await page.route("**/api/upload-url", route => route.fulfill({ json: { uploadUrl: `${assetHost}/upload`, publicUrl: `${assetHost}/source.png` } }));
  await page.route("**/api/upload", route => {
    requests.uploads.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, projectId: project.id } });
  });
  await page.route("**/api/proxy?*", route => route.fulfill({ contentType: "image/png", body: cutout }));
  await page.route("**/api/public-stats", route => route.fulfill({ json: { success: true, totalUsers: 1, completedExtractions: 1, reviewCount: 0, avatars: [] } }));
  return { source, project, requests };
}

test("background remover uses the shared onboarding, split workspace, processing and export UI", async ({ page }) => {
  const fixture = await setup(page);
  let finish;
  const processing = new Promise(resolve => { finish = resolve; });
  await page.route("**/api/remove-bg", async route => {
    fixture.requests.removals.push(route.request().postDataJSON());
    await processing;
    await route.fulfill({ json: { transparent_image_url: `${assetHost}/cutout.png` } });
  });
  await page.goto("/bg-remover");
  await expect(page.getByRole("heading", { name: /Keep the subject\.\s*Remove the rest\./ })).toBeVisible();
  await expect(page.getByAltText("Cora, the DesaynClaw Cutout Agent")).toBeVisible();
  await expect(page.getByText("20MB", { exact: false })).toBeVisible();
  await page.screenshot({ path: "scratch/bg-remover-entry.png" });
  await page.locator('input[type="file"]').setInputFiles({ name: "Cora source.png", mimeType: "image/png", buffer: fixture.source });
  await expect(page).toHaveURL(/\/bg-remover\/bg-ui-test$/);
  expect(fixture.requests.storage).toBe(1);
  expect(fixture.requests.uploads[0]).toMatchObject({ traceType: "bg_remover", imageUrl: `${assetHost}/source.png` });
  const panel = page.getByRole("complementary", { name: "Background Removal Settings", exact: true });
  await expect(panel.getByText("Cora", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download Transparent PNG" })).toBeDisabled();
  await panel.getByRole("button", { name: "Close settings panel" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Open Background Removal Settings" }).click();
  await expect(panel.getByRole("button", { name: "Close settings panel" })).toBeFocused();
  await expect(page.getByText("1. Remove Background", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Remove background", exact: true }).click();
  await expect(page.getByText("Stage 1 of 1", { exact: false })).toBeVisible();
  expect(fixture.requests.removals[0]).toMatchObject({ projectId: "bg-ui-test", keepOriginal: true });
  expect(fixture.requests.removals[0].requestKey).toBeTruthy();
  finish();
  await expect(page.getByAltText("Artwork with transparent background")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download Transparent PNG" })).toBeEnabled();
  await expect(page.locator(".studio-credit-pill > span")).toHaveText("15");
  await panel.getByRole("button", { name: "Light", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("status", { name: "Zoom 125 percent" })).toHaveText("125%");
  await page.getByRole("button", { name: "Fit artwork to canvas" }).click();
  await page.screenshot({ path: "scratch/bg-remover-workspace.png" });
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download Transparent PNG" }).click();
  expect((await download).suggestedFilename()).toContain("Transparent.png");
  await panel.getByRole("button", { name: /New Image/i }).click();
  await expect(page).toHaveURL(/\/bg-remover$/);
  await expect(page.getByRole("button", { name: "Browse image" })).toBeVisible();
});

test("failed removal retains the source and can be retried; completed projects restore transparently", async ({ page }) => {
  await setup(page);
  let attempts = 0;
  await page.route("**/api/remove-bg", route => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 500, json: { error: "Cutout failed. Please retry." } })
      : route.fulfill({ json: { transparent_image_url: `${assetHost}/cutout.png` } });
  });
  await page.goto("/bg-remover/bg-ui-test");
  await page.getByRole("button", { name: "Remove background", exact: true }).last().click();
  await expect(page.getByText("Cutout failed. Please retry.", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Original uploaded artwork")).toBeVisible();
  await page.getByRole("button", { name: "Try background removal again" }).click();
  await expect(page.getByAltText("Artwork with transparent background")).toBeVisible();
  expect(attempts).toBe(2);
});

test("completed background removal fits shorter screens and preserves the correct agent", async ({ page }) => {
  await setup(page, { completed: true });
  await page.setViewportSize({ width: 1366, height: 650 });
  await page.goto("/bg-remover/bg-ui-test");
  const panel = page.getByRole("complementary", { name: "Background Removal Settings", exact: true });
  await expect(panel.getByText("Cora", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Artwork with transparent background")).toBeVisible();
  const bounds = await panel.evaluate(el => {
    const card = el.querySelector('[aria-label="Cora, your cutout agent"]');
    const footer = el.querySelector("footer");
    const cardBounds = card.getBoundingClientRect();
    return { cardFits: cardBounds.bottom <= footer.getBoundingClientRect().top && cardBounds.height >= 80, scrolls: el.scrollHeight > el.clientHeight };
  });
  expect(bounds).toEqual({ cardFits: true, scrolls: false });
  await expect(panel.getByText(/6×|Luma|Upscale/)).toHaveCount(0);
  await page.screenshot({ path: "scratch/bg-remover-short-screen.png" });
});

test("background remover entry retains the desktop guard", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/bg-remover");
  await expect(page.getByRole("button", { name: "Browse image" })).toHaveCount(0);
  await expect(page.getByText(/desktop|computer|laptop/i).first()).toBeVisible();
});

test("the shared template preserves the Image Upscaler entry and split workspace", async ({ page }) => {
  const fixture = await setup(page);
  let submitted;
  await page.route("**/api/upscale", async route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, requestId: "topaz-ui-job", projectId: "upscale-test" } });
  });
  await page.route("**/api/upscale?*", route => route.fulfill({ json: { success: true, status: "COMPLETED", upscaledUrl: `${assetHost}/cutout.png` } }));
  await page.goto("/upscale");
  await expect(page.getByRole("heading", { name: /Recover detail\.\s*Keep the design\./ })).toBeVisible();
  await expect(page.getByAltText("Luma, the DesaynClaw Resolution Agent")).toBeVisible();
  await expect(page.getByText("Maximum 1.5 MP source · 24 MP output")).toBeVisible();
  const smallSource = await sharp(fixture.source).resize({ width: 1000 }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "source.png", mimeType: "image/png", buffer: smallSource });
  await expect(page.getByText("1. Image Upscale", { exact: true })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Image Upscale Settings", exact: true });
  await expect(panel.getByText("Luma", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run precision upscale", exact: true }).first()).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Download Upscaled PNG" })).toBeDisabled();
  await expect(panel.getByText("Cora", { exact: true })).toHaveCount(0);
  await panel.getByRole("combobox", { name: "Image type" }).selectOption("logo");
  await expect(panel.getByText("4×", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Run precision upscale", exact: true }).click();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  expect(submitted.profile).toBe("logo");
  await expect(panel.getByRole("button", { name: "Download Upscaled PNG" })).toBeEnabled();
  await expect(page.getByText("Rate this generation", { exact: false })).toHaveCount(0);
  const agentCard = panel.getByRole("complementary", { name: "Luma, your resolution agent" });
  const agentBounds = await agentCard.boundingBox();
  const panelBounds = await panel.boundingBox();
  expect(agentBounds.y + agentBounds.height).toBeLessThan(panelBounds.y + panelBounds.height);
  await page.screenshot({ path: "scratch/topaz-upscale-workspace.png" });
});

test("oversized upscale sources are blocked before uploading or charging", async ({ page }) => {
  const fixture = await setup(page);
  await page.goto("/upscale");
  await page.locator('input[type="file"]').setInputFiles({ name: "large.png", mimeType: "image/png", buffer: fixture.source });
  await expect(page.getByText(/Choose an image up to 1.5 MP/)).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Image Upscale Settings", exact: true });
  await expect(panel.getByRole("button", { name: "Run precision upscale", exact: true })).toBeDisabled();
  expect(fixture.requests.storage).toBe(0);
  expect(fixture.requests.uploads).toHaveLength(0);
});

test("recent upscale projects open the correct saved result without another generation", async ({ page }) => {
  const fixture = await setup(page);
  const saved = { id: "saved-upscale", name: "Saved client logo", trace_type: "upscale", original_image_url: `${assetHost}/source.png`, generated_image_url: `${assetHost}/cutout.png`, ai_prompt: "fal:topaz/upscale/image/precision:saved-job", client_request_id: "saved-request", created_at: new Date().toISOString() };
  await page.addInitScript(() => {
    localStorage.setItem("ai_disclaimer_seen", "1");
    localStorage.setItem("claw-agents-promo-seen-v1", String(Date.now()));
    localStorage.setItem("onboarding_seen", "1");
  });
  await page.route("**/rest/v1/projects*", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("id")) {
      expect(url.searchParams.get("user_id")).toBe(`eq.${user.id}`);
      expect(url.searchParams.get("trace_type")).toBe("eq.upscale");
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: [saved] });
  });
  let submissions = 0;
  await page.route("**/api/upscale", route => { submissions++; return route.abort(); });
  await page.goto("/");
  await page.getByRole("button", { name: /Saved client logo/ }).click();
  await expect(page).toHaveURL(/\/upscale\?projectId=saved-upscale$/);
  await expect(page.getByRole("heading", { name: "UPSCALE STUDIO", exact: true })).toBeVisible();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Upscaled PNG" })).toBeEnabled();
  await page.getByRole("button", { name: "Close settings panel" }).click();
  await page.getByRole("button", { name: "Open Image Upscale Settings" }).click();
  await expect(page.getByRole("button", { name: "Download Upscaled PNG" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Close settings panel" })).toBeFocused();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Upscaled PNG" }).click();
  expect((await downloaded).suggestedFilename()).toContain("upscaled_");
  expect(submissions).toBe(0);
  expect(fixture.requests.storage).toBe(0);
  await page.getByRole("button", { name: /New Image/i }).click();
  await expect(page).toHaveURL(/\/upscale$/);
  await expect(page.getByRole("button", { name: "Browse image" })).toBeVisible();
});

test("a missing saved upscale offers recovery without starting a generation", async ({ page }) => {
  await setup(page);
  await page.route("**/rest/v1/projects*", route => route.fulfill({ json: null }));
  await page.goto("/upscale?projectId=expired-project");
  await expect(page.getByRole("alert").filter({ hasText: "unavailable or has expired" })).toBeVisible();
  await page.getByRole("button", { name: "Choose another image" }).click();
  await expect(page).toHaveURL(/\/upscale$/);
  await expect(page.getByRole("button", { name: "Browse image" })).toBeVisible();
});

test("opening another saved project cannot display an older job's late result", async ({ page }) => {
  await setup(page, { credits: 0 });
  const base = { trace_type: "upscale", original_image_url: `${assetHost}/source.png`, created_at: new Date().toISOString(), refunded: false };
  let finish;
  let requested;
  let returned = false;
  const pending = new Promise(resolve => { finish = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  let submissions = 0;
  await page.route("**/api/upscale", route => { submissions++; return route.abort(); });
  await page.route("**/rest/v1/projects*", route => {
    const id = new URL(route.request().url()).searchParams.get("id")?.replace("eq.", "");
    return route.fulfill({ json: { ...base, id, name: id, ai_prompt: `fal:topaz/upscale/image/precision:${id}`, generated_image_url: id === "ready-project" ? `${assetHost}/cutout.png` : null } });
  });
  await page.route("**/api/upscale?*", async route => {
    requested();
    await pending;
    await route.fulfill({ json: { status: "COMPLETED", upscaledUrl: `${assetHost}/source.png` } });
    returned = true;
  });
  await page.goto("/upscale?projectId=pending-project");
  await started;
  await page.evaluate(() => window.history.pushState(null, "", "/upscale?projectId=ready-project"));
  const result = page.getByAltText("Upscaled artwork", { exact: true });
  await expect(result).toHaveAttribute("src", `${assetHost}/cutout.png`);
  finish();
  await expect.poll(() => returned).toBe(true);
  await expect(result).toHaveAttribute("src", `${assetHost}/cutout.png`);
  await expect(page.getByRole("button", { name: "Download Upscaled PNG" })).toBeEnabled();
  expect(submissions).toBe(0);
});

test("a refunded historical job allows choosing a profile for a fresh generation", async ({ page }) => {
  const fixture = await setup(page);
  const source = await sharp(fixture.source).resize({ width: 1000 }).png().toBuffer();
  await page.route(`${assetHost}/source.png`, route => route.fulfill({ contentType: "image/png", body: source }));
  await page.route("**/rest/v1/projects*", route => route.fulfill({ json: {
    id: "old-paid-project", name: "Historical artwork", original_image_url: `${assetHost}/source.png`,
    generated_image_url: null, ai_prompt: "fal:topaz/upscale/image/precision:old-job", created_at: new Date().toISOString(),
  } }));
  await page.route("**/api/upscale?*", route => route.fulfill({ status: 500, json: { error: "This generation failed and was refunded.", refunded: true } }));
  let submitted;
  await page.route("**/api/upscale", route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { projectId: "new-project", status: "COMPLETED", upscaledUrl: `${assetHost}/cutout.png` } });
  });
  await page.goto("/upscale?projectId=old-paid-project");
  const profile = page.getByRole("combobox", { name: "Image type" });
  await expect(profile).toBeEnabled();
  await profile.selectOption("logo");
  await page.getByRole("button", { name: "Try upscale again", exact: true }).click();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/upscale$/);
  expect(submitted.profile).toBe("logo");
  expect(submitted.idempotencyKey).not.toBe("restored-old-paid-project");
});

test("queued upscale progress reports elapsed time and handles a longer wait without a fake percentage", async ({ page }) => {
  const fixture = await setup(page);
  await page.clock.install();
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  let polls = 0;
  await page.route("**/api/upscale", route => route.fulfill({ json: { projectId: "queued-project", requestId: "queued-job" } }));
  await page.route("**/api/upscale?*", async route => {
    polls++;
    if (polls === 1) return route.fulfill({ json: { status: "IN_QUEUE" } });
    await completed;
    await route.fulfill({ json: { status: "COMPLETED", upscaledUrl: `${assetHost}/cutout.png` } });
  });
  await page.goto("/upscale");
  const source = await sharp(fixture.source).resize({ width: 1000 }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "source.png", mimeType: "image/png", buffer: source });
  await page.getByRole("button", { name: "Run precision upscale", exact: true }).last().click();
  await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  await expect(page.locator(".processing-layer-header")).not.toContainText("%");
  await page.clock.fastForward(46000);
  await expect(page.getByText("Taking longer than usual. Your source is still available.")).toBeVisible();
  await expect(page.locator(".processing-layer-header")).toContainText("elapsed");
  await page.screenshot({ path: "scratch/ux-upscale-queued.png" });
  finish();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
});

test("workspace chooser supports keyboard selection, trapped focus and Escape", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem("ai_disclaimer_seen", "1");
    localStorage.setItem("claw-agents-promo-seen-v1", String(Date.now()));
    localStorage.setItem("onboarding_seen", "1");
  });
  await page.route("**/rest/v1/projects*", route => route.fulfill({ json: [] }));
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "New Project", exact: true }).first();
  await trigger.click();
  const chooser = page.getByRole("dialog", { name: "Choose a workspace" });
  await expect(chooser.getByRole("button", { name: "Garment Extract", exact: true })).toBeFocused();
  await chooser.screenshot({ path: "scratch/workspace-monochrome-icons.png" });
  await page.keyboard.press("Tab");
  await expect(chooser.getByRole("button", { name: "Logo Vectorizer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const details = page.getByRole("dialog", { name: "New project details" });
  await expect(details.locator('input[type="text"]')).toBeFocused();
  await details.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(details.getByRole("button", { name: "Close workspace chooser" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Claw messages show the required amount and actual balance for Precision SVG", async ({ page }) => {
  await setup(page, { credits: 1 });
  await page.addInitScript(() => localStorage.setItem("desaynclaw_crop_guide_dismissed", "1"));
  const project = { id: "credit-ui-project", name: "Client logo", trace_type: "logo", original_image_url: `${assetHost}/crop_source.png`, generated_image_url: null, upscaled_image_url: null, svg_url: null };
  await page.route("**/rest/v1/projects*", route => route.fulfill({ json: project }));
  await page.route("**/api/integrations/status", route => route.fulfill({ json: { googleDrive: { connected: false } } }));
  await page.goto("/workspace/credit-ui-project");
  await page.getByRole("button", { name: "Close crop modal" }).click();
  await page.getByRole("button", { name: /Precision SVG/ }).click();
  await expect(page.getByText("Requires 2 Claws. Your balance: 1 Claw.", { exact: true })).toBeVisible();
  await page.screenshot({ path: "scratch/ux-claw-balance.png" });
});

test("a server-rejected charge uses an accurate credit dialog and supports Escape", async ({ page }) => {
  await setup(page, { credits: 2 });
  await page.addInitScript(() => localStorage.setItem("desaynclaw_crop_guide_dismissed", "1"));
  const project = { id: "credit-dialog-project", name: "Client logo", trace_type: "logo", original_image_url: `${assetHost}/crop_source.png`, generated_image_url: null, upscaled_image_url: null, svg_url: null };
  await page.route("**/rest/v1/projects*", route => route.fulfill({ json: project }));
  await page.route("**/api/integrations/status", route => route.fulfill({ json: { googleDrive: { connected: false } } }));
  await page.route("**/api/trace", route => route.fulfill({ status: 403, json: { error: "INSUFFICIENT_CREDITS" } }));
  await page.goto("/workspace/credit-dialog-project");
  await page.getByRole("button", { name: "Close crop modal" }).click();
  await page.getByRole("button", { name: /Precision SVG/ }).click();
  const run = page.getByRole("button", { name: /Run Auto-Trace/ });
  await run.click();
  const dialog = page.getByRole("dialog", { name: "More Claws needed" });
  await expect(dialog).toContainText("This action requires 2 Claws. Your balance is 0 Claws.");
  await expect(dialog).not.toContainText("0 Traces Remaining");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("an uncertain upscale POST retries the same paid attempt and restores its download after reload", async ({ page }) => {
  const fixture = await setup(page);
  const source = await sharp(fixture.source).resize({ width: 1000 }).png().toBuffer();
  await page.route(`${assetHost}/source.png`, route => route.fulfill({ contentType: "image/png", body: source }));
  const submissions = [];
  await page.route("**/api/upscale", route => {
    submissions.push(route.request().postDataJSON());
    return submissions.length === 1 ? route.abort("failed")
      : route.fulfill({ json: { success: true, status: "IN_QUEUE", projectId: "recovered-job", requestId: "same-provider-job" } });
  });
  await page.route("**/api/upscale?*", route => route.fulfill({ json: { status: "COMPLETED", upscaledUrl: `${assetHost}/cutout.png` } }));
  await page.goto("/upscale");
  await page.locator('input[type="file"]').setInputFiles({ name: "source.png", mimeType: "image/png", buffer: source });
  await page.getByRole("button", { name: "Run precision upscale", exact: true }).last().click();
  await page.getByRole("button", { name: "Try upscale again", exact: true }).click();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(fixture.requests.storage).toBe(1);
  await page.reload();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Upscaled PNG" })).toBeEnabled();
  expect(submissions).toHaveLength(2);
  await page.getByRole("button", { name: /New Image/i }).click();
  await expect(page.getByRole("button", { name: "Browse image" })).toBeVisible();
});

test("a stored pending paid upscale resumes even with zero remaining credits", async ({ page }) => {
  const fixture = await setup(page, { credits: 0 });
  let submissions = 0;
  let polls = 0;
  await page.addInitScript(({ assetHost, userId }) => {
    sessionStorage.setItem(`desaynclaw:upscale-attempt:${userId}`, JSON.stringify({
      requestKey: "saved-paid-attempt", imageUrl: `${assetHost}/source.png`, profile: "artwork", name: "Restored source.png", projectId: "pending-project", createdAt: Date.now(),
    }));
  }, { assetHost, userId: user.id });
  const source = await sharp(fixture.source).resize({ width: 1000 }).png().toBuffer();
  await page.route(`${assetHost}/source.png`, route => route.fulfill({ contentType: "image/png", body: source }));
  await page.route("**/api/upscale", route => { submissions++; return route.abort(); });
  await page.route("**/api/upscale?*", route => {
    polls++;
    expect(new URL(route.request().url()).searchParams.get("projectId")).toBe("pending-project");
    return route.fulfill({ json: { status: "COMPLETED", upscaledUrl: `${assetHost}/cutout.png` } });
  });
  await page.goto("/upscale");
  await expect(page.getByAltText("Original uploaded artwork", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Image type" })).toHaveValue("artwork");
  await expect(page.getByRole("button", { name: "Download Upscaled PNG" })).toBeEnabled();
  expect(submissions).toBe(0);
  expect(polls).toBe(1);
});

test("reload recovers a paid project after a transient status failure without another submission", async ({ page }) => {
  const fixture = await setup(page);
  const source = await sharp(fixture.source).resize({ width: 1000 }).png().toBuffer();
  await page.route(`${assetHost}/source.png`, route => route.fulfill({ contentType: "image/png", body: source }));
  let submissions = 0;
  let polls = 0;
  await page.route("**/api/upscale", route => {
    submissions++;
    return route.fulfill({ json: { projectId: "paid-project", requestId: "paid-job" } });
  });
  await page.route("**/api/upscale?*", route => {
    polls++;
    return polls === 1 ? route.fulfill({ status: 503, json: { error: "Storage temporarily unavailable", retryable: true } })
      : route.fulfill({ json: { status: "COMPLETED", upscaledUrl: `${assetHost}/cutout.png` } });
  });
  await page.goto("/upscale");
  await page.locator('input[type="file"]').setInputFiles({ name: "source.png", mimeType: "image/png", buffer: source });
  await page.getByRole("button", { name: "Run precision upscale", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Try upscale again", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByAltText("Upscaled artwork", { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
  expect(polls).toBe(2);
  expect(fixture.requests.storage).toBe(1);
});

test("replacement uses the upload flow and insufficient credits open the existing top-up UI", async ({ page }) => {
  const fixture = await setup(page, { credits: 0 });
  let removeRequests = 0;
  await page.route("**/api/remove-bg", route => { removeRequests++; return route.abort(); });
  await page.goto("/bg-remover/bg-ui-test");
  const panel = page.getByRole("complementary", { name: "Background Removal Settings", exact: true });
  await panel.getByRole("button", { name: "Get more Claws", exact: true }).click();
  expect(removeRequests).toBe(0);
  await expect(page.getByRole("heading", { name: "Plans & Pricing", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close top-up plans", exact: true }).click();
  await page.goto("/bg-remover/bg-ui-test");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace source", exact: true }).click();
  await (await chooser).setFiles({ name: "replacement.png", mimeType: "image/png", buffer: fixture.source });
  await expect.poll(() => fixture.requests.uploads.length).toBe(1);
  expect(fixture.requests.uploads[0].traceType).toBe("bg_remover");
});

test("drag-and-drop upload retains the existing server fallback", async ({ page }) => {
  const fixture = await setup(page);
  await page.route(`${assetHost}/upload`, route => route.fulfill({ status: 403, body: "Direct upload unavailable" }));
  let fallback = false;
  await page.route("**/api/upload-direct", route => {
    fallback = true;
    expect(route.request().postData()).toContain("bg_remover");
    return route.fulfill({ json: { publicUrl: `${assetHost}/source.png` } });
  });
  await page.goto("/bg-remover");
  const transfer = await page.evaluateHandle(base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    return data;
  }, fixture.source.toString("base64"));
  await page.getByRole("main", { name: "Choose artwork for background removal" }).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page).toHaveURL(/\/bg-remover\/bg-ui-test$/);
  expect(fallback).toBe(true);
});
