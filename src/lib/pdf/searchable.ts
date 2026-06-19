import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from 'pdf-fontkit';

const SEARCHABLE_FONT_URL = 'https://static.aeriszhu.com/SourceHanSansSC-Regular.woff2';

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

interface BuildSearchablePdfOptions {
  pdfBytes: Uint8Array | ArrayBuffer;
  ocr: SearchableOcrDocument;
  pageStart?: number;
  pageEnd?: number;
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

function drawTransparentFittedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  targetWidth: number,
) {
  const measuredWidth = font.widthOfTextAtSize(text, size);
  const stretchRatio = measuredWidth > 0 ? targetWidth / measuredWidth : 1;

  if (stretchRatio <= 1.15 || text.length <= 1) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
      opacity: 0,
    });
    return;
  }

  const chars = Array.from(text);
  const charWidths = chars.map((char) => font.widthOfTextAtSize(char, size));
  const naturalWidth = charWidths.reduce((sum, width) => sum + width, 0);
  const gap = chars.length > 1 ? Math.max(0, (targetWidth - naturalWidth) / (chars.length - 1)) : 0;
  let cursorX = x;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const charWidth = charWidths[index];

    if (char.trim()) {
      page.drawText(char, {
        x: cursorX,
        y,
        size,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
      });
    }

    cursorX += charWidth + gap;
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
  onProgress,
}: BuildSearchablePdfOptions): Promise<Uint8Array> {
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);

  const fontBytes = await loadSearchableFontBytes();
  const font = await doc.embedFont(fontBytes, { subset: true });

  const totalPages = doc.getPageCount();
  const finalStart = Math.max(1, Math.min(totalPages, pageStart));
  const finalEnd = Math.max(finalStart, Math.min(totalPages, pageEnd ?? totalPages));

  const pageMap = new Map(ocr.pages.map((page) => [page.page, page]));
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
    page.setFont(font);
    const { width: pdfWidth, height: pdfHeight } = page.getSize();
    const scaleX = pdfWidth / ocrPage.imageWidth;
    const scaleY = pdfHeight / ocrPage.imageHeight;

    for (const line of ocrPage.lines) {
      const [x1, y1, x2, y2] = line.bbox;
      const lineWidth = Math.max(1, (x2 - x1) * scaleX);
      const lineHeight = Math.max(1, (y2 - y1) * scaleY);
      const x = x1 * scaleX;
      let size = Math.max(4, lineHeight * 0.8);
      const writableWidth = lineWidth + Math.max(0.5, size * 0.12);

      const measuredWidth = font.widthOfTextAtSize(line.text, size);
      if (measuredWidth > writableWidth) {
        size = Math.max(2, size * (writableWidth / measuredWidth));
      }

      const y = pdfHeight - (y2 * scaleY) + Math.max(0, (lineHeight - size) * 0.25);

      drawTransparentFittedText(page, font, line.text, x, y, size, writableWidth);
    }

    onProgress?.(index + 1, pagesToProcess.length);
  }

  return doc.save({ useObjectStreams: false });
}
