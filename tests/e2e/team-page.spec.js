import { expect, test } from "@playwright/test";

test("team page uses an editorial roster without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/team");

  const cards = page.locator(".team-card");
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Small team");

  const desktopCards = await cards.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(desktopCards[0].width).toBeGreaterThan(desktopCards[1].width);
  expect(desktopCards[0].height).toBeGreaterThan(desktopCards[1].height * 2);

  const founderPortrait = await page.locator(".team-card.is-lead .team-portrait").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { ratio: rect.width / rect.height };
  });
  expect(founderPortrait.ratio).toBeGreaterThan(0.58);
  expect(founderPortrait.ratio).toBeLessThan(0.78);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".team-card.is-lead")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
