import type { OcrResult } from '@paddleocr/paddleocr-js';
import type * as pdfjsLib from 'pdfjs-dist';

import { clamp, resolveSmallHorizontalOverlaps, type OcrBBox } from './geometry';

const OCR_WATERMARK_TEXT_MAX = 105;
const OCR_WATERMARK_MIN = 125;
const OCR_WATERMARK_MAX = 225;
const OCR_WATERMARK_BACKGROUND_MIN = 235;

export function applyWatermarkCleanupForOcr(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const gray = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    let output = 255;

    if (gray <= OCR_WATERMARK_TEXT_MAX || gray < OCR_WATERMARK_MIN) {
      output = 0;
    }

    if (gray >= OCR_WATERMARK_MIN && gray <= OCR_WATERMARK_MAX) {
      output = 255;
    }

    if (gray >= OCR_WATERMARK_BACKGROUND_MIN) {
      output = 255;
    }

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
  const xs = poly.map(([x]) => x);
  const ys = poly.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function luminance(data: Uint8ClampedArray, offset: number) {
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
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
  const sampleLuminance: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((cropWidth * cropHeight) / 1200)));

  for (let y = 0; y < cropHeight; y += step) {
    for (let x = 0; x < cropWidth; x += step) {
      sampleLuminance.push(luminance(image.data, (y * cropWidth + x) * 4));
    }
  }

  sampleLuminance.sort((a, b) => a - b);
  const background = sampleLuminance[Math.floor(sampleLuminance.length * 0.9)] ?? 255;
  const inkThreshold = Math.max(70, background - 55);
  const columnInk = new Array(cropWidth).fill(0);

  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      if (luminance(image.data, (y * cropWidth + x) * 4) < inkThreshold) {
        columnInk[x] += 1;
      }
    }
  }

  const minColumnInk = Math.max(3, Math.floor(cropHeight * 0.1));
  const columnWindow = (x: number) =>
    (columnInk[x - 2] ?? 0) +
    (columnInk[x - 1] ?? 0) +
    columnInk[x] +
    (columnInk[x + 1] ?? 0) +
    (columnInk[x + 2] ?? 0);

  let left = 0;
  let right = cropWidth - 1;

  while (left < right && columnWindow(left) < minColumnInk) left += 1;
  while (right > left && columnWindow(right) < minColumnInk) right -= 1;

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
