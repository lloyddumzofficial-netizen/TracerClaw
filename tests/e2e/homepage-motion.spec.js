import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem('cookie_consent', 'declined');
    localStorage.setItem('ai_disclaimer_seen', '1');
    localStorage.setItem('desaynclaw_onboarded', 'true');
  });
  await page.route('**/api/public-stats', route => route.fulfill({ json: { success: true, totalUsers: 8179, reviewCount: 11, avatars: [] } }));
  await page.route('**/api/welcome-trial', route => route.fulfill({ json: { enabled: false } }));
});

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('[data-home-smooth]')).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}

test('first-visit privacy dialog pauses background scrolling until accepted', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('ai_disclaimer_seen'));
  await ready(page);
  const accept = page.getByRole('button', { name: /I understand.*continue/i });
  await expect(accept).toBeVisible();
  await page.mouse.move(30, 400);
  await page.mouse.wheel(0, 400);
  await page.evaluate(() => new Promise(resolve => { let n=0; const tick=()=>++n===15?resolve():requestAnimationFrame(tick); requestAnimationFrame(tick); }));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await accept.click();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
});

test('wheel eases, reverses, then settles without moving the hero decoration in its layout', async ({ page }) => {
  await ready(page);
  const geometry = () => page.locator('[data-hero-horizon]').evaluate(el => ({
    top: el.getBoundingClientRect().top + window.scrollY,
    frameGap: Math.abs(el.getBoundingClientRect().bottom - el.parentElement.getBoundingClientRect().top),
  }));
  const before = await geometry();
  expect(before.frameGap).toBeLessThan(1);
  await page.mouse.move(40, 400);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(500, 0);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(200, 0);
  expect((await geometry()).top).toBeCloseTo(before.top, 0);
  const frames = await page.evaluate(() => new Promise(resolve => {
    const times = []; let previous; const sample = time => {
      if (previous) times.push(time - previous); previous = time;
      if (times.length < 60) requestAnimationFrame(sample);
      else resolve({ median: times.toSorted((a,b) => a-b)[30], slow: times.filter(t => t > 50).length });
    }; requestAnimationFrame(sample);
  }));
  console.log('Homepage settled frame sample:', frames);
});

test('wheel over the demo video stays smoothed instead of jumping to native scrolling', async ({ page }) => {
  await ready(page);
  await page.getByRole('link', { name: 'Watch how it works', exact: true }).click();
  await expect.poll(() => page.locator('#hero-product-demo').evaluate(el => Math.abs(el.getBoundingClientRect().top - 96))).toBeLessThan(2);
  const video = page.locator('#hero-product-demo video');
  const box = await video.boundingBox();
  const point = { x: box.x + box.width * .25, y: box.y + Math.min(box.height * .25, 180) };
  await page.mouse.move(point.x, point.y);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('VIDEO');
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 300);
  const positions = await page.evaluate(() => new Promise(resolve => {
    const values = [];
    const sample = () => { values.push(scrollY); if (values.length === 8) resolve(values); else requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  }));
  expect(positions.some(y => y > before + 1 && y < before + 290)).toBe(true);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before + 300, 0);
});

test('content, comparison controls and image cards keep the same scroll behavior', async ({ page }) => {
  await ready(page);
  const targets = [
    '#preview input[type="range"]',
    '.tool-cutout-preview input[type="range"]',
    'section[aria-labelledby="workspace-features-heading"] img',
    '#workspace-features-heading',
    '#pricing button',
  ];
  for (const selector of targets) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('lenis-scrolling'))).toBe(false);
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 260);
    const samples = await page.evaluate(() => new Promise(resolve => {
      const values = [];
      const sample = () => { values.push(scrollY); if (values.length === 8) resolve(values); else requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    }));
    expect(samples.some(y => y > before + 1 && y < before + 250), selector).toBe(true);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before + 260, 0);
  }
});

