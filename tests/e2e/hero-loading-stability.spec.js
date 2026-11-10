import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`hero horizon stays in place before stats, after stats and on refresh (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      localStorage.setItem('cookie_consent', 'declined');
      localStorage.setItem('ai_disclaimer_seen', '1');
    });
    let release;
    const delayedStats = new Promise(resolve => { release = resolve; });
    await page.route('**/api/public-stats', async route => {
      await delayedStats;
      await route.fulfill({ json: { success: true, totalUsers: 8179, reviewCount: 11, avatars: [] } });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const horizon = page.locator('[data-hero-horizon]');
    await expect(horizon).toBeAttached();
    await page.evaluate(() => document.fonts.ready);
    const measure = () => horizon.evaluate(element => ({
      top: element.getBoundingClientRect().top,
      height: element.parentElement.getBoundingClientRect().height,
      documentWidth: document.documentElement.scrollWidth,
    }));
    const before = await measure();
    await expect(page.locator('.guest-landing-community')).toHaveAttribute('aria-hidden', 'true');
    release();
    await expect(page.locator('.guest-landing-community')).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(async () => (await measure()).top).toBeCloseTo(before.top, 1);
    const after = await measure();
    expect(after.height).toBeCloseTo(before.height, 1);
    expect(after.documentWidth).toBeLessThanOrEqual(width);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.guest-landing-community')).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(async () => (await measure()).top).toBeCloseTo(before.top, 1);
  });
}
