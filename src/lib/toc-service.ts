import type * as PdfjsLibTypes from 'pdfjs-dist';
import {get} from 'svelte/store';
import {_} from 'svelte-i18n';

import { processTocWithDiagnosticsDirect } from '$lib/llm/client';
import {requiresUserApiKey, type ModelOverrides, type TocRecognitionResult} from '$lib/llm/core';
import { MAX_CONCURRENT_TOC_REQUESTS, normalizePagesPerRequest } from '$lib/llm/batching';
import type {RecognitionIgnoreRegion} from '$lib/pdf/recognition-ignore';
import type {AiTocItem} from '$lib/utils/toc';

import {pdfService} from '../stores';

export const ERROR_NEEDS_API_KEY = 'NEEDS_API_KEY';

export interface ChunkFailure {
  pages: number[];
  error: string;
}

export interface ChunkWarning {
  pages: number[];
  itemCount: number;
}

interface AiTocOptions {
  pdfInstance: PdfjsLibTypes.PDFDocumentProxy;
  ranges?: { start: number; end: number }[];
  startPage?: number;
  endPage?: number;
  apiKey?: string;
  provider?: string;
  customBaseUrl?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
  modelOverrides?: ModelOverrides;
  visionPrompt?: string;
  pagesPerRequest?: number;
  recognitionIgnoreRegions?: RecognitionIgnoreRegion[];
  onProgress?: (current: number, total: number) => void;
}

export interface GenerateTocResult {
  items: AiTocItem[];
  chunkFailures: ChunkFailure[];
  chunkWarnings: ChunkWarning[];
}

function t(key: string, values?: Record<string, string | number>): string {
  return get(_)(key, { values }) as string;
}

export async function generateToc(
  { pdfInstance, ranges, startPage, endPage, apiKey, provider, customBaseUrl, doubaoEndpointIdText, doubaoEndpointIdVision, modelOverrides, visionPrompt, pagesPerRequest, recognitionIgnoreRegions = [], onProgress }: AiTocOptions
): Promise<GenerateTocResult> {

  if (requiresUserApiKey(apiKey)) {
    const err = new Error(t('error.needs_api_key')) as Error & { code?: string };
    err.code = ERROR_NEEDS_API_KEY;
    throw err;
  }

  const fetchChunk = (images: string[]) => processTocWithDiagnosticsDirect({
    images, apiKey: apiKey!, provider, customBaseUrl, doubaoEndpointIdText,
    doubaoEndpointIdVision, modelOverrides, visionPrompt,
  });

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
  const MAX_TOTAL_IMAGE_SIZE = 40 * 1024 * 1024;

  for (const range of finalRanges) {
    if (range.end < range.start) continue;
    for (let pageNum = range.start; pageNum <= range.end; pageNum++) {
      const image = await service.getPageAsImage(pdfInstance, pageNum, 1.5, 2048, recognitionIgnoreRegions);
      currentTotalSize += image.length;
      if (currentTotalSize > MAX_TOTAL_IMAGE_SIZE) {
        throw new Error(t('error.payload_too_large'));
      }
      pageEntries.push({ pageNum, image });
    }
  }

  if (pageEntries.length === 0) {
    throw new Error(t('error.no_valid_pages'));
  }

  const chunkSize = normalizePagesPerRequest(pagesPerRequest);
  const chunks: PageEntry[][] = [];
  for (let i = 0; i < pageEntries.length; i += chunkSize) {
    chunks.push(pageEntries.slice(i, i + chunkSize));
  }

  const totalChunks = chunks.length;
  const allItems: AiTocItem[][] = Array.from({length: totalChunks}, () => []);
  const chunkFailures: ChunkFailure[] = [];
  const chunkWarnings: ChunkWarning[] = [];
  let completedChunks = 0;
  onProgress?.(0, totalChunks);

  async function processChunk(chunk: PageEntry[], i: number) {
    const pages = chunk.map(e => e.pageNum);
    const images = chunk.map(e => e.image);

    let result: TocRecognitionResult | null = null;

    // First attempt
    try {
      result = await fetchChunk(images);
    } catch (_firstErr) {
      // Retry once
      try {
        result = await fetchChunk(images);
      } catch (retryErr: any) {
        chunkFailures.push({
          pages,
          error: retryErr.message || t('error.ai_failed'),
        });
      }
    }

    if (result) {
      allItems[i] = result.items;
      if (result.incomplete) {
        chunkWarnings.push({ pages, itemCount: result.items.length });
      }
    }

    completedChunks++;
    onProgress?.(completedChunks, totalChunks);
  }

  let nextChunk = 0;
  async function runWorker() {
    while (nextChunk < totalChunks) {
      const index = nextChunk++;
      await processChunk(chunks[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(MAX_CONCURRENT_TOC_REQUESTS, totalChunks)}, runWorker));

  chunkFailures.sort((a, b) => a.pages[0] - b.pages[0]);
  chunkWarnings.sort((a, b) => a.pages[0] - b.pages[0]);

  return { items: allItems.flat(), chunkFailures, chunkWarnings };
}
