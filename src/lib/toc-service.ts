import type * as PdfjsLibTypes from 'pdfjs-dist';
import {get} from 'svelte/store';

import {pdfService} from '../stores';
import { processToc } from '$lib/service';

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

  if (!apiKey) {
    throw new Error('Please enter your API Key in Settings first.');
  }

  try {
    const result = await processToc({
      images: imagesBase64,
      apiKey: apiKey,
      provider: provider || 'gemini',
      doubaoEndpointIdText,
      doubaoEndpointIdVision,
    });
    return result;
  } catch (err: any) {
    const friendlyMessage = err.message || 'AI processing failed.';
    throw new Error(friendlyMessage);
  }
}
