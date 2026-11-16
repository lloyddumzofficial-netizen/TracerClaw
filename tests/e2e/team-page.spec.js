import { expect, test } from "@playwright/test";

test("team keeps the founder above the roster without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/team");

  const cards = page.locator(".team-card");
  await expect(cards).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The people behind DesaynClaw.");
  await expect(cards.filter({ hasText: "Mary Dumadaug" })).toHaveCount(1);

  const desktopCards = await cards.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  for (const box of desktopCards.slice(1)) expect(box.y).toBeGreaterThanOrEqual(desktopCards[0].y + desktopCards[0].height);
  expect(desktopCards[0].x + desktopCards[0].width / 2).toBeCloseTo(720, 0);

  const founderPortrait = await page.locator(".team-card.is-founder .team-portrait").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { ratio: rect.width / rect.height };
  });
  expect(founderPortrait.ratio).toBeCloseTo(1, 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".team-card.is-founder")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
