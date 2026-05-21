export type RecognitionMaskFill = 'black' | 'white';

export interface RecognitionIgnoreRegion {
  id: string;
  pageNum: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: RecognitionMaskFill;
}

export function normalizeRegion(region: RecognitionIgnoreRegion): RecognitionIgnoreRegion {
  const x = Math.min(1, Math.max(0, region.x));
  const y = Math.min(1, Math.max(0, region.y));
  const width = Math.min(1 - x, Math.max(0, region.width));
  const height = Math.min(1 - y, Math.max(0, region.height));

  return {
    ...region,
    x,
    y,
    width,
    height,
  };
}
