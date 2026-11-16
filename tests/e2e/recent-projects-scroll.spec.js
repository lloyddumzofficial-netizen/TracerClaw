import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const user = { id: 'projects-scroll-user', email: 'scroll@example.test', app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 })}.test`, refresh_token: 'test', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user };
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem('cookie_consent', 'declined');
    localStorage.setItem('ai_disclaimer_seen', '1');
    localStorage.setItem('desaynclaw_onboarded', 'true');
    document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`;
  }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  const projects = Array.from({ length: 18 }, (_, i) => ({ id: `project-${i}`, name: `Artwork ${i}`, trace_type: 'mockup', created_at: new Date().toISOString(), original_image_url: null }));
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().url().includes('/projects') ? projects : { credits: 10 } }));
  await page.route('**/api/public-stats', route => route.fulfill({ json: { success: true, totalUsers: 8000, reviewCount: 0, avatars: [] } }));
  await page.route('**/api/welcome-trial', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/referrals/status', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/referral-rewards', route => route.fulfill({ json: { notifications: [], balance: 10 } }));
  await page.goto('/');
  await expect(page.locator('[data-home-smooth]')).toBeAttached();
  await expect(page.locator('.recent-card')).toHaveCount(18);
  await page.evaluate(() => document.fonts.ready);
});

async function frames(page, count = 12) {
  await page.evaluate(n => new Promise(resolve => { let ticks=0; const tick=()=>++ticks>=n?resolve():requestAnimationFrame(tick); requestAnimationFrame(tick); }), count);
}

test('entering the project list stops outstanding page momentum while cards scroll', async ({ page }) => {
  const grid = page.locator('.recent-grid');
  await page.mouse.move(30, 350);
  await page.mouse.wheel(0, 260);
  await expect(page.locator('html')).toHaveClass(/lenis-scrolling/);
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + box.width / 2, Math.max(100, box.y + box.height / 2));
  await page.mouse.wheel(0, 150);
  await expect.poll(() => grid.evaluate(el => el.scrollTop)).toBeGreaterThan(30);
  const top = await page.evaluate(() => window.scrollY);
  await frames(page, 25);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - top)).toBeLessThanOrEqual(2);
});

test('project boundaries hand scrolling back to the page and reversals stay inside the list', async ({ page }) => {
  const grid = page.locator('.recent-grid');
  await grid.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await grid.hover();
  await page.mouse.wheel(0, 180);
  await expect(page.locator('html')).toHaveClass(/lenis-scrolling/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(30);
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + box.width / 2, Math.max(100, box.y + box.height / 2));
  const bottom = await grid.evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, -140);
  await expect.poll(() => grid.evaluate(el => el.scrollTop)).toBeLessThan(bottom - 30);
  const pageTop = await page.evaluate(() => window.scrollY);
  await frames(page, 20);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - pageTop)).toBeLessThanOrEqual(2);
});

test('top boundary and a filtered list use the page controller rather than trapping the wheel', async ({ page }) => {
  const grid = page.locator('.recent-grid');
  await page.evaluate(() => window.scrollTo(0, 160));
  await frames(page, 4);
  const initial = await page.evaluate(() => window.scrollY);
  expect(initial).toBeGreaterThan(100);
  // Synthetic wheel has no browser default scrolling: movement proves that
  // the page controller consumed the boundary event, not native chaining.
  await grid.dispatchEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(initial - 50);
  await expect.poll(() => page.locator('html').getAttribute('class')).not.toMatch(/lenis-scrolling/);
  await page.getByRole('searchbox', { name: 'Search recent projects' }).fill('Artwork 0');
  await expect(page.locator('.recent-card')).toHaveCount(1);
  expect(await grid.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  const before = await page.evaluate(() => window.scrollY);
  await grid.dispatchEvent('wheel', { deltaY: 140, bubbles: true, cancelable: true });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 50);
});
