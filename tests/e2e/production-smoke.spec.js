import { expect, test } from "@playwright/test";

const smokeRoutes = [
  "/",
  "/upscale",
  "/privacy",
  "/terms",
  "/refunds",
];

for (const routePath of smokeRoutes) {
  test(`production smoke: ${routePath} responds with a rendered page`, async ({ page }) => {
    await page.route("**/api/public-stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, totalUsers: 1, completedExtractions: 1, reviewCount: 0, avatars: [] }),
      });
    });

    const response = await page.goto(routePath);
    expect(response?.ok()).toBe(true);
    await expect(page.locator("body")).toBeVisible();
  });
}
