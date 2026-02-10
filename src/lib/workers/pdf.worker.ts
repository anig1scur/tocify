import { PDFDocument, type PDFFont, PDFName, type PDFPage, rgb, StandardFonts, PDFArray } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import fontkit from 'pdf-fontkit';
import { TOC_LAYOUT, CJK_REGEX } from '../constants';
import { setOutline } from '../pdf/outliner';

// Configure PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

let sourcePdfBytes: ArrayBuffer | null = null;
let fontCache: Map<string, ArrayBuffer> = new Map();

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    if (type === 'INIT') {
      sourcePdfBytes = payload.pdfBytes;
      self.postMessage({ type: 'INIT_SUCCESS', id });
    } else if (type === 'LOAD_FONTS') {
      const { family, regular, bold } = payload;
      fontCache.set(`${ family }_regular`, regular);
      fontCache.set(`${ family }_bold`, bold);
      self.postMessage({ type: 'LOAD_FONTS_SUCCESS', id });
    } else if (type === 'GENERATE') {
      if (!sourcePdfBytes) throw new Error('Source PDF not initialized');

      const { items, config } = payload;
      const result = await generatePdf(items, config);

      // Transfer the buffer back to main thread
      self.postMessage(
        { type: 'GENERATE_SUCCESS', payload: result, id },
        // @ts-ignore
        [result.pdfBytes.buffer]
      );
    } else if (type === 'DETECT_TOC') {
      if (!sourcePdfBytes) throw new Error('Source PDF not initialized');
      const detected = await detectTocPages(sourcePdfBytes);
      self.postMessage({ type: 'DETECT_TOC_SUCCESS', payload: detected, id });
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
      id
    });
  }
};

async function detectTocPages(pdfBytes: ArrayBuffer): Promise<number[]> {
  // Load with PDF.js for text extraction
  // disableWorker: true forces it to run in the current thread (which is already a worker)
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    disableFontFace: true,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
    cMapPacked: true,
  });

  const pdf = await loadingTask.promise;
  const maxScanPages = Math.min(20, pdf.numPages);
  const tocKeywords = ['contents', 'table of contents', '目录', '目次'];
  const detectedPages: number[] = [];

  // Parallelize page fetching for speed
  const pagePromises = [];
  for (let i = 1;i <= maxScanPages;i++) {
    pagePromises.push(pdf.getPage(i).then(async page => {
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => item.str)
        .join(' ')
        .toLowerCase();

      const hasKeyword = tocKeywords.some(keyword => text.includes(keyword));
      let patternMatches = 0;
      const lines = content.items.map((item: any) => item.str.trim()).filter((s: string) => s.length > 0);

      for (const line of lines) {
        if (/.*\s+(\.{3,}|_{3,}|-{3,})\s*\d+$/.test(line) || /.*\s+\d+$/.test(line)) {
          patternMatches++;
        }
      }

      if (hasKeyword || patternMatches >= 5) {
        return i;
      }
      return null;
    }));
  }

  const results = await Promise.all(pagePromises);
  const validPages = results.filter((p): p is number => p !== null).sort((a, b) => a - b);

  // Cleanup
  await pdf.destroy();

  return validPages;
}

interface TocRenderContext {
  doc: PDFDocument;
  regularFont: PDFFont;
  boldFont: PDFFont;
  pageWidth: number;
  pageHeight: number;
  config: any;
  pendingAnnots: PendingAnnot[];
  insertionStartIndex: number;
  currentTocPageIndex: { value: number };
}

interface PendingAnnot {
  tocPage: PDFPage;
  rect: number[];
  targetPageNum: number;
}

