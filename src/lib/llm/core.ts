import { jsonrepair } from 'jsonrepair';

import {
  SYSTEM_PROMPT_GRAPH,
  SYSTEM_PROMPT_TEXT,
  SYSTEM_PROMPT_VISION,
  normalizeToc,
} from '$lib/utils/toc';

export type Provider = 'gemini' | 'qwen' | 'doubao' | 'zhipu' | 'deepseek' | 'custom';

export interface ModelOverrides {
  geminiModel?: string;
  deepseekModel?: string;
  qwenTextModel?: string;
  qwenVisionModel?: string;
  zhipuTextModel?: string;
  zhipuVisionModel?: string;
  doubaoTextModel?: string;
  doubaoVisionModel?: string;
  customModel?: string;
}

export const SUGGESTED_PROVIDER_MODELS: Record<'gemini' | 'qwen' | 'zhipu' | 'deepseek' | 'doubao', { text: readonly string[]; vision: readonly string[] }> = {
  gemini: {
    text: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
    vision: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
  },
  qwen: {
    text: ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max'],
    vision: ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max'],
  },
  zhipu: {
    text: ['glm-4.7-flash', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.3'],
    vision: ['glm-4.6v-flash', 'glm-5.3-flash', 'glm-5.3-flashx'],
  },
  deepseek: {
    text: ['deepseek-flash'],
    vision: ['deepseek-flash'],
  },
  doubao: {
    text: ['doubao-seed-2-1-lite-260915'],
    vision: ['doubao-seed-2-1-lite-260915'],
  },
} as const;

export const DEFAULT_PROVIDER: Provider = 'gemini';
export const DEFAULT_MODELS = {
  geminiModel: SUGGESTED_PROVIDER_MODELS.gemini.text[0],
  deepseekModel: SUGGESTED_PROVIDER_MODELS.deepseek.text[0],
  doubaoTextModel: SUGGESTED_PROVIDER_MODELS.doubao.text[0],
  doubaoVisionModel: SUGGESTED_PROVIDER_MODELS.doubao.vision[0],
  qwenTextModel: SUGGESTED_PROVIDER_MODELS.qwen.text[0],
  qwenVisionModel: SUGGESTED_PROVIDER_MODELS.qwen.vision[0],
  zhipuTextModel: SUGGESTED_PROVIDER_MODELS.zhipu.text[0],
  zhipuVisionModel: SUGGESTED_PROVIDER_MODELS.zhipu.vision[0],
} as const;

export const DEFAULT_VISION_PROMPT_TEMPLATE = SYSTEM_PROMPT_VISION.trim();
export const DEFAULT_VISION_PROMPT_TEMPLATE_ID = 'tocify-default';

export interface VisionPromptTemplate {
  id: string;
  name: string;
  prompt: string;
  isDefault?: boolean;
}

export function createDefaultVisionPromptTemplate(): VisionPromptTemplate {
  return {
    id: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    name: 'Tocify Default',
    prompt: DEFAULT_VISION_PROMPT_TEMPLATE,
    isDefault: true,
  };
}

export interface DirectApiConfig {
  provider?: string;
  apiKey: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  visionPrompt?: string;
}

export interface UiApiConfig extends DirectApiConfig {
  provider: string;
  apiKey: string;
  customBaseUrl: string;
  doubaoEndpointIdText: string;
  doubaoEndpointIdVision: string;
  modelOverrides: ModelOverrides;
  visionPrompt: string;
  visionPromptTemplateId: string;
  visionPromptTemplates: VisionPromptTemplate[];
}

export interface TocInputConfig extends DirectApiConfig {
  images?: string[];
  text?: string;
}

export interface GraphNodeInput {
  id: string | number;
  title: string;
  page?: number | null;
}

export interface GraphResponse {
  nodes: Array<{
    id: string;
    title: string;
    isInferred: boolean;
    page: number | null;
    cluster: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
    label: string;
  }>;
}

type OpenAiCompatProvider = Exclude<Provider, 'gemini'>;
type BuiltInOpenAiCompatProvider = Exclude<OpenAiCompatProvider, 'custom'>;

const MAX_CUSTOM_BASE_URL_LENGTH = 512;
const MAX_CUSTOM_MODEL_LENGTH = 200;
const MAX_API_KEY_LENGTH = 4096;

export const DEFAULT_CUSTOM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_CUSTOM_MODEL = 'gpt-6-luna';

const OPENAI_COMPAT_BASE_URL: Record<BuiltInOpenAiCompatProvider, string> = {
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  deepseek: 'https://api.deepseek.com',
};

function providerLabel(provider: Provider): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function normalizeProvider(provider?: string): Provider | undefined {
  const normalized = provider?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (
    normalized === 'gemini' ||
    normalized === 'qwen' ||
    normalized === 'doubao' ||
    normalized === 'zhipu' ||
    normalized === 'deepseek' ||
    normalized === 'custom'
  ) {
    return normalized;
  }

  throw new Error(`Unsupported provider: ${ provider }`);
}

export function requireProvider(provider?: string, missingMessage = 'Please select an LLM provider when using your own API key.'): Provider {
  const normalized = normalizeProvider(provider);

  if (!normalized) {
    throw new Error(missingMessage);
  }

  return normalized;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function isBlockedIpv4Address(address: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return false;
  }

  const octets = address.split('.').map((part) => Number(part));

  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    first === 100 && second >= 64 && second <= 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168 ||
    first === 198 && (second === 18 || second === 19)
  );
}

