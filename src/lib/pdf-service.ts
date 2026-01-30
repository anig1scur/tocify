import {browser} from '$app/environment';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument, type PDFFont, PDFName, type PDFPage, rgb, StandardFonts} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

const CJK_REGEX = /[\u4e00-\u9fa5]/;

import {type TocConfig} from '../stores';

// A4 Standards
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const BASE_FONT_SIZE_L1 = 12;
const BASE_FONT_SIZE_OTHER = 10;

const TOC_LAYOUT = {
  PAGE: {
    MARGIN_X_RATIO: 40 / A4_WIDTH,
    MARGIN_BOTTOM_RATIO: 40 / A4_HEIGHT,
  },
  TITLE: {
    FONT_SIZE_RATIO: 23 / A4_WIDTH,
    MARGIN_BOTTOM_RATIO: 40 / A4_HEIGHT,
  },
  ITEM: {
    LINE_HEIGHT_ADJUST_RATIO: 10 / A4_HEIGHT,
    INDENT_PER_LEVEL_RATIO: 20 / A4_WIDTH,
    PAGE_NUM_WIDTH_PAD_RATIO: 40 / A4_WIDTH,
    ANNOT_Y_PADDING: 2,
    DOT_LEADER: {
      GAP_TITLE: 5,
      RIGHT_PAD_RATIO: 15 / A4_WIDTH,
      SPACING_STEP: 5,
      SIZE_RATIO: 0.8,
      RESERVE_COUNT: 2,
    },
    RIGHT_PAD_RATIO: 100 / A4_WIDTH,
    DEFAULT_TITLE_Y_RATIO: 1 / 3,
  },
};

export interface TocItem {
  id: string;
  title: string;
  to: number;
  children: TocItem[];
  open?: boolean;
}

export interface PDFState {
  doc: PDFDocument|null;
  newDoc: PDFDocument|null;
  instance: pdfjsLib.PDFDocumentProxy|null;
  filename: string;
  currentPage: number;
  totalPages: number;
  scale: number;
}

interface TocRenderContext {
  doc: PDFDocument;
  regularFont: PDFFont;
  boldFont: PDFFont;
  pageWidth: number;
  pageHeight: number;
  config: TocConfig;
  pendingAnnots: PendingAnnot[];
  insertionStartIndex: number;
  currentTocPageIndex: {value: number};
}

interface PendingAnnot {
  tocPage: PDFPage;
  rect: number[];
  targetPageNum: number;
}

if (typeof Promise.withResolvers === 'undefined') {
  // @ts-ignore
  Promise.withResolvers = function() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {promise, resolve, reject};
  };
}

if (browser) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
}

export class PDFService {
  static sharedWorker = new pdfjsLib.PDFWorker();

  static regularFontBytes: ArrayBuffer|null = null;
  static boldFontBytes: ArrayBuffer|null = null;

  static sanitizePdfMetadata(doc: PDFDocument) {
    try {
      // Try accessing dates to see if they throw
      doc.getCreationDate();
    } catch (e) {
      console.warn('Invalid CreationDate in PDF metadata, resetting to current date.');
      doc.setCreationDate(new Date());
    }

    try {
      doc.getModificationDate();
    } catch (e) {
      console.warn('Invalid ModificationDate in PDF metadata, resetting to current date.');
      doc.setModificationDate(new Date());
    }
  }

  private sourceDoc: PDFDocument|null = null;

  constructor() {
    if (browser && !PDFService.sharedWorker) {
      PDFService.sharedWorker = new pdfjsLib.PDFWorker();
    }
    this.loadFonts();
  }

  static loadingPromise: Promise<void> | null = null;

  async loadFonts() {
    if (!browser) return;
    if (PDFService.regularFontBytes && PDFService.boldFontBytes) return;

    if (PDFService.loadingPromise) {
      return PDFService.loadingPromise;
    }

    PDFService.loadingPromise = (async () => {
      try {
        const fontData = await fetch('/fonts/huiwen-mincho.ttf').then((res) => res.arrayBuffer());
        PDFService.regularFontBytes = fontData;
        PDFService.boldFontBytes = fontData;
      } catch (e) {
        console.error('Failed to load fonts, fallback to standard', e);
      } finally {
        PDFService.loadingPromise = null;
      }
    })();

    return PDFService.loadingPromise;
  }

  async initPreview(sourceDoc: PDFDocument) {
    await this.loadFonts();
    this.sourceDoc = sourceDoc;
  }

