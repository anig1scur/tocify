import { withRateLimit, LIMIT_CONFIG } from '$lib/server/ratelimit';
import { processTocOnServer } from '$lib/llm/server';
import { error, json } from '@sveltejs/kit';

export const POST = withRateLimit(async ({ request }) => {
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    'https://tocify.aeriszhu.com', 'https://tocify.vercel.app',
    'http://localhost:5173', 'http://127.0.0.1:5173'
  ];

  if (origin && !allowedOrigins.includes(origin)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { images, text, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides } = await request.json();

    if ((!images || !Array.isArray(images) || images.length === 0) &&
      (!text || typeof text !== 'string' || !text.trim())) {
      throw error(400, 'Invalid request. Must provide either "images" array or "text" string.');
    }

    if (images && Array.isArray(images) && images.length > LIMIT_CONFIG.MAX_IMAGES) {
      throw error(400, `Too many pages. Maximum allowed is ${ LIMIT_CONFIG.MAX_IMAGES }.`);
    }

    if (text && typeof text === 'string') {
      const byteLength = new TextEncoder().encode(text).length;
      const maxBytes = LIMIT_CONFIG.MAX_TEXT_SIZE_KB * 1024;

      if (byteLength > maxBytes) {
        throw error(400, `Text too large. Maximum allowed is ${ LIMIT_CONFIG.MAX_TEXT_SIZE_KB }KB.`);
      }
    }

    const tocData = await processTocOnServer({
      request,
      images,
      text,
      apiKey,
      provider,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
    });

    return json(tocData);
  } catch (err: any) {
    console.error('API Error:', err);
    throw error(
      err.status || 500,
      err.message || err.body?.message || 'Failed to process ToC, please contact support.',
    );
  }
});