function isBlockedIpv6Address(address: string): boolean {
  const normalized = stripIpv6Brackets(address);

  if (!normalized.includes(':')) {
    return false;
  }

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) {
    return isBlockedIpv4Address(mappedIpv4);
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  );
}

export function isBlockedIpAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address.trim());
  return isBlockedIpv4Address(normalized) || isBlockedIpv6Address(normalized);
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname.trim());

  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === 'metadata.google.internal' ||
    isBlockedIpAddress(normalized)
  );
}

export function normalizeCustomBaseUrl(baseUrl?: string): string {
  const rawBaseUrl = baseUrl?.trim() || DEFAULT_CUSTOM_BASE_URL;

  if (!rawBaseUrl) {
    throw new Error('Custom base URL is required.');
  }

  if (rawBaseUrl.length > MAX_CUSTOM_BASE_URL_LENGTH) {
    throw new Error('Custom base URL is too long.');
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error('Invalid custom base URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Custom base URL must use HTTPS.');
  }

  if (url.username || url.password) {
    throw new Error('Custom base URL must not include credentials.');
  }

  if (url.search || url.hash) {
    throw new Error('Custom base URL must not include query or hash parameters.');
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error('Custom base URL host is not allowed.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  if (url.pathname.endsWith('/chat/completions')) {
    url.pathname = url.pathname.slice(0, -'/chat/completions'.length) || '/';
  }
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

export function normalizeApiKeyForRequest(apiKey: string): string {
  const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (!normalized) {
    throw new Error('Please add your own API key in API Settings to continue.');
  }

  if (normalized.length > MAX_API_KEY_LENGTH) {
    throw new Error('API key is too long.');
  }

  return normalized;
}

function normalizeModelName(model?: string): string | undefined {
  const normalized = model?.trim();
  return normalized ? normalized : undefined;
}

export function normalizeModelOverrides(modelOverrides?: ModelOverrides): ModelOverrides | undefined {
  if (!modelOverrides) {
    return undefined;
  }

  const sanitized: ModelOverrides = {};

  for (const [key, value] of Object.entries(modelOverrides)) {
    const normalized = normalizeModelName(value);
    if (normalized) {
      sanitized[key as keyof ModelOverrides] = normalized;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function getCustomModel(config: { modelOverrides?: ModelOverrides }): string {
  const model = normalizeModelName(config.modelOverrides?.customModel) || DEFAULT_CUSTOM_MODEL;

  if (!model) {
    throw new Error('Custom model is required.');
  }

  if (model.length > MAX_CUSTOM_MODEL_LENGTH) {
    throw new Error('Custom model is too long.');
  }

  return model;
}

export function validateCustomProviderConfig(config: {
  apiKey?: string;
  customBaseUrl?: string;
  modelOverrides?: ModelOverrides;
}): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: normalizeApiKeyForRequest(config.apiKey || ''),
    baseUrl: normalizeCustomBaseUrl(config.customBaseUrl),
    model: getCustomModel(config),
  };
}

export function requiresUserApiKey(apiKey?: string): boolean {
  return typeof apiKey !== 'string' || !apiKey.trim();
}

export function createEmptyApiConfig(): UiApiConfig {
  return {
    provider: DEFAULT_PROVIDER,
    apiKey: '',
    customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
    doubaoEndpointIdText: '',
    doubaoEndpointIdVision: '',
    modelOverrides: {
      geminiModel: '',
      deepseekModel: '',
      qwenTextModel: '',
      qwenVisionModel: '',
      zhipuTextModel: '',
      zhipuVisionModel: '',
      customModel: DEFAULT_CUSTOM_MODEL,
    },
    visionPrompt: DEFAULT_VISION_PROMPT_TEMPLATE,
    visionPromptTemplateId: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    visionPromptTemplates: [createDefaultVisionPromptTemplate()],
  };
}

function stripCodeFences(text: string): string {
  return text.replace(/```json\n?|```/g, '').trim();
}

function extractJsonText(text: string, expectedRoot: 'array' | 'object'): string {
  let rawText = stripCodeFences(text);
  const rootChar = expectedRoot === 'array' ? '[' : '{';
  const startIndex = rawText.indexOf(rootChar);

  if (startIndex !== -1) {
    rawText = rawText.slice(startIndex);
  }

  return rawText;
}

export function parseJsonPayload<T>(text: string, expectedRoot: 'array' | 'object'): T {
  const rawText = extractJsonText(text, expectedRoot);

  try {
    return JSON.parse(rawText) as T;
  } catch {
    const repaired = jsonrepair(rawText);
    return JSON.parse(repaired) as T;
  }
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return data?.error?.message || data?.error?.details || data?.message || data?.msg || fallback;
  } catch {
    return fallback;
  }
}

function normalizeImageUrl(image: string): string {
  if (image.startsWith('data:image/')) {
    return image;
  }

  return `data:image/png;base64,${ image }`;
}

function getGeminiModel(config: DirectApiConfig): string {
  return config.modelOverrides?.geminiModel || DEFAULT_MODELS.geminiModel;
}

function getOpenAiCompatBaseUrl(provider: OpenAiCompatProvider, config: DirectApiConfig): string {
  if (provider === 'custom') {
    return normalizeCustomBaseUrl(config.customBaseUrl);
  }

  return OPENAI_COMPAT_BASE_URL[provider];
}

function getOpenAiCompatTextModel(provider: OpenAiCompatProvider, config: DirectApiConfig): string {
  switch (provider) {
    case 'deepseek':
      return config.modelOverrides?.deepseekModel || DEFAULT_MODELS.deepseekModel;
    case 'qwen':
      return config.modelOverrides?.qwenTextModel || DEFAULT_MODELS.qwenTextModel;
    case 'zhipu':
      return config.modelOverrides?.zhipuTextModel || DEFAULT_MODELS.zhipuTextModel;
    case 'doubao':
      return config.doubaoEndpointIdText || config.modelOverrides?.doubaoTextModel || DEFAULT_MODELS.doubaoTextModel;
    case 'custom':
      return getCustomModel(config);
  }
}

function getOpenAiCompatVisionModel(provider: OpenAiCompatProvider, config: DirectApiConfig): string {
  switch (provider) {
    case 'deepseek':
      return config.modelOverrides?.deepseekModel || DEFAULT_MODELS.deepseekModel;
    case 'qwen':
      return config.modelOverrides?.qwenVisionModel || DEFAULT_MODELS.qwenVisionModel;
    case 'zhipu':
      return config.modelOverrides?.zhipuVisionModel || DEFAULT_MODELS.zhipuVisionModel;
    case 'doubao':
      return config.doubaoEndpointIdVision || config.modelOverrides?.doubaoVisionModel || DEFAULT_MODELS.doubaoVisionModel;
    case 'custom':
      return getCustomModel(config);
  }
}

async function fetchGeminiJson(
  model: string,
  apiKey: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<string> {
  const requestApiKey = normalizeApiKeyForRequest(apiKey);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${ encodeURIComponent(model) }:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': requestApiKey,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, fallbackMessage));
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function fetchOpenAiCompatJson(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<string> {
  const requestApiKey = normalizeApiKeyForRequest(apiKey);
  const response = await fetch(`${ baseUrl }/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ requestApiKey }`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await parseErrorMessage(response, fallbackMessage);
    if (baseUrl === OPENAI_COMPAT_BASE_URL.qwen) {
      if (response.status === 403 && /API[- ]?Key restrictions/i.test(message)) {
        throw new Error(`${message} Check this API key's model permissions and IP allowlist in Model Studio. Allow the selected model (${body.model}) and use a Beijing-region key for the built-in Qwen provider.`);
      }
      if (response.status === 404) {
        throw new Error(`${message} Model ${body.model} is unavailable at the Beijing endpoint. Check the exact model ID, retirement status and key permissions; use a supported model such as ${DEFAULT_MODELS.qwenVisionModel}.`);
      }
    }
    throw new Error(message);
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  // A repaired, truncated JSON array can silently omit later TOC entries.
  if (choice?.finish_reason === 'length') {
    throw new Error(`The ${ String(body.model) } response reached its output token limit. Try fewer TOC pages per request.`);
  }
  return choice?.message?.content || '[]';
}

const VISION_OUTPUT_TOKEN_BUDGET = 16384;

function getOpenAiCompatOptions(provider: OpenAiCompatProvider, model: string, vision = false): Record<string, unknown> {
  if (provider === 'deepseek') {
    return { max_tokens: vision ? VISION_OUTPUT_TOKEN_BUDGET : 4096, thinking: { type: 'disabled' } };
  }

  if (provider === 'doubao' && model.startsWith('doubao-seed-2-1-lite')) {
    return { max_tokens: vision ? VISION_OUTPUT_TOKEN_BUDGET : 4096, thinking: { type: 'disabled' } };
  }

  if (provider === 'custom') {
    return {
      max_completion_tokens: vision ? VISION_OUTPUT_TOKEN_BUDGET : 4096,
      ...(model === 'gpt-6-luna' && { reasoning_effort: 'none' }),
    };
  }

  if (provider === 'qwen') {
    const isQwen3Vl = /^qwen3-vl(?:-|$)/.test(model);
    return {
      max_tokens: vision ? VISION_OUTPUT_TOKEN_BUDGET : 4096,
      ...(model.startsWith('qwen3') && { enable_thinking: false }),
      ...(vision && isQwen3Vl && { vl_high_resolution_images: true }),
    };
  }

  if (provider === 'zhipu') {
    if (model.startsWith('glm-5.3')) {
      return { max_tokens: VISION_OUTPUT_TOKEN_BUDGET, thinking: { type: 'enabled' }, reasoning_effort: 'low' };
    }
    if (model === DEFAULT_MODELS.zhipuTextModel || model === DEFAULT_MODELS.zhipuVisionModel) {
      return { max_tokens: vision ? VISION_OUTPUT_TOKEN_BUDGET : 4096, thinking: { type: 'disabled' } };
    }
    return vision ? { max_tokens: VISION_OUTPUT_TOKEN_BUDGET } : {};
  }

  return { max_tokens: vision ? VISION_OUTPUT_TOKEN_BUDGET : 4096 };
}

async function requestTextJson(config: DirectApiConfig, systemPrompt: string, userText: string): Promise<string> {
  const provider = requireProvider(config.provider);

  if (provider === 'gemini') {
    return fetchGeminiJson(
      getGeminiModel(config),
      config.apiKey,
      {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: userText }],
        }],
      },
      `${ providerLabel(provider) } request failed.`,
    );
  }

  const model = getOpenAiCompatTextModel(provider, config);
  const textBody: Record<string, unknown> = {
    model,
    ...getOpenAiCompatOptions(provider, model),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
  };

  return fetchOpenAiCompatJson(
    getOpenAiCompatBaseUrl(provider, config),
    config.apiKey,
    textBody,
    `${ providerLabel(provider) } request failed.`,
  );
}

async function requestVisionJson(config: DirectApiConfig, systemPrompt: string, promptText: string, images: string[]): Promise<string> {
  const provider = requireProvider(config.provider);

  if (provider === 'gemini') {
    const parts = images.map((image) => {
      const normalized = normalizeImageUrl(image);
      const [meta, data] = normalized.split(',');
      const mimeType = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';

      return {
        inlineData: {
          mimeType,
          data,
        },
      };
    });

    return fetchGeminiJson(
      getGeminiModel(config),
      config.apiKey,
      {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [{
          role: 'user',
          parts: [
            { text: promptText },
            ...parts,
          ],
        }],
      },
      `${ providerLabel(provider) } request failed.`,
    );
  }

  const model = getOpenAiCompatVisionModel(provider, config);
  const visionBody: Record<string, unknown> = {
    model,
    ...getOpenAiCompatOptions(provider, model, true),
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          ...images.map((image) => ({
            type: 'image_url',
            image_url: { url: normalizeImageUrl(image) },
          })),
        ],
      },
    ],
  };

  return fetchOpenAiCompatJson(
    getOpenAiCompatBaseUrl(provider, config),
    config.apiKey,
    visionBody,
    `${ providerLabel(provider) } request failed.`,
  );
}

