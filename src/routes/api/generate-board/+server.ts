import { withRateLimit } from '$lib/server/ratelimit';
import { generateBoardOnServer } from '$lib/llm/server';
import { json } from '@sveltejs/kit';

export const POST = withRateLimit(async ({ request }) => {
  try {
    const { tocItems, apiKey, provider, doubaoEndpointIdText, modelOverrides } = await request.json();

    if (!tocItems || !Array.isArray(tocItems)) {
      return json({ error: 'Invalid tocItems' }, { status: 400 });
    }

    const graph = await generateBoardOnServer({
      request,
      tocItems,
      apiKey,
      provider,
      doubaoEndpointIdText,
      modelOverrides,
    });

    return json(graph);
  } catch (error: any) {
    console.error(error);
    return json({ error: error.message }, { status: error.status || 500 });
  }
});
