import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ adminSupabase: {} }));
vi.mock('@/lib/rateLimit', () => ({ getClientIp: () => '203.0.113.1' }));
import { canonicalTrialEmail, trialFingerprint } from '@/lib/welcomeTrialIdentity.mjs';
import { readIntent, signIntent, verifyTurnstile, verifiedGoogleIdentity, welcomeTrialEnabled } from '@/server/welcomeTrial/security';

beforeEach(() => {
  vi.stubEnv('REFERRAL_SECURITY_SECRET', 'test-signing-secret-with-more-than-32-characters');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'real-test-fixture-secret');
  vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', 'desaynclaw.com');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('welcome trial security', () => {
  it('is disabled by default and never treats truthy strings as enabled', () => {
    vi.stubEnv('GOOGLE_WELCOME_TRIAL_ENABLED', 'false'); expect(welcomeTrialEnabled()).toBe(false);
    vi.stubEnv('GOOGLE_WELCOME_TRIAL_ENABLED', 'true'); expect(welcomeTrialEnabled()).toBe(true);
  });
  it('canonicalizes Gmail aliases without changing the login address', () => {
    expect(canonicalTrialEmail(' User.Name+tag@googlemail.com ')).toBe('username@gmail.com');
    expect(canonicalTrialEmail(' User.Name@Example.com ')).toBe('user.name@example.com');
    expect(canonicalTrialEmail('bad@@gmail.com')).toBe('');
    expect(trialFingerprint('google', 'one', process.env.REFERRAL_SECURITY_SECRET)).not.toBe(trialFingerprint('email', 'one', process.env.REFERRAL_SECURITY_SECRET));
  });
  it('rejects altered intent signatures, malformed input and Unicode without throwing', () => {
    const nonce = randomUUID(); const signed = signIntent(nonce);
    expect(readIntent(signed)).toBe(nonce);
    expect(readIntent(`${signed}x`)).toBeNull();
    expect(readIntent(`${nonce}.${'é'.repeat(64)}`)).toBeNull();
    expect(readIntent('bad')).toBeNull();
  });
  const request = new Request('https://desaynclaw.com/api/auth/google/start');
  const valid = () => ({ success: true, hostname: 'desaynclaw.com', action: 'desaynclaw_login', challenge_ts: new Date().toISOString() });
  it('verifies CAPTCHA on the server against hostname/action/time; includes no token in URLs', async () => {
    const fetcher = vi.fn(async () => Response.json(valid()));
    expect(await verifyTurnstile('fresh-token', request, fetcher)).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(fetcher.mock.calls[0][1].body.get('response')).toBe('fresh-token');
  });
  it.each([
    { success: false }, { hostname: 'evil.example' }, { action: 'other' },
    { challenge_ts: new Date(Date.now() - 301000).toISOString() }, { challenge_ts: 'invalid' },
  ])('does not accept CAPTCHA mismatch %j', async override => {
    expect(await verifyTurnstile('token', request, async () => Response.json({ ...valid(), ...override }))).toBe(false);
  });
  it('does not accept production Cloudflare dummy secrets', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA');
    const fetcher = vi.fn();
    expect(await verifyTurnstile('token', request, fetcher)).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  const session = () => ({ provider_token: 'private-token', user: { id: randomUUID(), identities: [{ provider: 'google', id: 'google-subject' }] } });
  const identity = () => ({ sub: 'google-subject', email: 'User.Name@gmail.com', email_verified: true });
  it('matches verified Google UserInfo to Supabase provider subject, supporting the installed SDK id shape', async () => {
    const fetcher = vi.fn(async () => Response.json(identity()));
    const result = await verifiedGoogleIdentity(session(), fetcher);
    expect(result).toMatchObject({ subject: 'google-subject', email: 'user.name@gmail.com' });
    expect(result.googleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
  it.each([{ email_verified: false }, { email: 'user@example.com' }, { sub: 'another-subject' }])('rejects Google identity mismatch %j', async override => {
    expect(await verifiedGoogleIdentity(session(), async () => Response.json({ ...identity(), ...override }))).toBeNull();
  });
  it('does not use editable user metadata, even with a matching email and subject', async () => {
    const forged = session(); forged.user.identities = []; forged.user.user_metadata = identity();
    expect(await verifiedGoogleIdentity(forged, async () => Response.json(identity()))).toBeNull();
    expect(await verifiedGoogleIdentity({ user: forged.user })).toBeNull();
  });
});
