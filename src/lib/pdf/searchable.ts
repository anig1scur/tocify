import {
  PDFDocument,
  ParseSpeeds,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rotateAndSkewTextRadiansAndTranslate,
  setCharacterSqueeze,
  setFillingColor,
  setFontAndSize,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFName,
  type PDFPage,
} from 'pdf-lib';
import fontkit from 'pdf-fontkit';

const SEARCHABLE_FONT_URL = 'https://static.aeriszhu.com/SourceHanSansSC-Regular.woff2';
const INVISIBLE_TEXT_COLOR = rgb(0, 0, 0);
const MIN_TEXT_HORIZONTAL_SCALE = 25;
const MAX_TEXT_HORIZONTAL_SCALE = 400;
const LINES_PER_RENDER_TICK = 200;

export interface SearchableOcrLine {
  text: string;
  bbox: [number, number, number, number];
}

export interface SearchableOcrPage {
  page: number;
  imageWidth: number;
  imageHeight: number;
  lines: SearchableOcrLine[];
}

export interface SearchableOcrDocument {
  pages: SearchableOcrPage[];
}

export interface SearchablePdfPageImage {
  bytes: Uint8Array | ArrayBuffer;
  type: 'image/jpeg' | 'image/png';
  pdfWidth: number;
  pdfHeight: number;
}

interface BuildSearchablePdfOptions {
  pdfBytes: Uint8Array | ArrayBuffer;
  ocr: SearchableOcrDocument;
  pageStart?: number;
  pageEnd?: number;
  renderPageImage?: (pageNumber: number) => Promise<SearchablePdfPageImage>;
  onProgress?: (current: number, total: number) => void;
}

interface RawLineLike {
  text?: string;
  content?: string;
  rec_text?: string;
  bbox?: unknown;
  box?: unknown;
  points?: unknown;
}

let fontBytesPromise: Promise<ArrayBuffer> | null = null;

function getWidthAtSize(font: PDFFont, text: string, size: number, widthCache: Map<string, number>) {
  let widthAtUnitSize = widthCache.get(text);

  if (widthAtUnitSize === undefined) {
    widthAtUnitSize = font.widthOfTextAtSize(text, 1);
    widthCache.set(text, widthAtUnitSize);
  }

  return widthAtUnitSize * size;
}

async function yieldToEventLoop() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function getTextHorizontalScale(measuredWidth: number, targetWidth: number) {
  if (measuredWidth <= 0) return 100;
  return Math.max(
    MIN_TEXT_HORIZONTAL_SCALE,
    Math.min(MAX_TEXT_HORIZONTAL_SCALE, (targetWidth / measuredWidth) * 100),
  );
}

function drawInvisibleFittedText(
  page: PDFPage,
  font: PDFFont,
  fontKey: PDFName,
  text: string,
  x: number,
  y: number,
  size: number,
  targetWidth: number,
  measuredWidth: number,
) {
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingColor(INVISIBLE_TEXT_COLOR),
    setFontAndSize(fontKey, size),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setCharacterSqueeze(getTextHorizontalScale(measuredWidth, targetWidth)),
    rotateAndSkewTextRadiansAndTranslate(0, 0, 0, x, y),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  );
}

async function drawOcrPageTextLayer(
  page: PDFPage,
  font: PDFFont,
  fontKey: PDFName,
  ocrPage: SearchableOcrPage,
  widthCache: Map<string, number>,
) {
  const { width: pdfWidth, height: pdfHeight } = page.getSize();
  const scaleX = pdfWidth / ocrPage.imageWidth;
  const scaleY = pdfHeight / ocrPage.imageHeight;

  for (let lineIndex = 0; lineIndex < ocrPage.lines.length; lineIndex += 1) {
    const line = ocrPage.lines[lineIndex];
    const [x1, y1, x2, y2] = line.bbox;
    const lineWidth = Math.max(1, (x2 - x1) * scaleX);
    const lineHeight = Math.max(1, (y2 - y1) * scaleY);
    const x = x1 * scaleX;
    let size = Math.max(4, lineHeight * 0.8);
    const writableWidth = lineWidth + Math.max(0.5, size * 0.12);

    let measuredWidth = getWidthAtSize(font, line.text, size, widthCache);
    if (measuredWidth > writableWidth) {
      size = Math.max(2, size * (writableWidth / measuredWidth));
      measuredWidth = getWidthAtSize(font, line.text, size, widthCache);
    }

    const y = pdfHeight - (y2 * scaleY) + Math.max(0, (lineHeight - size) * 0.25);

    drawInvisibleFittedText(page, font, fontKey, line.text, x, y, size, writableWidth, measuredWidth);

    if ((lineIndex + 1) % LINES_PER_RENDER_TICK === 0) {
      await yieldToEventLoop();
    }
  }
}

