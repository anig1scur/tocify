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
  if (!Array.isArray(ranges) || ranges.length === 0 || totalPages <= 0) {
    return [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }];
  }

  const validPages = ranges
    .map(r => [r.start, r.end])
    .flat()
    .filter(Number.isFinite);
  
  if (validPages.length === 0) return [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }];

  const tocStart = Math.max(1, Math.min(totalPages, Math.trunc(Math.min(...validPages))));
  const tocEnd = Math.max(tocStart, Math.min(totalPages, Math.trunc(Math.max(...validPages))));

  const segments: PageLabelSegment[] = [];
  if (tocStart > 1) segments.push({ startPage: 1, style: 'alpha_upper', prefix: '', startAt: 1 });
  segments.push({ startPage: tocStart, style: 'roman_lower', prefix: '', startAt: 1 });
  if (tocEnd < totalPages) segments.push({ startPage: tocEnd + 1, style: 'decimal', prefix: '', startAt: 1 });

  return segments;
}

const STYLE_MAP: Record<PageLabelStyle, string | undefined> = {
  decimal: 'D',
  roman_upper: 'R',
  roman_lower: 'r',
  alpha_upper: 'A',
  alpha_lower: 'a',
  none: undefined,
};

export function normalizePageLabelSegments(segments: PageLabelSegment[], totalPages?: number): PageLabelSegment[] {
  return (segments || [])
    .map(seg => ({
      startPage: Math.max(1, totalPages ? Math.min(Math.trunc(Number(seg.startPage) || 1), totalPages) : Math.trunc(Number(seg.startPage) || 1)),
      style: seg.style ?? 'decimal',
      prefix: seg.prefix ?? '',
      startAt: Math.max(1, Math.trunc(Number(seg.startAt) || 1)),
    }))
    .sort((a, b) => a.startPage - b.startPage)
    .reduce((acc: PageLabelSegment[], curr) => {
      if (acc.length > 0 && acc[acc.length - 1].startPage === curr.startPage) {
        acc[acc.length - 1] = curr;
      } else {
        acc.push(curr);
      }
      return acc;
    }, []);
}

/** Get the segment index for a 1-based physical page number */
function findSegmentIndex(segments: PageLabelSegment[], pageNum: number): number {
  let low = 0, high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startPage <= pageNum) low = mid + 1;
    else high = mid - 1;
  }
  return high >= 0 ? high : 0;
}

export function setPageLabels(doc: PDFDocument, settings?: PageLabelSettings) {
  const key = PDFName.of('PageLabels');
  if (!settings?.enabled) return doc.catalog.delete(key);

  const totalPages = doc.getPageCount();
  const segments = normalizePageLabelSegments(settings.segments, totalPages);
  if (segments.length === 0) return doc.catalog.delete(key);

  const nums = segments.flatMap(seg => {
    const startIndex = seg.startPage - 1;
    const labelDict: Record<string, any> = {};
    const pdfStyle = STYLE_MAP[seg.style];
    
    if (pdfStyle) labelDict.S = PDFName.of(pdfStyle);
    if (seg.prefix) labelDict.P = PDFHexString.fromText(seg.prefix);
    if (pdfStyle && seg.startAt > 1) labelDict.St = seg.startAt;

    return Object.keys(labelDict).length > 0 ? [startIndex, doc.context.obj(labelDict)] : [];
  });

  if (nums.length === 0) return doc.catalog.delete(key);

  doc.catalog.set(key, doc.context.register(doc.context.obj({ Nums: nums })));
}

export function formatPageLabel(index: number, settings: PageLabelSettings, totalPages: number): string {
  if (!settings.enabled) return (index + 1).toString();
  const segments = normalizePageLabelSegments(settings.segments, totalPages);
  if (segments.length === 0) return (index + 1).toString();

  const seg = segments[findSegmentIndex(segments, index + 1)];
  const num = seg.startAt + (index - (seg.startPage - 1));
  
  const formatters: Record<PageLabelStyle, (n: number) => string> = {
    decimal: n => n.toString(),
    roman_upper: n => toRoman(n).toUpperCase(),
    roman_lower: n => toRoman(n).toLowerCase(),
    alpha_upper: n => toAlpha(n).toUpperCase(),
    alpha_lower: n => toAlpha(n).toLowerCase(),
    none: n => (index + 1).toString(),
  };

  return (seg.prefix ?? '') + (formatters[seg.style] || formatters.decimal)(num);
}

function toRoman(num: number): string {
  if (num <= 0) return num.toString();
  const lookup: [string, number][] = [
    ['m', 1000], ['cm', 900], ['d', 500], ['cd', 400], ['c', 100], ['xc', 90],
    ['l', 50], ['xl', 40], ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]
  ];
  let res = '', n = num;
  for (const [char, val] of lookup) {
    while (n >= val) { res += char; n -= val; }
  }
  return res;
}

function toAlpha(num: number): string {
  if (num <= 0) return num.toString();
  const char = String.fromCharCode(97 + ((num - 1) % 26));
  const count = Math.floor((num - 1) / 26) + 1;
  return char.repeat(count);
}
