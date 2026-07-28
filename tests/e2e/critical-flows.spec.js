import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/public-stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        totalUsers: 42,
        completedExtractions: 120,
        reviewCount: 9,
        avatars: [],
      }),
    });
  });
});

test("home page exposes sign-in and protected project entry points", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByAltText("DesaynClaw Logo")).toBeVisible();
  await expect(page.getByRole("button", { name: /login/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /upload/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /4k/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /remove bg/i }).first()).toBeVisible();
});

test("sign-in modal remains reachable from protected actions", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /login/i }).click();
  await expect(page.getByText(/sign in/i).first()).toBeVisible();
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
});

test("upscale tool renders without authentication and protects paid action", async ({ page }) => {
  await page.goto("/upscale");

  await expect(page.getByText(/4K Upscale/i).first()).toBeVisible();
  await expect(page.getByText(/Upload/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /4K Upscale/i }).first()).toBeVisible();
});
