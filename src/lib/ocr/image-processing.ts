import type { OcrResult } from '@paddleocr/paddleocr-js';
import type * as pdfjsLib from 'pdfjs-dist';

import { clamp, resolveSmallHorizontalOverlaps, type OcrBBox } from './geometry';

const OCR_WATERMARK_MIN = 125;

function luminance(data: Uint8ClampedArray, offset: number) {
  return ((data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114 + 500) / 1000) | 0;
}

export function applyWatermarkCleanupForOcr(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const output = luminance(data, index) < OCR_WATERMARK_MIN ? 0 : 255;
    data[index] = output;
    data[index + 1] = output;
    data[index + 2] = output;
    data[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
}

export async function renderPdfPageAsCanvas(
  instance: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  qualitySize: number,
  options: { watermarkCleanup?: boolean } = {},
) {
  const page = await instance.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const baseMaxSide = Math.max(baseViewport.width, baseViewport.height);
  const scale = qualitySize / Math.max(1, baseMaxSide);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Could not create canvas context for OCR image rendering.');
  }

  const renderTask = page.render({
    canvasContext: context,
    viewport,
  });

  await renderTask.promise.then(() => page.cleanup()).catch(() => page.cleanup());
  if (options.watermarkCleanup) {
    applyWatermarkCleanupForOcr(canvas);
  }
  return canvas;
}

function polyToBBox(poly: Array<[number, number]>): OcrBBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return [minX, minY, maxX, maxY];
}

function refineHorizontalBBoxByInk(
  context: CanvasRenderingContext2D | null,
  canvasWidth: number,
  canvasHeight: number,
  bbox: OcrBBox,
): OcrBBox {
  if (!context) return bbox;

  const [x1, y1, x2, y2] = bbox;
  const cropX = clamp(Math.floor(x1), 0, canvasWidth - 1);
  const cropY = clamp(Math.floor(y1), 0, canvasHeight - 1);
  const cropRight = clamp(Math.ceil(x2), cropX + 1, canvasWidth);
  const cropBottom = clamp(Math.ceil(y2), cropY + 1, canvasHeight);
  const cropWidth = cropRight - cropX;
  const cropHeight = cropBottom - cropY;

  if (cropWidth < 4 || cropHeight < 4) return bbox;

  const image = context.getImageData(cropX, cropY, cropWidth, cropHeight);
  const luminanceHistogram = new Uint32Array(256);
  const step = Math.max(1, Math.floor(Math.sqrt((cropWidth * cropHeight) / 1200)));
  let sampleCount = 0;

  for (let y = 0; y < cropHeight; y += step) {
    let offset = y * cropWidth * 4;
    for (let x = 0; x < cropWidth; x += step) {
      luminanceHistogram[luminance(image.data, offset + x * 4)] += 1;
      sampleCount += 1;
    }
  }

  const percentileTarget = Math.min(sampleCount, Math.floor(sampleCount * 0.9) + 1);
  let cumulativeCount = 0;
  let background = 255;

  for (let value = 0; value < luminanceHistogram.length; value += 1) {
    cumulativeCount += luminanceHistogram[value];
    if (cumulativeCount >= percentileTarget) {
      background = value;
      break;
    }
  }

  const inkThreshold = Math.max(70, background - 55);
  const columnInk = new Uint32Array(cropWidth);

  for (let y = 0; y < cropHeight; y += 1) {
    let offset = y * cropWidth * 4;
    for (let x = 0; x < cropWidth; x += 1) {
      if (luminance(image.data, offset) < inkThreshold) {
        columnInk[x] += 1;
      }
      offset += 4;
    }
  }

  const minColumnInk = Math.max(3, Math.floor(cropHeight * 0.1));
  const smoothedColumnInk = new Uint32Array(cropWidth);
  let windowSum = 0;
  let windowLeft = 0;
  let windowRight = -1;

  for (let x = 0; x < cropWidth; x += 1) {
    const targetLeft = Math.max(0, x - 2);
    const targetRight = Math.min(cropWidth - 1, x + 2);

    while (windowRight < targetRight) {
      windowRight += 1;
      windowSum += columnInk[windowRight];
    }

    while (windowLeft < targetLeft) {
      windowSum -= columnInk[windowLeft];
      windowLeft += 1;
    }

    smoothedColumnInk[x] = windowSum;
  }

  let left = 0;
  let right = cropWidth - 1;

  while (left < right && smoothedColumnInk[left] < minColumnInk) left += 1;
  while (right > left && smoothedColumnInk[right] < minColumnInk) right -= 1;

  const refinedWidth = right - left + 1;
  if (refinedWidth < cropWidth * 0.35) return bbox;

  const pad = Math.max(1, Math.round(Math.min(cropWidth, cropHeight) * 0.04));
  const rightPad = Math.max(pad, Math.round(cropHeight * 0.06));
  return [
    clamp(cropX + left - pad, x1, x2),
    y1,
    clamp(cropX + right + 1 + rightPad, x1, x2),
    y2,
  ];
}

export function convertLocalResult(pageNumber: number, result: OcrResult, canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const lines = result.items
    .filter((item) => item.text.trim())
    .map((item) => ({
      text: item.text.trim(),
      bbox: refineHorizontalBBoxByInk(context, canvas.width, canvas.height, polyToBBox(item.poly)),
      score: item.score,
    }));

  return {
    page: pageNumber,
    imageWidth: result.image.width,
    imageHeight: result.image.height,
    lines: resolveSmallHorizontalOverlaps(lines),
    metrics: result.metrics,
    runtime: result.runtime,
  };
}
