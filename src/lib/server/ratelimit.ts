import { env } from '$env/dynamic/private';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const LIMIT_CONFIG = {
  MAX_REQUESTS_PER_DAY: 5,
  MAX_IMAGES: 10,
  MAX_TEXT_SIZE_KB: 128
};

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export function getClientIp(request: Request): string {
  const headers = request.headers;
  const xForwardedFor = headers.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  return headers.get('x-real-ip') || headers.get('cf-connecting-ip') ||
    headers.get('x-vercel-forwarded-for') || 'unknown';
}

/**
 * Checks rate limit for a request.
 */
export async function checkRateLimit(
  request: Request, limitCount: number, prefix: string): Promise<Response | null> {
  const clientIp = getClientIp(request);

  if (clientIp !== 'unknown') {
    const ratelimit = new Ratelimit({
      redis: redis,
      limiter: Ratelimit.fixedWindow(limitCount, '24 h'),
      analytics: true,
      prefix: prefix,
    });

    const today = new Date().toISOString().split('T')[0];
    const identifier = `${ clientIp }:${ today }`;

    const { success, limit, remaining } = await ratelimit.limit(identifier);
    if (!success) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: `You have reached the daily limit of ${ limitCount } requests.`
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString()
          }
        });
    }
  }

  return null;
}
/**
 * A Higher-Order Function (HOF) to wrap SvelteKit route handlers with rate limiting.
 */
export function withRateLimit(
  handler: (event: any) => Promise<Response>
) {
  return async (event: any) => {
    try {
      const clonedRequest = event.request.clone();
      const body = await clonedRequest.json();

      if (body.apiKey) {
        return handler(event);
      }
    } catch (e) {
      // If body parsing fails or is not JSON, proceed to rate check
    }

    const limitRes = await checkRateLimit(
      event.request,
      LIMIT_CONFIG.MAX_REQUESTS_PER_DAY,
      '@tocify/ratelimit'
    );

    if (limitRes) {
      return limitRes;
    }
    return handler(event);
  };
}
