import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`hero walkthrough poster leads into video and stays hidden on pause (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      localStorage.setItem('cookie_consent', 'declined');
      localStorage.setItem('ai_disclaimer_seen', '1');
      // Exercise the UI's media events without depending on the external CDN.
      HTMLMediaElement.prototype.play = function () {
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      };
    });
    await page.route('**/api/public-stats', route => route.fulfill({ json: {
      success: true, totalUsers: 8188, reviewCount: 11, avatars: [],
    } }));
    await page.route('**/api/welcome-trial', route => route.fulfill({ json: { enabled: false } }));
    await page.goto('/');
    await page.getByRole('link', { name: 'Watch how it works' }).click();
    await expect(page).toHaveURL(/#hero-product-demo$/);
    const demo = page.getByRole('region', { name: 'DesaynClaw product demonstration' });
    const poster = demo.locator('[data-demo-poster]');
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.locator('img').evaluateAll(images =>
      images.length === 1 && images.every(image => image.complete && image.naturalWidth > 0)
    )).toBe(true);
    await expect(demo.locator('video')).toHaveAttribute('poster', /EMAIL-VIDEO-THUMBNAIL/);
    await expect(demo.locator('video source')).toHaveAttribute('src', /DESAYNCLAW-TUTORIAL\.compressed\.mp4$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await demo.screenshot({ path: `scratch/hero-walkthrough-poster-${width}.png` });
    await demo.getByRole('button', { name: 'Play the DesaynClaw product walkthrough' }).click();
    await expect(poster).toHaveCount(0);
    await expect(demo.locator('video')).toHaveAttribute('controls', '');
    await demo.locator('video').evaluate(video => video.dispatchEvent(new Event('pause')));
    await expect(demo.getByRole('button', { name: 'Play the DesaynClaw product walkthrough' })).toBeVisible();
    await expect(poster).toHaveCount(0);
  });
}
