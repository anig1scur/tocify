import { generateBoardOnServer } from '$lib/llm/server';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { tocItems, apiKey, provider, customBaseUrl, doubaoEndpointIdText, modelOverrides } = await request.json();

    if (!tocItems || !Array.isArray(tocItems)) {
      return json({ error: 'Invalid tocItems' }, { status: 400 });
    }

    const graph = await generateBoardOnServer({
      tocItems,
      apiKey,
      provider,
      customBaseUrl,
      doubaoEndpointIdText,
      modelOverrides,
    });

    return json(graph);
  } catch (error: any) {
    console.error(error);
    return json({ error: error.message }, { status: error.status || 500 });
  }
};
