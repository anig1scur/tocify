import { LIMIT_CONFIG } from '$lib/server/request-limits';
import { processTocWithDiagnosticsOnServer } from '$lib/llm/server';
import { MAX_PAGES_PER_REQUEST } from '$lib/llm/batching';
import { IS_LOCAL } from '$lib/local';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    'https://pdf.aeriszhu.com', 'https://tocify.aeriszhu.com', 'https://tocify.vercel.app',
    'http://localhost:5173', 'http://127.0.0.1:5173'
  ];

  if (origin && !(IS_LOCAL ? origin === new URL(request.url).origin : allowedOrigins.includes(origin))) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const {
      images,
      text,
      apiKey,
      provider,
      customBaseUrl,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
      visionPrompt,
    } = await request.json();

    if ((!images || !Array.isArray(images) || images.length === 0) &&
      (!text || typeof text !== 'string' || !text.trim())) {
      throw error(400, 'Invalid request. Must provide either "images" array or "text" string.');
    }

    const maxImages = IS_LOCAL ? MAX_PAGES_PER_REQUEST : LIMIT_CONFIG.MAX_IMAGES;
    if (images && Array.isArray(images) && images.length > maxImages) {
      throw error(400, `Too many pages. Maximum allowed is ${maxImages}.`);
    }

    if (!IS_LOCAL && text && typeof text === 'string') {
      const byteLength = new TextEncoder().encode(text).length;
      const maxBytes = LIMIT_CONFIG.MAX_TEXT_SIZE_KB * 1024;

      if (byteLength > maxBytes) {
        throw error(400, `Text too large. Maximum allowed is ${ LIMIT_CONFIG.MAX_TEXT_SIZE_KB }KB.`);
      }
    }

    const tocData = await processTocWithDiagnosticsOnServer({
      images,
      text,
      apiKey,
      provider,
      customBaseUrl,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
      visionPrompt,
      signal: request.signal,
    });

    return json(IS_LOCAL ? tocData : tocData.items);
  } catch (err: any) {
    if (!IS_LOCAL) console.error('API Error:', err);
    throw error(
      err.status || 500,
      err.message || err.body?.message || 'Failed to process ToC, please contact support.',
    );
  }
};