  static getAutoLayout(pageWidth: number) {
    const scaleRef = pageWidth;
    const scaleFactor = Math.max(0.5, Math.min(3.0, scaleRef / A4_WIDTH));

    return {
      fontSizeL1: Math.floor(BASE_FONT_SIZE_L1 * scaleFactor),
      fontSizeLOther: Math.floor(BASE_FONT_SIZE_OTHER * scaleFactor),
    };
  }

  async updateTocPages(
      items: TocItem[], config: TocConfig, insertAtPage: number = 2):
      Promise<{newDoc: PDFDocument; tocPageCount: number}> {
    if (!this.sourceDoc) {
      throw new Error(
          'Source document not initialized. Call initPreview() first.');
    }

    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    let regularFont: PDFFont;
    let boldFont: PDFFont;

    if (PDFService.regularFontBytes && PDFService.boldFontBytes) {
      regularFont =
          await doc.embedFont(PDFService.regularFontBytes, {subset: true});
      boldFont = await doc.embedFont(PDFService.boldFontBytes, {subset: true});
    } else {
      regularFont = await doc.embedFont(StandardFonts.Helvetica);
      boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    }

    const allIndices = this.sourceDoc.getPageIndices();
    const copiedPages = await doc.copyPages(this.sourceDoc, allIndices);
    copiedPages.forEach((page) => doc.addPage(page));

    const insertionStartIndex =
        Math.max(0, Math.min(insertAtPage - 1, allIndices.length));

    const sizeRefPage = doc.getPage(1) || doc.getPage(0);
    const {width, height} = sizeRefPage.getSize();

    const pendingAnnots: PendingAnnot[] = [];
    const currentTocPageIndex = {value: 0};

    const firstTocPage = doc.insertPage(
        insertionStartIndex + currentTocPageIndex.value, [width, height]);
    currentTocPageIndex.value++;

    const marginX = width * TOC_LAYOUT.PAGE.MARGIN_X_RATIO;
    const titleMarginBottom = height * TOC_LAYOUT.TITLE.MARGIN_BOTTOM_RATIO;
    const titleFontSize = width * TOC_LAYOUT.TITLE.FONT_SIZE_RATIO;

    const titleYRatio =
        typeof config.titleYStart === 'number' ? config.titleYStart : TOC_LAYOUT.ITEM.DEFAULT_TITLE_Y_RATIO;
    let yOffset = height * (1 - titleYRatio);
    const titleText = items.some(i => CJK_REGEX.test(i.title)) ?
        '目录' :
        'Table of Contents';

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

    await this.drawTocItems(firstTocPage, items, 0, yOffset, renderContext);

    const tocPageCount = currentTocPageIndex.value;

    this.applyLinkAnnotations(
        doc, pendingAnnots, insertionStartIndex, tocPageCount);

    return {newDoc: doc, tocPageCount};
  }

  private async drawTocItems(
      currentPage: PDFPage, items: TocItem[], level: number, startY: number,
      ctx: TocRenderContext): Promise<{currentPage: PDFPage; yOffset: number}> {
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

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      const isFirstLevel = level === 0;
      const levelConfig = isFirstLevel ? config.firstLevel : config.otherLevels;
      const {fontSize, dotLeader, color, lineSpacing} = levelConfig;

      const parsedColor =
          rgb(parseInt(color.slice(1, 3), 16) / 255,
              parseInt(color.slice(3, 5), 16) / 255,
              parseInt(color.slice(5, 7), 16) / 255);

      const indentPerLevel = pageWidth * TOC_LAYOUT.ITEM.INDENT_PER_LEVEL_RATIO;
      const indentation = level * indentPerLevel;
      const lineHeight = fontSize * lineSpacing;
      const title = `${item.title}`.trim();

      const marginX = pageWidth * TOC_LAYOUT.PAGE.MARGIN_X_RATIO;
      const titleX = marginX + indentation;
      const rightPad = pageWidth * TOC_LAYOUT.ITEM.RIGHT_PAD_RATIO;
      const maxWidth = pageWidth - rightPad - indentation;
      const currentFont = isFirstLevel ? boldFont : regularFont;

      const lines = this.splitTextIntoLines(title, fontSize, currentFont, maxWidth);
      const totalHeadingHeight = lines.length * lineHeight;

      // 换页检查
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

      // 绘制标题每一行
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

      // 绘制页码
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

      // 绘制点线 (Dot Leader)
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

      // 记录链接区域
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

      // 递归渲染子项
      if (item.children?.length) {
        const childResult = await this.drawTocItems(
            currentWorkingPage, item.children, level + 1, yOffset, ctx);
        currentWorkingPage = childResult.currentPage;
        yOffset = childResult.yOffset;
      }
    }

