import { enforceRateLimit } from '@/lib/rateLimit';

export async function designRateLimit(options) {
  // Per-process fallback is useful locally, but cannot protect a scaled deployment.
  const production = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (production && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
    throw Object.assign(new Error('Design Extract rate limiting is not configured.'), { status: 503, designExtractError: true });
  }
  try { return await enforceRateLimit(options); }
  catch (error) {
    if (error.designExtractError) throw error;
    throw Object.assign(new Error('Cannot confirm the request limit. Please retry shortly.'), { status: 503, designExtractError: true });
  }
}
