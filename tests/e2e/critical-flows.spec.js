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

async function acceptPrivacyNotice(page) {
  const consentButton = page.getByRole("button", { name: "I UNDERSTAND & AGREE" });
  if (await consentButton.isVisible()) await consentButton.click();
}

test("home page exposes sign-in and protected project entry points", async ({ page }) => {
  await page.goto("/");
  await acceptPrivacyNotice(page);

  await expect(page.getByAltText("DesaynClaw Logo").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Start designing" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See a real example" })).toBeVisible();
});

test("sign-in modal remains reachable from protected actions", async ({ page }) => {
  await page.goto("/");
  await acceptPrivacyNotice(page);

  const trigger = page.getByRole("button", { name: "Start designing" }).first();
  await trigger.click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  const emailInput = page.locator('input[type="email"]').first();
  await expect(emailInput).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return Boolean(dialog && dialog.contains(document.activeElement));
  })).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("upscale tool redirects signed-out users before exposing paid actions", async ({ page }) => {
  await page.goto("/upscale");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Start designing" }).first()).toBeVisible();
});