async function loadSearchableFontBytes() {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(SEARCHABLE_FONT_URL, { credentials: 'omit' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load OCR font: ${response.status}`);
      }
      return response.arrayBuffer();
    });
  }

  return fontBytesPromise;
}

function normalizeRect(rawBox: unknown): [number, number, number, number] | null {
  if (!rawBox) return null;

  if (Array.isArray(rawBox) && rawBox.length === 4 && rawBox.every((value) => Number.isFinite(Number(value)))) {
    const [x1, y1, x2, y2] = rawBox.map((value) => Number(value));
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  if (
    Array.isArray(rawBox) &&
    rawBox.length >= 4 &&
    rawBox.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
  ) {
    const points = rawBox as Array<[number, number]>;
    const xs = points.map(([x]) => Number(x));
    const ys = points.map(([, y]) => Number(y));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  return null;
}

function normalizeLine(rawLine: RawLineLike): SearchableOcrLine | null {
  const text = String(rawLine.text ?? rawLine.content ?? rawLine.rec_text ?? '').trim();
  if (!text) return null;

  const bbox = normalizeRect(rawLine.bbox ?? rawLine.box ?? rawLine.points);
  if (!bbox) return null;

  return { text, bbox };
}

function normalizePage(rawPage: any, index: number): SearchableOcrPage {
  const rawPageNumber = Number(rawPage?.page ?? rawPage?.page_num ?? rawPage?.pageNumber);
  const rawPageIndex = Number(rawPage?.page_index ?? rawPage?.pageIndex);
  const page = Number.isFinite(rawPageNumber) && rawPageNumber > 0
    ? rawPageNumber
    : Number.isFinite(rawPageIndex)
      ? rawPageIndex + 1
      : index + 1;

  const imageWidth = Number(rawPage?.imageWidth ?? rawPage?.image_width ?? rawPage?.width);
  const imageHeight = Number(rawPage?.imageHeight ?? rawPage?.image_height ?? rawPage?.height);

  if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
    throw new Error(`OCR page ${page} is missing imageWidth/imageHeight.`);
  }

  let lines: SearchableOcrLine[] = [];

  if (Array.isArray(rawPage?.lines)) {
    lines = rawPage.lines.map((line: RawLineLike) => normalizeLine(line)).filter(Boolean) as SearchableOcrLine[];
  } else if (Array.isArray(rawPage?.blocks)) {
    lines = rawPage.blocks.map((line: RawLineLike) => normalizeLine(line)).filter(Boolean) as SearchableOcrLine[];
  } else if (Array.isArray(rawPage?.rec_texts) && Array.isArray(rawPage?.rec_boxes)) {
    lines = rawPage.rec_texts.map((text: unknown, lineIndex: number) => {
      const bbox = normalizeRect(rawPage.rec_boxes[lineIndex]);
      const normalizedText = String(text ?? '').trim();
      if (!bbox || !normalizedText) return null;
      return { text: normalizedText, bbox };
    }).filter(Boolean) as SearchableOcrLine[];
  }

  return {
    page,
    imageWidth,
    imageHeight,
    lines,
  };
}

export function normalizeSearchableOcr(input: unknown): SearchableOcrDocument {
  if (!input || typeof input !== 'object') {
    throw new Error('OCR result must be a JSON object.');
  }

  const raw = input as any;
  const rawPages = Array.isArray(raw.pages)
    ? raw.pages
    : Array.isArray(raw.results)
      ? raw.results
      : null;

  if (!rawPages) {
    throw new Error('OCR result must include a pages array.');
  }

  const pages = rawPages
    .map((page: unknown, index: number) => normalizePage(page, index))
    .filter((page: SearchableOcrPage) => page.lines.length > 0);

  if (pages.length === 0) {
    throw new Error('OCR result does not contain any usable text lines.');
  }

  return { pages };
}

export async function buildSearchablePdf({
  pdfBytes,
  ocr,
  pageStart = 1,
  pageEnd,
  renderPageImage,
  onProgress,
}: BuildSearchablePdfOptions): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const sourceDoc = await PDFDocument.load(bytes, {
    parseSpeed: ParseSpeeds.Fastest,
    updateMetadata: false,
  });
  const doc = renderPageImage ? await PDFDocument.create() : sourceDoc;
  doc.registerFontkit(fontkit);

  const fontBytes = await loadSearchableFontBytes();
  const font = await doc.embedFont(fontBytes, { subset: true });
  const widthCache = new Map<string, number>();

  const totalPages = doc.getPageCount();
  const sourcePageCount = sourceDoc.getPageCount();
  const finalTotalPages = renderPageImage ? sourcePageCount : totalPages;
  const finalStart = Math.max(1, Math.min(finalTotalPages, pageStart));
  const finalEnd = Math.max(finalStart, Math.min(finalTotalPages, pageEnd ?? finalTotalPages));

  const pageMap = new Map(ocr.pages.map((page) => [page.page, page]));

  if (renderPageImage) {
    for (let pageNumber = 1; pageNumber <= sourcePageCount; pageNumber += 1) {
      const imagePage = await renderPageImage(pageNumber);
      const page = doc.addPage([imagePage.pdfWidth, imagePage.pdfHeight]);
      const imageBytes = imagePage.bytes instanceof Uint8Array ? imagePage.bytes : new Uint8Array(imagePage.bytes);
      const image = imagePage.type === 'image/png'
        ? await doc.embedPng(imageBytes)
        : await doc.embedJpg(imageBytes);

      page.drawImage(image, {
        x: 0,
        y: 0,
        width: imagePage.pdfWidth,
        height: imagePage.pdfHeight,
      });

      const ocrPage = pageNumber >= finalStart && pageNumber <= finalEnd ? pageMap.get(pageNumber) : null;

      if (ocrPage) {
        const fontKey = page.node.newFontDictionary(font.name, font.ref);
        await drawOcrPageTextLayer(page, font, fontKey, ocrPage, widthCache);
      }

      onProgress?.(pageNumber, sourcePageCount);
      await yieldToEventLoop();
    }

    return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  }

  const pagesToProcess = [];

  for (let pageNumber = finalStart; pageNumber <= finalEnd; pageNumber += 1) {
    const ocrPage = pageMap.get(pageNumber);
    if (ocrPage) {
      pagesToProcess.push({ pageNumber, ocrPage });
    }
  }

  for (let index = 0; index < pagesToProcess.length; index += 1) {
    const { pageNumber, ocrPage } = pagesToProcess[index];
    const page = doc.getPage(pageNumber - 1);
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    await drawOcrPageTextLayer(page, font, fontKey, ocrPage, widthCache);

    onProgress?.(index + 1, pagesToProcess.length);
    await yieldToEventLoop();
  }

  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
