import { withRateLimit } from '$lib/server/ratelimit';
import { generateBoardOnServer } from '$lib/llm/server';
import { json } from '@sveltejs/kit';

export const POST = withRateLimit(async ({ request }) => {
  try {
    const { tocItems, apiKey, provider, customBaseUrl, doubaoEndpointIdText, modelOverrides } = await request.json();

    if (!tocItems || !Array.isArray(tocItems)) {
      return json({ error: 'Invalid tocItems' }, { status: 400 });
    }

    // Only the "custom" provider legitimately requires a client-supplied key
    // (the server has no credential of its own for an arbitrary endpoint).
    // For built-in providers, ignore any client-supplied apiKey so this route
    // can't be used to launder/test attacker-supplied or stolen credentials
    // against the AI providers via the server's trusted egress.
    const safeApiKey = provider === 'custom' ? apiKey : undefined;

    const graph = await generateBoardOnServer({
      request,
      tocItems,
      apiKey: safeApiKey,
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
});
