import { expect, test } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cookie_consent', 'declined');
    // Stub only the external CAPTCHA widget; this does not bypass server tests.
    window.turnstile = {
      ready: callback => callback(),
      render: (_container, options) => { window.testTurnstileOptions = options; setTimeout(() => options.callback('browser-test-token'), 20); return 'widget'; },
      reset: () => setTimeout(() => window.testTurnstileOptions?.callback('browser-test-token'), 20),
      remove: () => {}, getResponse: () => 'browser-test-token', isExpired: () => false,
    };
  });
  await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/api/public-stats', route => route.fulfill({ json: { success: true, totalUsers: 42, completedExtractions: 120, reviewCount: 9, avatars: [] } }));
});

async function openLogin(page) {
  await page.goto('/');
  const privacy = page.getByRole('button', { name: /I understand.*continue/i });
  if (await privacy.isVisible()) await privacy.click();
  await page.getByRole('button', { name: 'Start designing' }).first().click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
}

test('Google trial hint is conditional and Google goes through the server starter', async ({ page }) => {
  await page.route('**/api/welcome-trial', route => route.fulfill({ json: { enabled: true } }));
  let submitted;
  await page.route('**/api/auth/google/start', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { url: '/?google-flow-tested=1', trialVerification: 'ready' } });
  });
  await openLogin(page);
  await expect(page.getByText('New eligible Google users receive 1 free Claw.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeEnabled();
  await page.getByRole('dialog').screenshot({ path: 'test-results/google-welcome-login.png' });
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page).toHaveURL(/google-flow-tested=1/);
  expect(submitted).toEqual({ captchaToken: 'browser-test-token' });
});

test('disabled campaign keeps email sign-in and existing Google label without trial promises', async ({ page }) => {
  await page.route('**/api/welcome-trial', route => route.fulfill({ json: { enabled: false } }));
  let requestedEmail;
  await page.route('**/auth/v1/otp*', route => {
    requestedEmail = route.request().postDataJSON().email;
    return route.fulfill({ json: {} });
  });
  await openLogin(page);
  await expect(page.locator('.login-trial-copy')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await page.getByLabel('Email address').fill('existing@gmail.com');
  await page.getByRole('button', { name: 'Send magic link', exact: true }).click();
  await expect(page.getByText('Check your email', { exact: true })).toBeVisible();
  expect(requestedEmail).toBe('existing@gmail.com');
});

test('pending allocation explains local retry time without blocking paid home controls', async ({ page }) => {
  const user = { id: 'trial-browser-test', email: 'new@gmail.com', app_metadata: { provider: 'google' }, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 })}.test`, refresh_token: 'test', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user };
  await page.addInitScript(({ key, value }) => {
    document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`;
    localStorage.setItem('desaynclaw_crop_guide_dismissed', '1');
    localStorage.setItem('desaynclaw_onboarded', 'true');
  }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().url().includes('/projects') ? [] : { credits: 8 } }));
  await page.route('**/api/referral-rewards', route => route.fulfill({ json: { notifications: [], balance: 8 } }));
  await page.route('**/api/welcome-trial', route => route.fulfill({ json: { enabled: true, status: 'pending_allocation', balance: 8, retry_at: '2026-11-11T00:00:00Z' } }));
  await page.goto('/');
  // Close optional existing onboarding overlays without changing production.
  const privacy = page.getByRole('button', { name: /I understand.*continue/i });
  if (await privacy.isVisible()) await privacy.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'Today’s trial allocation is full' })).toBeVisible();
  await expect(page.getByText('Your account and purchased Claws are ready to use.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Project', exact: false }).first()).toBeEnabled();
  await page.getByRole('status').filter({ hasText: 'Today’s trial allocation is full' }).screenshot({ path: 'test-results/google-welcome-pending.png' });
});
