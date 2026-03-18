import type * as PdfjsLibTypes from 'pdfjs-dist';
import {get} from 'svelte/store';
import {_} from 'svelte-i18n';

import {pdfService} from '../stores';

interface AiTocOptions {
  pdfInstance: PdfjsLibTypes.PDFDocumentProxy;
  ranges?: { start: number; end: number }[];
  startPage?: number;
  endPage?: number;
  apiKey?: string;
  provider?: string;
  doubaoEndpointIdText?: string;
  doubaoEndpointIdVision?: string;
}

function t(key: string, values?: Record<string, string | number>): string {
  return get(_)(key, { values }) as string;
}

export async function generateToc(
  { pdfInstance, ranges, startPage, endPage, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision }: AiTocOptions) {

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

  const imagesBase64: string[] = [];
  let currentTotalSize = 0;
  const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;
  let totalPageCount = 0;

  for (const range of finalRanges) {
    if (range.end < range.start) {
      continue; // Skip invalid ranges
    }

    for (let pageNum = range.start;pageNum <= range.end;pageNum++) {
      totalPageCount++;
      if (totalPageCount > 10) {
        throw new Error(t('error.too_many_pages', { max: 10 }));
      }

      const image = await service.getPageAsImage(pdfInstance, pageNum);

      currentTotalSize += image.length;
      if (currentTotalSize > MAX_PAYLOAD_SIZE) {
        throw new Error(t('error.payload_too_large'));
      }

      imagesBase64.push(image);
    }
  }

  if (imagesBase64.length === 0) {
    throw new Error(t('error.no_valid_pages'));
  }

  const response = await fetch('/api/process-toc', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      images: imagesBase64,
      apiKey: apiKey,
      provider: provider,
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    let friendlyMessage = err.message || t('error.ai_failed');

    if (response.status >= 500 && response.status < 600) {
      const p = provider || 'Unknown Provider';
      const providerName = p.charAt(0).toUpperCase() + p.slice(1);
      friendlyMessage = t('error.try_other_model', { provider: providerName, message: friendlyMessage });
    } else if (friendlyMessage.includes('No valid ToC') ||
        friendlyMessage.includes('parsing error') ||
        friendlyMessage.includes('structure')) {
      friendlyMessage = t('error.not_a_toc');
    } else if (response.status === 413) {
      friendlyMessage = t('error.request_too_large');
    } else if (response.status === 429) {
      friendlyMessage = t('error.daily_limit_exceeded');
    }
    throw new Error(friendlyMessage);
  }

  return await response.json();
}