test('quick wheel reversals discard old momentum without a forward jump', async ({ page }) => {
  await ready(page);
  await page.mouse.move(30, 400);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(80);
  await page.mouse.wheel(0, -180);
  const samples = await page.evaluate(() => new Promise(resolve => {
    const values = [];
    const sample = () => {
      values.push(scrollY);
      if (values.length === 8) resolve(values);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  expect(samples.at(-1)).toBeLessThan(samples[0]);
  expect(samples.every((y, i) => i === 0 || y <= samples[i - 1] + 1)).toBe(true);
});

test('anchors, comparison drag, modal pause/resume and route cleanup work together', async ({ page }) => {
  await ready(page);
  await page.getByRole('link', { name: 'Samples', exact: true }).click();
  await expect(page).toHaveURL(/#preview$/);
  await expect.poll(() => page.locator('#preview').evaluate(el => Math.abs(el.getBoundingClientRect().top - (parseFloat(getComputedStyle(el).scrollMarginTop) || 96)))).toBeLessThan(2);
  const range = page.locator('#preview input[type="range"]').first();
  await range.focus();
  await page.keyboard.press('ArrowRight');
  await expect(range).not.toHaveValue('50');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Start designing' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const stoppedAt = await page.evaluate(() => window.scrollY);
  await page.mouse.move(30, 400);
  await page.mouse.wheel(0, 400);
  // Several frames confirm a stopped scroll, rather than just its first frame.
  await page.evaluate(() => new Promise(resolve => { let n=0; const tick=()=>++n===15?resolve():requestAnimationFrame(tick); requestAnimationFrame(tick); }));
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(stoppedAt, 0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('desaynclaw:navigation-start')));
  await expect(page.locator('[data-home-smooth]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('scroll-behavior'))).toBe('');
  await page.locator('a[href="/privacy"]').first().click();
  await expect(page).toHaveURL(/\/privacy$/);
  expect(await page.evaluate(() => document.documentElement.classList.contains('lenis'))).toBe(false);
});

test('desktop scrolling stays smooth with reduced motion and reveals fade without translation', async ({ page }) => {
  await ready(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-home-smooth]')).toBeAttached();
  const section = page.locator('section[aria-labelledby="workspace-features-heading"]');
  const piece = section.locator('[data-home-reveal-piece]').first();
  await expect(section).toHaveAttribute('data-home-reveal', 'true');
  await expect(piece).toHaveCSS('transform', 'none');
  await expect(piece).toHaveCSS('transition-duration', '0.42s');
  await expect(page.locator('.software-compatibility-marquee .marquee-content')).toHaveCSS('animation-play-state', 'running');
  await page.mouse.move(30, 400);
  await page.mouse.wheel(0, 400);
  const positions = await page.evaluate(() => new Promise(resolve => {
    const values = [];
    const sample = () => {
      values.push(window.scrollY);
      if (values.length === 8) resolve(values);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  expect(positions.some(y => y > 0 && y < 390)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect(page.locator('html')).not.toHaveClass(/lenis-scrolling/);
  await section.evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: 'instant' }));
  await expect(section).toHaveAttribute('data-home-revealed', 'true');
  const opacityFrames = await piece.evaluate(el => new Promise(resolve => {
    const values = [];
    const sample = () => {
      values.push(Number(getComputedStyle(el).opacity));
      if (values.length === 8) resolve(values);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  expect(opacityFrames.some(value => value > 0 && value < 1)).toBe(true);
  await expect(piece).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-home-smooth]')).toBeAttached();
});

for (const width of [1440, 390]) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    test(`software logos actually move, including on hover: ${width}px, ${reducedMotion}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion });
      await page.goto('/');
      const rail = page.locator('.software-compatibility-marquee .marquee-content');
      await expect(rail).toBeVisible();
      await page.locator('.software-compatibility-marquee').hover();
      const movement = await rail.evaluate(el => new Promise(resolve => {
        const startX = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
        const start = performance.now();
        const sample = now => {
          if (now - start < 400) return requestAnimationFrame(sample);
          const style = getComputedStyle(el);
          resolve({
            distance: Math.abs(new DOMMatrixReadOnly(style.transform).m41 - startX),
            duration: style.animationDuration,
            iterations: style.animationIterationCount,
          });
        };
        requestAnimationFrame(sample);
      }));
      expect(movement.distance).toBeGreaterThan(2);
      expect(movement.iterations).toBe('infinite');
      if (reducedMotion === 'reduce') expect(movement.duration).toBe('72s');
    });
  }
}

test('workspace features fade in and re-arm only after leaving below the viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ready(page);
  const section = page.locator('section[aria-labelledby="workspace-features-heading"]');
  const piece = section.locator('[data-home-reveal-piece]').first();
  await expect(section).toHaveAttribute('data-home-reveal', 'true');
  await expect(piece).toHaveCSS('opacity', '0');
  await section.evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: 'instant' }));
  await expect(section).toHaveAttribute('data-home-revealed', 'true');
  await expect(piece).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(section).not.toHaveAttribute('data-home-revealed', 'true');
  await section.evaluate(el => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: 'instant' }));
  await expect(section).toHaveAttribute('data-home-revealed', 'true');
  await expect(piece).toHaveCSS('opacity', '1');
});

test('keyboard focus reveals sections and refresh keeps the hero glow anchored', async ({ page }) => {
  await ready(page);
  const section = page.locator('#workspace-tools');
  await section.getByRole('button', { name: 'Open workspace' }).first().focus();
  await expect(section).toHaveAttribute('data-home-revealed', 'true');
  await page.goto('/#start');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  await page.screenshot({ path: 'scratch/homepage-motion-desktop.png' });
  await page.reload();
  await expect(page.locator('[data-home-smooth]')).toBeAttached();
  expect(await page.locator('[data-hero-horizon]').evaluate(el => Math.abs(el.getBoundingClientRect().bottom - el.parentElement.getBoundingClientRect().top))).toBeLessThan(1);
});

test('signed-in homepage keeps one controller through project modal and header return-to-top', async ({ page }) => {
  const user = { id: 'homepage-motion-user', email: 'motion@gmail.com', app_metadata: { provider: 'google' }, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 })}.test`, refresh_token: 'test', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user };
  await page.addInitScript(({ key, value }) => { document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`; }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().url().includes('/projects') ? [] : { credits: 8 } }));
  await page.route('**/api/referrals/status', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/referral-rewards', route => route.fulfill({ json: { notifications: [], balance: 8 } }));
  await ready(page);
  await expect(page.locator('.has-guest-home')).toHaveCount(0);
  await expect(page.locator('[data-hero-horizon]')).toHaveCount(0);
  await expect(page.locator('.home-hero-shell')).toHaveCSS('background-color', 'rgb(8, 9, 10)');
  await expect(page.locator('.home-hero-shell')).toHaveCSS('background-image', 'none');
  const trustRail = page.locator('.signed-in-trust-marquee .marquee-content');
  await page.locator('.signed-in-trust-marquee').scrollIntoViewIfNeeded();
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    await page.locator('.signed-in-trust-marquee').hover();
    const position = () => trustRail.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    const initial = await position();
    await expect.poll(async () => Math.abs((await position()) - initial)).toBeGreaterThan(2);
    await expect(trustRail).toHaveCSS('animation-play-state', 'running');
    if (reducedMotion === 'reduce') await expect(trustRail).toHaveCSS('animation-duration', '60s');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const create = page.getByRole('button', { name: 'New Project', exact: false }).first();
  await create.click();
  await expect(page.getByRole('heading', { name: 'What are you creating?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'What are you creating?' })).toBeHidden();
  await page.mouse.move(30, 400);
  await page.mouse.wheel(0, 800);
  const top = page.getByRole('button', { name: 'Return to the top of your workspace' });
  await expect(top).toBeVisible();
  await top.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  await page.screenshot({ path: 'scratch/homepage-motion-member.png' });
});

test.describe('touch fallback', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('keeps native scrolling, mobile glow position, and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.guest-landing-hero')).toBeVisible();
    await expect(page.locator('[data-home-smooth]')).toHaveCount(0);
    expect(await page.locator('[data-hero-horizon]').evaluate(el => Math.abs(el.getBoundingClientRect().bottom - el.parentElement.getBoundingClientRect().top))).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'scratch/homepage-motion-mobile.png' });
  });
});
