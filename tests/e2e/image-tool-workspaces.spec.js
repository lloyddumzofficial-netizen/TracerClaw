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
