import { lookup } from 'node:dns/promises';

import {
  generateBoard,
  isBlockedIpAddress,
  normalizeCustomBaseUrl,
  normalizeApiKeyForRequest,
  normalizeModelOverrides,
  requireProvider,
  processToc,
  validateCustomProviderConfig,
  type GraphNodeInput,
  type ModelOverrides,
  type Provider,
} from '$lib/llm/core';

function validateUserConfig(provider?: string, apiKey?: string) {
  try {
    return {
      provider: requireProvider(provider),
      apiKey: normalizeApiKeyForRequest(apiKey || ''),
    };
  } catch (err: any) {
    throw createBadRequest(err.message);
  }
}

function createBadRequest(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

async function assertCustomBaseUrlResolvesSafely(customBaseUrl?: string) {
  const baseUrl = normalizeCustomBaseUrl(customBaseUrl);
  const hostname = new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, '$1');

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });

    if (addresses.some(({ address }) => isBlockedIpAddress(address))) {
      throw createBadRequest('Custom base URL resolves to a private network address.');
    }
  } catch (err: any) {
    if (err?.status) {
      throw err;
    }

    throw createBadRequest('Unable to validate custom base URL host.');
  }
}

async function validateCustomProviderOnServer(
  provider: Provider,
  apiKey: string | undefined,
  customBaseUrl: string | undefined,
  modelOverrides: ModelOverrides | undefined,
) {
  if (provider !== 'custom') {
    return;
  }

  try {
    validateCustomProviderConfig({
      apiKey,
      customBaseUrl,
      modelOverrides,
    });
  } catch (err: any) {
    throw createBadRequest(err?.message || 'Invalid custom provider configuration.');
  }

  await assertCustomBaseUrlResolvesSafely(customBaseUrl);
}

export async function processTocOnServer({
  images,
  text,
  apiKey,
  provider,
  customBaseUrl,
  doubaoEndpointIdText,
  doubaoEndpointIdVision,
  modelOverrides,
  visionPrompt,
}: {
  images?: string[];
  text?: string;
  apiKey?: string;
  provider?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  visionPrompt?: string;
}) {
  const { provider: resolvedProvider, apiKey: resolvedApiKey } = validateUserConfig(provider, apiKey);
  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  await validateCustomProviderOnServer(resolvedProvider, apiKey, customBaseUrl, normalizedModelOverrides);

  return processToc({
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    customBaseUrl,
    images,
    text,
    doubaoEndpointIdText,
    doubaoEndpointIdVision,
    visionPrompt,
    modelOverrides: normalizedModelOverrides,
  });
}

export async function generateBoardOnServer({
  tocItems,
  apiKey,
  provider,
  customBaseUrl,
  doubaoEndpointIdText,
  modelOverrides,
}: {
  tocItems: GraphNodeInput[];
  apiKey?: string;
  provider?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  modelOverrides?: ModelOverrides;
}) {
  const { provider: resolvedProvider, apiKey: resolvedApiKey } = validateUserConfig(provider, apiKey);
  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  await validateCustomProviderOnServer(resolvedProvider, apiKey, customBaseUrl, normalizedModelOverrides);

  return generateBoard(tocItems, {
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    customBaseUrl,
    doubaoEndpointIdText,
    modelOverrides: normalizedModelOverrides,
  });
}