    return {currentPage: currentWorkingPage, yOffset};
  }

  private splitTextIntoLines(
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

  private applyLinkAnnotations(
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

      const existingAnnots = pa.tocPage.node.get(PDFName.of('Annots'));
      if (existingAnnots) {
        existingAnnots.push(ref);
      } else {
        pa.tocPage.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
      }
    }
  }

  async renderPage(
      pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number = 1.0) {
    if (!pdf) return;
    const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
    if (!canvas) {
      return;
    }

    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({scale});

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const context = canvas.getContext('2d');
      if (!context) return;

      const renderTask = page.render({
            canvasContext: context,
            viewport,
      });

      await renderTask.promise.then(() => page.cleanup()).catch(() => page.cleanup());
    } catch (e) {
      console.error(`Error rendering page ${pageNum}:`, e);
    }
  }

  private static canvasRenderTasks = new WeakMap<HTMLCanvasElement, pdfjsLib.RenderTask>();

  async renderPageToCanvas(
      pdfDoc: pdfjsLib.PDFDocumentProxy, pageNumber: number,
    canvas: HTMLCanvasElement, width: number): Promise<pdfjsLib.RenderTask | undefined> {

    const existingTask = PDFService.canvasRenderTasks.get(canvas);
    if (existingTask) {
      try {
        existingTask.cancel();
        await existingTask.promise.catch(() => { });
      } catch (e) {
      }
      PDFService.canvasRenderTasks.delete(canvas);
    }

    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({scale: 1.0});
    const scale = width / viewport.width;
    const scaledViewport = page.getViewport({scale});

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      page.cleanup();
      return;
    }

    const renderTask = page.render({
      canvasContext: ctx,
      viewport: scaledViewport,
    });

    PDFService.canvasRenderTasks.set(canvas, renderTask);

    renderTask.promise.then(() => {
      PDFService.canvasRenderTasks.delete(canvas);
      page.cleanup();
    }).catch((e: any) => {
      PDFService.canvasRenderTasks.delete(canvas);
      page.cleanup();
      if (e?.name === 'RenderingCancelledException') {
        console.info(`Rendering cancelled, page ${ pageNumber }`);
      }
    });

    return renderTask;
  }


  async getPageAsImage(
      pdf: any, pageNum: number, targetScale: number = 1.5,
      maxDimension: number = 2048): Promise<string> {
    const page = await pdf.getPage(pageNum);

    let viewport = page.getViewport({scale: targetScale});

    const maxSide = Math.max(viewport.width, viewport.height);

    if (maxSide > maxDimension) {
      const adjustmentRatio = maxDimension / maxSide;
      const finalScale = targetScale * adjustmentRatio;

      viewport = page.getViewport({scale: finalScale});
      console.log(`Page ${pageNum} too large (${maxSide}px). Downscaling to ${
          finalScale.toFixed(2)}x`);
    }

    const canvas = document.createElement('canvas');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create 2D context');

    const renderTask = page.render({
          canvasContext: context,
          viewport,
    });

    await renderTask.promise.then(() => page.cleanup()).catch(() => page.cleanup());

    return canvas.toDataURL('image/jpeg', 0.9);
  }

  /**
   * Automatically detect potential TOC pages in the PDF.
   * Scans first 20 pages for keywords and patterns.
   */
  async detectTocPages(pdf: pdfjsLib.PDFDocumentProxy): Promise<number[]> {
    const maxScanPages = Math.min(20, pdf.numPages);
    const tocKeywords = ['contents', 'table of contents', '目录', '目次'];
    const detectedPages: number[] = [];

    for (let pageNum = 1;pageNum <= maxScanPages;pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => item.str)
        .join(' ')
        .toLowerCase();

      const hasKeyword = tocKeywords.some(keyword => text.includes(keyword));

      let patternMatches = 0;
      const lines = content.items.map((item: any) => item.str.trim()).filter(s => s.length > 0);

      for (const line of lines) {
        if (/.*\s+(\.{3,}|_{3,}|-{3,})\s*\d+$/.test(line) || /.*\s+\d+$/.test(line)) {
          patternMatches++;
        }
      }
      if (hasKeyword || patternMatches >= 5) {
        detectedPages.push(pageNum);
      }

      page.cleanup();
    }

    return detectedPages;
  }
}