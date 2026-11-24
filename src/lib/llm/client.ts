import {
  generateBoard,
  processToc,
  processTocWithDiagnostics,
  requireProvider,
  type DirectApiConfig,
  type GraphNodeInput,
  type GraphResponse,
  type TocInputConfig,
  type TocRecognitionResult,
} from '$lib/llm/core';
import { IS_LOCAL } from '$lib/local';

export type { DirectApiConfig, GraphNodeInput, GraphResponse, Provider, TocInputConfig } from '$lib/llm/core';

export async function processTocDirect(config: TocInputConfig) {
  return processToc(config);
}

async function callLocal<T>(path: string, config: DirectApiConfig, input: object) {
  const { signal, provider, apiKey, modelOverrides, doubaoEndpointIdText, doubaoEndpointIdVision, visionPrompt } = config;
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ ...input, provider, apiKey, modelOverrides, doubaoEndpointIdText, doubaoEndpointIdVision, visionPrompt }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || error?.error || `Local Tocify request failed (HTTP ${response.status}).`);
  }
  return await response.json() as T;
}

export async function recognizeToc(config: TocInputConfig) {
  if (IS_LOCAL && requireProvider(config.provider) !== 'custom') {
    return callLocal<TocRecognitionResult>('/api/process-toc', config, {
      images: config.images,
      text: config.text,
    });
  }
  return processTocWithDiagnostics(config);
}

export async function createKnowledgeBoard(
  tocItems: GraphNodeInput[],
  config: DirectApiConfig,
) {
  if (IS_LOCAL && requireProvider(config.provider) !== 'custom') {
    return callLocal<GraphResponse>('/api/generate-board', config, { tocItems });
  }
  return generateBoard(tocItems, config);
}
