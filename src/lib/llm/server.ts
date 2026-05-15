import { env } from '$env/dynamic/private';

import {
  generateBoard,
  requiresUserApiKeyForModel,
  normalizeModelOverrides,
  normalizeProvider,
  processToc,
  type GraphNodeInput,
  type ModelOverrides,
  type Provider,
} from '$lib/llm/core';

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function determineProvider(request: Request, userProvider?: string): Provider {
  const normalizedUserProvider = normalizeProvider(userProvider);
  if (normalizedUserProvider) {
    return normalizedUserProvider;
  }

  const envProvider = normalizeProvider(env.AI_PROVIDER);
  if (envProvider) {
    return envProvider;
  }

  return randomChoice(['gemini', 'qwen', 'doubao', 'zhipu']);
}

function resolveApiKey(provider: Provider, userKey?: string): string {
  if (userKey) {
    return userKey;
  }

  switch (provider) {
    case 'gemini':
      return env.GOOGLE_API_KEY || '';
    case 'qwen':
      return env.DASHSCOPE_API_KEY || '';
    case 'zhipu':
      return env.ZHIPU_API_KEY || '';
    case 'doubao':
      return env.DOUBAO_API_KEY || '';
  }
}

function providerLabel(provider: Provider): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function createBadRequest(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

export async function processTocOnServer({
  request,
  images,
  text,
  apiKey,
  provider,
  doubaoEndpointIdText,
  doubaoEndpointIdVision,
  modelOverrides,
}: {
  request: Request;
  images?: string[];
  text?: string;
  apiKey?: string;
  provider?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
}) {
  const resolvedProvider = determineProvider(request, provider);
  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  if (requiresUserApiKeyForModel(resolvedProvider, apiKey, normalizedModelOverrides)) {
    throw createBadRequest('Custom models outside the built-in list require your own API key.');
  }

  const resolvedApiKey = resolveApiKey(resolvedProvider, apiKey);

  if (!resolvedApiKey) {
    throw new Error(`[${ providerLabel(resolvedProvider) }] API Key is missing.`);
  }

  return processToc({
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    images,
    text,
    doubaoEndpointIdText: doubaoEndpointIdText || env.DOUBAO_ENDPOINT_ID_TEXT,
    doubaoEndpointIdVision: doubaoEndpointIdVision || env.DOUBAO_ENDPOINT_ID_VISION,
    modelOverrides: {
      geminiModel: 'gemini-2.5-flash',
      qwenVisionModel: env.QWEN_VL_MODEL || 'qwen-vl-plus',
      qwenTextModel: 'qwen-plus',
      zhipuTextModel: 'glm-4-flash',
      zhipuVisionModel: 'glm-4v-flash',
      doubaoTextModel: env.DOUBAO_ENDPOINT_ID_TEXT,
      doubaoVisionModel: env.DOUBAO_ENDPOINT_ID_VISION,
      ...normalizedModelOverrides,
    },
  });
}

export async function generateBoardOnServer({
  request,
  tocItems,
  apiKey,
  provider,
  doubaoEndpointIdText,
  modelOverrides,
}: {
  request: Request;
  tocItems: GraphNodeInput[];
  apiKey?: string;
  provider?: string;
  doubaoEndpointIdText?: string;
  modelOverrides?: ModelOverrides;
}) {
  const resolvedProvider = determineProvider(request, provider);
  const normalizedModelOverrides = normalizeModelOverrides(modelOverrides);

  if (requiresUserApiKeyForModel(resolvedProvider, apiKey, normalizedModelOverrides)) {
    throw createBadRequest('Custom models outside the built-in list require your own API key.');
  }

  const resolvedApiKey = resolveApiKey(resolvedProvider, apiKey);

  if (!resolvedApiKey) {
    throw new Error(`[${ providerLabel(resolvedProvider) }] API Key is missing.`);
  }

  return generateBoard(tocItems, {
    provider: resolvedProvider,
    apiKey: resolvedApiKey,
    doubaoEndpointIdText: doubaoEndpointIdText || env.DOUBAO_ENDPOINT_ID_TEXT,
    modelOverrides: {
      geminiModel: 'gemini-2.5-flash',
      qwenTextModel: 'qwen-plus',
      zhipuTextModel: 'glm-4-flash',
      doubaoTextModel: env.DOUBAO_ENDPOINT_ID_TEXT,
      ...normalizedModelOverrides,
    },
  });
}