async function generatePdf(items: any[], config: any) {
  const doc = await PDFDocument.load(sourcePdfBytes!);
  doc.registerFontkit(fontkit);

  const fontKey = config.fontFamily || 'huiwen';
  let regularFont: PDFFont;
  let boldFont: PDFFont;

  if (fontCache.has(`${ fontKey }_regular`) && fontCache.has(`${ fontKey }_bold`)) {
    regularFont = await doc.embedFont(fontCache.get(`${ fontKey }_regular`)!, { subset: true });
    boldFont = await doc.embedFont(fontCache.get(`${ fontKey }_bold`)!, { subset: true });
  } else {
    // Fallback
    regularFont = await doc.embedFont(StandardFonts.Helvetica);
    boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  }

  const allIndices = doc.getPageIndices();

  const insertAtPage = config.insertAtPage || 2;
  const insertionStartIndex = Math.max(0, Math.min(insertAtPage - 1, allIndices.length));

  const sizeRefPage = doc.getPage(1) || doc.getPage(0);
  const { width, height } = sizeRefPage.getSize();

  const pendingAnnots: PendingAnnot[] = [];
  const currentTocPageIndex = { value: 0 };

  const firstTocPage = doc.insertPage(
    insertionStartIndex + currentTocPageIndex.value,
    [width, height]
  );
  currentTocPageIndex.value++;

  const marginX = width * TOC_LAYOUT.PAGE.MARGIN_X_RATIO;
  const titleMarginBottom = height * TOC_LAYOUT.TITLE.MARGIN_BOTTOM_RATIO;
  const titleFontSize = width * TOC_LAYOUT.TITLE.FONT_SIZE_RATIO;

  const titleYRatio =
    typeof config.titleYStart === 'number' ? config.titleYStart : TOC_LAYOUT.ITEM.DEFAULT_TITLE_Y_RATIO;
  let yOffset = height * (1 - titleYRatio);
  // Simple check for CJK in title if needed, implementation details similar to service
  const hasCJK = items.some(i => CJK_REGEX.test(i.title));
  const titleText = hasCJK ? '目录' : 'Table of Contents';

  firstTocPage.drawText(titleText, {
    x: marginX,
    y: yOffset,
    size: titleFontSize,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  yOffset -= titleMarginBottom;

  const renderContext: TocRenderContext = {
    doc,
    regularFont,
    boldFont,
    pageWidth: width,
    pageHeight: height,
    config,
    pendingAnnots,
    insertionStartIndex,
    currentTocPageIndex
  };

  await drawTocItems(firstTocPage, items, 0, yOffset, renderContext);

  const tocPageCount = currentTocPageIndex.value;

  applyLinkAnnotations(doc, pendingAnnots, insertionStartIndex, tocPageCount);

  // Set Outline
  await setOutline(doc, items, config.pageOffset, tocPageCount);

  const pdfBytes = await doc.save({ useObjectStreams: false });

  return { pdfBytes, tocPageCount };
}

async function drawTocItems(
  currentPage: PDFPage, items: any[], level: number, startY: number,
  ctx: TocRenderContext
): Promise<{ currentPage: PDFPage; yOffset: number }> {
  let yOffset = startY;
  let currentWorkingPage = currentPage;

  const {
    doc,
    regularFont,
    boldFont,
    pageWidth,
    pageHeight,
    config,
    pendingAnnots,
    insertionStartIndex,
    currentTocPageIndex
  } = ctx;

  for (let i = 0;i < items.length;i++) {
    const item = items[i];

    const isFirstLevel = level === 0;
    const levelConfig = isFirstLevel ? config.firstLevel : config.otherLevels;
    const { fontSize, dotLeader, color, lineSpacing } = levelConfig;

    const parsedColor =
      rgb(parseInt(color.slice(1, 3), 16) / 255,
        parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255);

    const indentPerLevel = pageWidth * TOC_LAYOUT.ITEM.INDENT_PER_LEVEL_RATIO;
    const indentation = level * indentPerLevel;
    const lineHeight = fontSize * lineSpacing;
    const title = `${ item.title }`.trim();

    const marginX = pageWidth * TOC_LAYOUT.PAGE.MARGIN_X_RATIO;
    const titleX = marginX + indentation;
    const rightPad = pageWidth * TOC_LAYOUT.ITEM.RIGHT_PAD_RATIO;
    const maxWidth = pageWidth - rightPad - indentation;
    const currentFont = isFirstLevel ? boldFont : regularFont;

    const lines = splitTextIntoLines(title, fontSize, currentFont, maxWidth);
    const totalHeadingHeight = lines.length * lineHeight;

    // Check page break
    const marginBottom = pageHeight * TOC_LAYOUT.PAGE.MARGIN_BOTTOM_RATIO;
    if (yOffset - totalHeadingHeight < marginBottom) {
      currentWorkingPage = doc.insertPage(
        insertionStartIndex + currentTocPageIndex.value,
        [pageWidth, pageHeight]);
      currentTocPageIndex.value++;
      yOffset = pageHeight - marginBottom - lineHeight;
    }

    if (isFirstLevel) {
      yOffset -= (pageHeight * TOC_LAYOUT.ITEM.LINE_HEIGHT_ADJUST_RATIO);
    }

    const startYAnnot = yOffset + fontSize;

    for (let j = 0;j < lines.length;j++) {
      currentWorkingPage.drawText(lines[j], {
        x: titleX,
        y: yOffset,
        size: fontSize,
        font: currentFont,
        color: parsedColor,
      });
      if (j < lines.length - 1) {
        yOffset -= lineHeight;
      }
    }

    // Page Number
    const pageNumText = String(item.to);
    const pageNumWidth = currentFont.widthOfTextAtSize(pageNumText, fontSize);
    const pageNumPad = pageWidth * TOC_LAYOUT.ITEM.PAGE_NUM_WIDTH_PAD_RATIO;
    const pageNumX =
      pageWidth - pageNumPad - pageNumWidth;

    currentWorkingPage.drawText(pageNumText, {
      x: pageNumX,
      y: yOffset,
      size: fontSize,
      font: currentFont,
      color: parsedColor,
    });

    // Dot Leader
    if (dotLeader) {
      const lastLineTitle = lines[lines.length - 1];
      const titleWidth = currentFont.widthOfTextAtSize(lastLineTitle || '', fontSize);
      const dotsXStart =
        titleX + titleWidth + TOC_LAYOUT.ITEM.DOT_LEADER.GAP_TITLE;

      const dotsRightPad = pageWidth * TOC_LAYOUT.ITEM.DOT_LEADER.RIGHT_PAD_RATIO;
      const dotsXEnd = pageWidth - marginX -
        dotsRightPad;
      const maxDotsWidth = dotsXEnd - dotsXStart;

      if (maxDotsWidth > 0) {
        const dotSize = fontSize * TOC_LAYOUT.ITEM.DOT_LEADER.SIZE_RATIO;
        const step = TOC_LAYOUT.ITEM.DOT_LEADER.SPACING_STEP;
        const count = Math.floor(maxDotsWidth / step);

        if (count > 0) {
          const oneDotWidth = regularFont.widthOfTextAtSize('.', dotSize);
          const numDots = Math.floor(maxDotsWidth / oneDotWidth);
          const finalDots = '.'.repeat(Math.max(0, numDots - TOC_LAYOUT.ITEM.DOT_LEADER.RESERVE_COUNT));

          currentWorkingPage.drawText(finalDots, {
            x: dotsXStart,
            y: yOffset,
            size: dotSize,
            font: regularFont,
            color: parsedColor,
          });
        }
      }
    }

    const annotRect = [
      titleX,
      yOffset - TOC_LAYOUT.ITEM.ANNOT_Y_PADDING,
      pageWidth - marginX,
      startYAnnot,
    ];

    pendingAnnots.push({
      tocPage: currentWorkingPage,
      rect: annotRect,
      targetPageNum: item.to + (config.pageOffset ?? 0),
    });

    yOffset -= lineHeight;

    if (item.children?.length) {
      const childResult = await drawTocItems(
        currentWorkingPage, item.children, level + 1, yOffset, ctx);
      currentWorkingPage = childResult.currentPage;
      yOffset = childResult.yOffset;
    }
  }

  return { currentPage: currentWorkingPage, yOffset };
}

function splitTextIntoLines(
  text: string, size: number, font: PDFFont, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split('');
  let currentLine = '';

  for (const char of words) {
    const testLine = currentLine + char;
    const width = font.widthOfTextAtSize(testLine || '', size);
    if (width > maxWidth && currentLine !== '') {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine !== '') {
    lines.push(currentLine);
  }
  return lines;
}

function applyLinkAnnotations(
  doc: PDFDocument, pendingAnnots: PendingAnnot[],
  insertionStartIndex: number, tocPageCount: number) {
  const allPages = doc.getPages();
  const totalPages = allPages.length;

  for (const pa of pendingAnnots) {
    const originalTargetPageNum = pa.targetPageNum;
    const originalTargetIndex = originalTargetPageNum - 1;

    let finalTargetIndex: number;

    if (originalTargetIndex < insertionStartIndex) {
      finalTargetIndex = originalTargetIndex;
    } else {
      finalTargetIndex = originalTargetIndex + tocPageCount;
    }

    const boundedIndex =
      Math.min(Math.max(0, finalTargetIndex), totalPages - 1);
    const targetPage = allPages[boundedIndex];

    const ref = doc.context.register(doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: pa.rect,
      Border: [0, 0, 0],
      Dest: [targetPage.ref, 'Fit'],
    }));

    const existingAnnots = pa.tocPage.node.get(PDFName.of('Annots')) as PDFArray | undefined;
    if (existingAnnots) {
      existingAnnots.push(ref);
    } else {
      pa.tocPage.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
    }
  }
}
