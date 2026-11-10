import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), oauth: vi.fn(), exchange: vi.fn(), limit: vi.fn(), redis: {}, bind: vi.fn(), email: vi.fn(), getUser: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ adminSupabase: { rpc: mocks.rpc, from: mocks.from, auth: { getUser: mocks.getUser } } }));
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({ auth: { signInWithOAuth: mocks.oauth, exchangeCodeForSession: mocks.exchange } }) }));
vi.mock('@/lib/rateLimit', () => ({ getClientIp: () => '203.0.113.10', getRedisClient: () => mocks.redis, enforceRateLimit: async () => ({ success: true }) }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: class { static slidingWindow() { return {}; } limit = mocks.limit; } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email', () => ({ sendEmail: mocks.email }));

import { POST } from '@/app/api/auth/google/start/route';
import { GET as callback } from '@/app/api/auth/callback/route';
import { GET as status } from '@/app/api/welcome-trial/route';
import { createDeviceCookie } from '@/server/referrals';
import { signIntent } from '@/server/welcomeTrial/security';
import { randomUUID } from 'node:crypto';
import { trialFingerprint } from '@/lib/welcomeTrialIdentity.mjs';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('GOOGLE_WELCOME_TRIAL_ENABLED', 'true'); vi.stubEnv('REFERRALS_ENABLED', 'false');
  vi.stubEnv('REFERRAL_SECURITY_SECRET', 'test-secret-longer-than-32-characters-for-signing');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'server-secret'); vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', 'desaynclaw.com');
  mocks.redis = {}; mocks.limit.mockResolvedValue({ success: true });
  mocks.oauth.mockResolvedValue({ data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' } });
  mocks.from.mockImplementation(() => ({ insert: vi.fn(async () => ({ error: null })) }));
  mocks.rpc.mockResolvedValue({ data: [{ status: 'granted', reason: 'awarded', balance: 1 }], error: null });
  vi.stubGlobal('fetch', vi.fn(async url => url.includes('siteverify')
    ? Response.json({ success: true, hostname: 'desaynclaw.com', action: 'desaynclaw_login', challenge_ts: new Date().toISOString() })
    : Response.json({ sub: 'google-subject', email_verified: true, email: 'user@gmail.com' })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const start = (origin = 'https://desaynclaw.com') => new Request('https://desaynclaw.com/api/auth/google/start', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ captchaToken: 'captcha' }) });

describe('Google OAuth initiation', () => {
  it('sets a proof only after shared rate limits and server CAPTCHA succeed', async () => {
    const response = await POST(start());
    expect((await response.json()).trialVerification).toBe('ready');
    expect(response.headers.get('set-cookie')).toContain('dc_trial_intent=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(mocks.limit).toHaveBeenCalledTimes(2);
    expect(mocks.oauth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', options: expect.objectContaining({ skipBrowserRedirect: true }) }));
  });
  it.each(['redis', 'captcha', 'limit', 'database'])('preserves ordinary login when %s verification is unavailable', async failure => {
    if (failure === 'redis') mocks.redis = null;
    if (failure === 'captcha') fetch.mockResolvedValue(Response.json({ success: false }));
    if (failure === 'limit') mocks.limit.mockResolvedValue({ success: false });
    if (failure === 'database') mocks.from.mockImplementation(() => ({ insert: vi.fn(async () => ({ error: new Error('unavailable') })) }));
    const response = await POST(start());
    expect(response.status).toBe(200); expect((await response.json()).trialVerification).toBe('unavailable');
    expect(mocks.oauth).toHaveBeenCalled();
  });
  it('rejects cross-origin submissions without beginning OAuth', async () => {
    expect((await POST(start('https://evil.example'))).status).toBe(403);
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('preserves sign-in when the campaign is disabled', async () => {
    vi.stubEnv('GOOGLE_WELCOME_TRIAL_ENABLED', 'false');
    expect((await POST(start())).status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('OAuth callback credit isolation', () => {
  function request({ proof = true } = {}) {
    return new Request('https://desaynclaw.com/api/auth/callback?code=test&next=https://evil.example', { headers: {
      cookie: `dc_ref_device=${createDeviceCookie(randomUUID())}; ${proof ? `dc_trial_intent=${signIntent(randomUUID())}` : ''}`,
    } });
  }
  function session() {
    return { provider_token: 'provider-private', user: { id: randomUUID(), email: 'user@gmail.com', created_at: '2020-01-01', identities: [{ provider: 'google', id: 'google-subject' }] } };
  }
  it('awards through the service RPC and clears the proof without exposing provider tokens', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: session() } });
    const response = await callback(request());
    expect(mocks.rpc).toHaveBeenCalledWith('grant_google_welcome_trial', expect.objectContaining({ target_google_subject: 'google-subject' }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://desaynclaw.com/');
    expect(response.headers.get('set-cookie')).toContain('dc_trial_intent=;');
    expect(response.headers.get('set-cookie')).not.toContain('provider-private');
  });
  it('does not award without proof, even if the user is Google authenticated', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: session() } });
    expect((await callback(request({ proof: false }))).status).toBe(307);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not undo login when credit grant or Google verification fails', async () => {
    mocks.exchange.mockResolvedValue({ data: { session: session() } });
    mocks.rpc.mockResolvedValue({ error: new Error('credit service unavailable') });
    expect((await callback(request())).status).toBe(307);
    fetch.mockRejectedValue(new Error('Google unavailable'));
    expect((await callback(request())).status).toBe(307);
  });
  it('exposes no trial metadata anonymously when disabled', async () => {
    vi.stubEnv('GOOGLE_WELCOME_TRIAL_ENABLED', 'false');
    const response = await status(new Request('https://desaynclaw.com/api/welcome-trial'));
    expect(await response.json()).toEqual({ enabled: false });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('reads only the authenticated caller’s status, ignoring any supplied target id', async () => {
    mocks.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
      enabled: true, launched_at: '2026-11-10', backfill_completed_at: '2026-11-10',
      secret_check: trialFingerprint('config', 'v1', process.env.REFERRAL_SECURITY_SECRET),
    } }) }) }) }));
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'authenticated-user' } }, error: null });
    mocks.rpc.mockResolvedValue({ data: [{ status: 'pending_allocation', balance: 8 }], error: null });
    const response = await status(new Request('https://desaynclaw.com/api/welcome-trial?user_id=victim', { headers: { Authorization: 'Bearer valid-session' } }));
    expect(mocks.rpc).toHaveBeenCalledWith('get_google_trial_status', { target_user_id: 'authenticated-user' });
    expect(await response.json()).toMatchObject({ status: 'pending_allocation', balance: 8 });
  });
  it('runs retention cleanup even when both signup trial and referrals are disabled', async () => {
    vi.stubEnv('GOOGLE_WELCOME_TRIAL_ENABLED', 'false'); vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    const { GET } = await import('@/app/api/cron/referrals/route');
    const response = await GET(new Request('https://desaynclaw.com/api/cron/referrals', { headers: { Authorization: 'Bearer test-cron-secret' } }));
    expect(mocks.rpc).toHaveBeenCalledWith('cleanup_welcome_trial_intents');
    expect(await response.json()).toMatchObject({ status: 'disabled' });
  });
});