export async function processToc(config: TocInputConfig) {
  const provider = requireProvider(config.provider);

  if (config.text?.trim()) {
    const jsonText = await requestTextJson(config, SYSTEM_PROMPT_TEXT, config.text);
    return normalizeToc(parseJsonPayload<any[]>(jsonText, 'array'));
  }

  if (!config.images?.length) {
    throw new Error('No images provided.');
  }

  const visionPrompt = config.visionPrompt?.trim() || DEFAULT_VISION_PROMPT_TEMPLATE;

  try {
    const jsonText = await requestVisionJson(
      config,
      visionPrompt,
      'Analyze these Table of Contents images and return the single structured JSON.',
      config.images,
    );
    return normalizeToc(parseJsonPayload<any[]>(jsonText, 'array'));
  } catch (err: any) {
    if (provider === 'zhipu' && typeof err?.message === 'string' && err.message.includes('context_length_exceeded')) {
      throw new Error('图片总大小超出了智谱 Flash 模型的限制，请尝试减少图片数量或切换到其他视觉模型');
    }
    throw err;
  }
}

export async function generateBoard(tocItems: GraphNodeInput[], config: DirectApiConfig): Promise<GraphResponse> {
  const provider = requireProvider(config.provider);
  const tocText = tocItems
    .map((item) => `[ID:${ item.id }] ${ item.title } (Page: ${ item.page || 'N/A' })`)
    .join('\n');

  const jsonText = provider === 'gemini'
    ? await fetchGeminiJson(
      getGeminiModel(config),
      config.apiKey,
      {
        generationConfig: {
          responseMimeType: 'application/json',
        },
        contents: [{
          role: 'user',
          parts: [{ text: `${ SYSTEM_PROMPT_GRAPH }\n\nToC Data:\n${ tocText }` }],
        }],
      },
      `${ providerLabel(provider) } request failed.`,
    )
    : await fetchOpenAiCompatJson(
      getOpenAiCompatBaseUrl(provider, config),
      config.apiKey,
      {
        model: getOpenAiCompatTextModel(provider, config),
        ...getOpenAiCompatOptions(provider, getOpenAiCompatTextModel(provider, config)),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_GRAPH },
          { role: 'user', content: `ToC Data:\n${ tocText }` },
        ],
      },
      `${ providerLabel(provider) } request failed.`,
    );

  const aiData = parseJsonPayload<{
    nodes?: Array<{ id: string; label?: string; cluster?: string; page?: number | null }>;
    edges?: Array<{ source: string; target: string; type: string; label: string }>;
  }>(jsonText, 'object');

  return {
    nodes: (aiData.nodes || []).map((aiNode) => {
      const match = tocItems.find((item) => String(item.id) === String(aiNode.id));
      const page = aiNode.page !== undefined ? aiNode.page : (match?.page ?? null);

      return {
        id: aiNode.id,
        title: aiNode.label || String(aiNode.id),
        isInferred: !page,
        page,
        cluster: aiNode.cluster || 'Unclassified',
      };
    }),
    edges: aiData.edges || [],
  };
}
