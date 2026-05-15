import type * as PdfjsLibTypes from 'pdfjs-dist';
import {get} from 'svelte/store';
import {_} from 'svelte-i18n';

import { processTocDirect } from '$lib/llm/client';
import {requiresUserApiKeyForModel, type ModelOverrides} from '$lib/llm/core';

import {pdfService} from '../stores';

export const LARGE_PAGE_THRESHOLD = 8;
export const CHUNK_SIZE = 8;

export const ERROR_NEEDS_API_KEY = 'NEEDS_API_KEY';

export interface ChunkFailure {
  start: number;
  end: number;
  error: string;
}

interface AiTocOptions {
  pdfInstance: PdfjsLibTypes.PDFDocumentProxy;
  ranges?: { start: number; end: number }[];
  startPage?: number;
  endPage?: number;
  apiKey?: string;
  provider?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  onProgress?: (current: number, total: number) => void;
}

export interface GenerateTocResult {
  items: any[];
  chunkFailures: ChunkFailure[];
}

function t(key: string, values?: Record<string, string | number>): string {
  return get(_)(key, { values }) as string;
}

async function fetchChunk(
  images: string[],
  apiKey: string | undefined,
  provider: string | undefined,
  doubaoEndpointIdText: string | undefined,
  doubaoEndpointIdVision: string | undefined,
  modelOverrides: ModelOverrides | undefined,
): Promise<any[]> {
  if (requiresUserApiKeyForModel(provider, apiKey, modelOverrides)) {
    throw new Error(t('error.custom_model_needs_api_key'));
  }

  if (apiKey) {
    return processTocDirect({
      images,
      apiKey,
      provider,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
    });
  }

  const response = await fetch('/api/process-toc', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      images,
      apiKey,
      provider,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
      modelOverrides,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    let friendlyMessage = err.message || t('error.ai_failed');

    if (response.status >= 500 && response.status < 600) {
      const p = provider || 'Unknown Provider';
      const providerName = p.charAt(0).toUpperCase() + p.slice(1);
      friendlyMessage = t('error.try_other_model', { provider: providerName, message: friendlyMessage });
    } else if (response.status === 413) {
      friendlyMessage = t('error.request_too_large');
    } else if (response.status === 429 && !apiKey) {
      friendlyMessage = t('error.daily_limit_exceeded');
    }
    throw new Error(friendlyMessage);
  }

  return response.json();
}

export async function generateToc(
  { pdfInstance, ranges, startPage, endPage, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides, onProgress }: AiTocOptions
): Promise<GenerateTocResult> {

  // Normalize ranges
  let finalRanges: { start: number; end: number }[] = [];
  if (ranges && ranges.length > 0) {
    finalRanges = ranges;
  } else if (startPage !== undefined && endPage !== undefined) {
    finalRanges = [{ start: startPage, end: endPage }];
  } else {
    throw new Error(t('error.no_page_ranges'));
  }

  const service = get(pdfService);
  if (!service) {
    throw new Error(t('error.pdf_service_not_init'));
  }

  // Collect all page images with their physical page numbers
  interface PageEntry { pageNum: number; image: string }
  const pageEntries: PageEntry[] = [];
  let currentTotalSize = 0;
  const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;

  for (const range of finalRanges) {
    if (range.end < range.start) continue;
    for (let pageNum = range.start; pageNum <= range.end; pageNum++) {
      const image = await service.getPageAsImage(pdfInstance, pageNum);
      currentTotalSize += image.length;
      if (currentTotalSize > MAX_PAYLOAD_SIZE * CHUNK_SIZE) {
        throw new Error(t('error.payload_too_large'));
      }
      pageEntries.push({ pageNum, image });
    }
  }

  if (pageEntries.length === 0) {
    throw new Error(t('error.no_valid_pages'));
  }

  const totalPages = pageEntries.length;

  if (totalPages > LARGE_PAGE_THRESHOLD && !apiKey) {
    const err = new Error(t('error.needs_api_key')) as any;
    err.code = ERROR_NEEDS_API_KEY;
    throw err;
  }

  if (totalPages <= CHUNK_SIZE) {
    onProgress?.(1, 1);
    const items = await fetchChunk(
      pageEntries.map(e => e.image),
      apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides
    );
    return { items: Array.isArray(items) ? items : [], chunkFailures: [] };
  }

  const chunks: PageEntry[][] = [];
  for (let i = 0; i < pageEntries.length; i += CHUNK_SIZE) {
    chunks.push(pageEntries.slice(i, i + CHUNK_SIZE));
  }

  const totalChunks = chunks.length;
  const allItems: (any[] | null)[] = new Array(totalChunks).fill(null);
  const chunkFailures: ChunkFailure[] = [];
  let completedChunks = 0;

  const chunkPromises = chunks.map(async (chunk, i) => {
    const chunkStart = chunk[0].pageNum;
    const chunkEnd = chunk[chunk.length - 1].pageNum;
    const images = chunk.map(e => e.image);

    let result: any[] | null = null;

    // First attempt
    try {
      result = await fetchChunk(images, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides);
    } catch (_firstErr) {
      // Retry once
      try {
        result = await fetchChunk(images, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides);
      } catch (retryErr: any) {
        chunkFailures.push({
          start: chunkStart,
          end: chunkEnd,
          error: retryErr.message || t('error.ai_failed'),
        });
      }
    }

    if (result && Array.isArray(result)) {
      allItems[i] = result;
    }

    completedChunks++;
    onProgress?.(completedChunks, totalChunks);
  });

  await Promise.allSettled(chunkPromises);

  const mergedItems = allItems.flatMap(r => (Array.isArray(r) ? r : []));

  return { items: mergedItems, chunkFailures };
}
