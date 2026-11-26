import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enforce: vi.fn(), redisLimit: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ enforceRateLimit: m.enforce }));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: class {
  static slidingWindow() {}
  limit(...args) { return m.redisLimit(...args); }
} }));
import { designRateLimit } from '@/server/designExtract/rateLimit';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const options = { namespace: 'design-extract:ai', identifier: 'owner', max: 6 };
it('requires distributed limit storage in production before expensive work', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  await expect(designRateLimit(options)).rejects.toMatchObject({ status: 503 }); expect(m.enforce).not.toHaveBeenCalled();
});
it('preserves the shared distributed limiter decision and fails closed on outage', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'private');
  m.enforce.mockResolvedValueOnce({ success: false }); expect(await designRateLimit(options)).toEqual({ success: false }); expect(m.enforce).toHaveBeenCalledWith(options);
  m.enforce.mockRejectedValueOnce(new Error('private token network error'));
  await expect(designRateLimit(options)).rejects.toMatchObject({ status: 503, message: 'Cannot confirm the request limit. Please retry shortly.' });
});

it('converts an Upstash fail-open timeout into an unavailable Design Extract request', async () => {
  const { enforceRateLimit } = await vi.importActual('@/lib/rateLimit');
  vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'private');
  m.redisLimit.mockResolvedValue({ success: true, reason: 'timeout', remaining: 0 });
  m.enforce.mockImplementationOnce(enforceRateLimit);
  await expect(designRateLimit(options)).rejects.toMatchObject({ status: 503 });
});
