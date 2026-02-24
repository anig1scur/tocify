import type * as PdfjsLibTypes from 'pdfjs-dist';
import {get} from 'svelte/store';

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

export async function generateToc(
  { pdfInstance, ranges, startPage, endPage, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision }: AiTocOptions) {

  // Normalize ranges
  let finalRanges: { start: number; end: number }[] = [];
  if (ranges && ranges.length > 0) {
    finalRanges = ranges;
  } else if (startPage !== undefined && endPage !== undefined) {
    finalRanges = [{ start: startPage, end: endPage }];
  } else {
    throw new Error('No page ranges provided.');
  }

  const service = get(pdfService);
  if (!service) {
    throw new Error('PDF Service not initialized');
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
        throw new Error(`Too many pages selected. Max allowed is 10 pages.`);
      }

      const image = await service.getPageAsImage(pdfInstance, pageNum);

      currentTotalSize += image.length;
      if (currentTotalSize > MAX_PAYLOAD_SIZE) {
        throw new Error(
          'Total size too large (>5MB). Please reduce page range or lower resolution.');
      }

      imagesBase64.push(image);
    }
  }

  if (imagesBase64.length === 0) {
    throw new Error('No valid pages selected.');
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
    let friendlyMessage = err.message || 'AI processing failed.';

    if (response.status >= 500 && response.status < 600) {
      const p = provider || 'Unknown Provider';
      const providerName = p.charAt(0).toUpperCase() + p.slice(1);
      friendlyMessage = `${ providerName }: ${ friendlyMessage } You can try other model in API settings.`;
    } else if (friendlyMessage.includes('No valid ToC') ||
        friendlyMessage.includes('parsing error') ||
        friendlyMessage.includes('structure')) {
      friendlyMessage =
          'The selected pages don\'t look like a ToC. Please try adjusting the page range.';
    } else if (response.status === 413) {
      friendlyMessage =
          'Request too large. Please reduce the page range or lower the resolution.';
    } else if (response.status === 429) {
      friendlyMessage =
        'Daily limit exceeded. Please try again tomorrow or input your own API key in API settings.';
    }
    throw new Error(friendlyMessage);
  }

  return await response.json();
}