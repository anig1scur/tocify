export const DEFAULT_PAGES_PER_REQUEST = 8;
export const MAX_CONCURRENT_TOC_REQUESTS = 2;

export function normalizePagesPerRequest(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(DEFAULT_PAGES_PER_REQUEST, Math.trunc(value)))
    : DEFAULT_PAGES_PER_REQUEST;
}

export function formatPageRanges(pages: number[]): string {
  const ranges: string[] = [];
  for (let index = 0; index < pages.length; index++) {
    const start = pages[index];
    let end = start;
    while (pages[index + 1] === end + 1) end = pages[++index];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(', ');
}
