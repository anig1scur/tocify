import type { PDFDocument } from 'pdf-lib';
import { PDFHexString, PDFName } from 'pdf-lib';

export type PageLabelStyle =
  | 'decimal'
  | 'roman_upper'
  | 'roman_lower'
  | 'alpha_upper'
  | 'alpha_lower'
  | 'none';

export interface PageLabelSegment {
  /** 1-based physical page number in the final PDF */
  startPage: number;
  style: PageLabelStyle;
  prefix: string;
  /** Starting number for the first page in this segment (usually 1) */
  startAt: number;
}

export interface PageLabelSettings {
  enabled: boolean;
  segments: PageLabelSegment[];
}

export const createDefaultPageLabelSettings = (): PageLabelSettings => ({
  enabled: false,
  segments: [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }],
});

export function isDefaultPageLabelSegments(segments: PageLabelSegment[] | undefined): boolean {
  if (!segments || segments.length === 0) return true;
  if (segments.length !== 1) return false;
  const s = segments[0];
  return (
    s.startPage === 1 &&
    s.style === 'decimal' &&
    (s.prefix ?? '') === '' &&
    (s.startAt ?? 1) === 1
  );
}

export function suggestPageLabelSegmentsFromTocRanges(
  ranges: { start: number; end: number }[],
  totalPages: number
): PageLabelSegment[] {
  if (!Array.isArray(ranges) || ranges.length === 0 || !Number.isFinite(totalPages) || totalPages <= 0) {
    return [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }];
  }

  let minSel = Infinity;
  let maxSel = -Infinity;
  for (const r of ranges) {
    const a = Number(r.start);
    const b = Number(r.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    minSel = Math.min(minSel, start);
    maxSel = Math.max(maxSel, end);
  }

  if (!Number.isFinite(minSel) || !Number.isFinite(maxSel)) {
    return [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }];
  }

  const tocStart = Math.max(1, Math.min(totalPages, Math.trunc(minSel)));
  const tocEnd = Math.max(tocStart, Math.min(totalPages, Math.trunc(maxSel)));

  const segments: PageLabelSegment[] = [];

  if (tocStart > 1) {
    segments.push({ startPage: 1, style: 'alpha_upper', prefix: '', startAt: 1 });
  }

  segments.push({ startPage: tocStart, style: 'roman_lower', prefix: '', startAt: 1 });

  if (tocEnd < totalPages) {
    segments.push({ startPage: tocEnd + 1, style: 'decimal', prefix: '', startAt: 1 });
  }

  return segments;
}

const styleToPdfName = (style: PageLabelStyle): PDFName | undefined => {
  switch (style) {
    case 'decimal':
      return PDFName.of('D');
    case 'roman_upper':
      return PDFName.of('R');
    case 'roman_lower':
      return PDFName.of('r');
    case 'alpha_upper':
      return PDFName.of('A');
    case 'alpha_lower':
      return PDFName.of('a');
    case 'none':
      return undefined;
  }
};

export function normalizePageLabelSegments(
  segments: PageLabelSegment[],
  totalPages?: number
): PageLabelSegment[] {
  const cleaned = (segments || [])
    .map((seg) => ({
      startPage: Math.trunc(Number(seg.startPage) || 1),
      style: seg.style ?? 'decimal',
      prefix: seg.prefix ?? '',
      startAt: Math.trunc(Number(seg.startAt) || 1),
    }))
    .map((seg) => ({
      ...seg,
      startPage: Math.max(1, totalPages ? Math.min(seg.startPage, totalPages) : seg.startPage),
      startAt: Math.max(1, seg.startAt),
    }))
    .filter((seg) => Number.isFinite(seg.startPage) && seg.startPage >= 1);

  cleaned.sort((a, b) => a.startPage - b.startPage);

  // Deduplicate same startPage: keep the last one (user's latest edit usually comes last)
  const deduped: PageLabelSegment[] = [];
  for (const seg of cleaned) {
    const last = deduped[deduped.length - 1];
    if (last && last.startPage === seg.startPage) {
      deduped[deduped.length - 1] = seg;
    } else {
      deduped.push(seg);
    }
  }

  return deduped;
}

/**
 * Set (or remove) PDF Catalog `/PageLabels`.
 *
 * `segments[].startPage` is 1-based physical page number in the *final* PDF.
 * We write a simple number tree with `/Nums` since docs are small.
 */
export function setPageLabels(doc: PDFDocument, settings?: PageLabelSettings) {
  const key = PDFName.of('PageLabels');
  if (!settings?.enabled) {
    doc.catalog.delete(key);
    return;
  }

  const totalPages = doc.getPageCount();
  const segments = normalizePageLabelSegments(settings.segments, totalPages);
  if (segments.length === 0) {
    doc.catalog.delete(key);
    return;
  }

  const nums: any[] = [];

  for (const seg of segments) {
    const startIndex = seg.startPage - 1;
    if (startIndex < 0 || startIndex >= totalPages) continue;

    const labelDict: Record<string, any> = {};

    const pdfStyle = styleToPdfName(seg.style);
    if (pdfStyle) labelDict.S = pdfStyle;

    if (seg.prefix) {
      labelDict.P = PDFHexString.fromText(seg.prefix);
    }

    if (pdfStyle && seg.startAt && seg.startAt !== 1) {
      labelDict.St = seg.startAt;
    }

    if (Object.keys(labelDict).length === 0) continue;
    nums.push(startIndex, doc.context.obj(labelDict));
  }

  if (nums.length === 0) {
    doc.catalog.delete(key);
    return;
  }

  const pageLabelsTree = doc.context.obj({
    Nums: nums,
  });

  const ref = doc.context.register(pageLabelsTree);
  doc.catalog.set(key, ref);
}
