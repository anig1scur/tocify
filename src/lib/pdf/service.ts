import { browser } from '$app/environment';
import { PDFDocument } from 'pdf-lib';
import fontkit from 'pdf-fontkit';
import * as pdfjsLib from 'pdfjs-dist';
import { type TocConfig } from '../../stores';
import { A4_WIDTH, BASE_FONT_SIZE_L1, BASE_FONT_SIZE_OTHER } from '../constants';
import { isLegacyBrowser } from '$lib/utils';

export interface TocItem {
  id: string;
  title: string;
  to: number;
  children: TocItem[];
  open?: boolean;
  level?: number;
}

export interface PDFState {
  doc: PDFDocument | null;
  newDoc: PDFDocument | null;
  instance: pdfjsLib.PDFDocumentProxy | null;
  filename: string;
  currentPage: number;
  totalPages: number;
  scale: number;
}

if (typeof Promise.withResolvers === 'undefined') {
  // @ts-ignore
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (browser) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = isLegacyBrowser() ? '/pdf.worker.legacy.min.mjs' : '/pdf.worker.min.mjs';
}

export class PDFService {
  static sharedWorker: pdfjsLib.PDFWorker | null = browser ? new pdfjsLib.PDFWorker() : null;

  static regularFontBytes: Map<string, ArrayBuffer> = new Map();
  static boldFontBytes: Map<string, ArrayBuffer> = new Map();
  static fontLoadingPromises: Map<string, Promise<void>> = new Map();

  static FONT_URLS = {
    huiwen: {
      regular: '/fonts/huiwen-mincho.ttf',
      bold: '/fonts/huiwen-mincho.ttf',
    },
    hei: {
      regular: 'https://static.aeriszhu.com/SourceHanSansSC-Regular.woff2',
      bold: 'https://static.aeriszhu.com/SourceHanSansSC-Regular.woff2',
    },
    song: {
      regular: 'https://static.aeriszhu.com/SourceHanSerifSC-Regular.woff2',
      bold: 'https://static.aeriszhu.com/SourceHanSerifSC-Regular.woff2',
    }
  };

  static sanitizePdfMetadata(doc: PDFDocument) {
    try {
      doc.getCreationDate();
    } catch (e: any) {
      console.warn('Invalid CreationDate in PDF metadata, resetting to current date.');
      doc.setCreationDate(new Date());
    }

    try {
      doc.getModificationDate();
    } catch (e: any) {
      console.warn('Invalid ModificationDate in PDF metadata, resetting to current date.');
      doc.setModificationDate(new Date());
    }
  }

  private worker: Worker | null = null;
  private workerCallbacks: Map<string, { resolve: Function, reject: Function }> = new Map();
  private workerLoadedFonts: Set<string> = new Set();

  constructor () {
    if (browser && !PDFService.sharedWorker) {
      PDFService.sharedWorker = new pdfjsLib.PDFWorker();
    }
    // Initialize Worker
    if (browser) {
      this.initWorker();
    }
    this.loadFonts('huiwen');
  }

  private initWorker() {
    this.worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { type, id, payload, error } = e.data;
      if (this.workerCallbacks.has(id)) {
        const { resolve, reject } = this.workerCallbacks.get(id)!;
        if (type === 'ERROR') {
          reject(new Error(error));
        } else {
          resolve(payload);
        }
        this.workerCallbacks.delete(id);
      }
    };
  }

  private postWorkerMessage(type: string, payload: any, transfer: Transferable[] = []): Promise<any> {
    if (!this.worker) throw new Error('Worker not initialized');
    const id = Date.now().toString() + Math.random();
    const { promise, resolve, reject } = Promise.withResolvers();
    this.workerCallbacks.set(id, { resolve, reject });
    this.worker.postMessage({ type, id, payload }, transfer);
    return promise;
  }

  async loadFonts(family: string = 'huiwen') {
    if (!browser) return;

    if (!PDFService.regularFontBytes.has(family) || !PDFService.boldFontBytes.has(family)) {

      if (PDFService.fontLoadingPromises.has(family)) {
        await PDFService.fontLoadingPromises.get(family);
      } else {
        const promise = (async () => {
          try {
            const urls = PDFService.FONT_URLS[family as keyof typeof PDFService.FONT_URLS];
            if (!urls) {
              console.warn(`Unknown font family: ${ family }, falling back to huiwen`);
              await this.loadFonts('huiwen');
              return;
            }

            const uniqueUrls = new Set([urls.regular, urls.bold]);
            const urlToBuffer = new Map<string, ArrayBuffer>();

            await Promise.all(Array.from(uniqueUrls).map(async (url) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`Failed to load ${ url }`);
              const buffer = await res.arrayBuffer();
              urlToBuffer.set(url, buffer);
            }));

            const regular = urlToBuffer.get(urls.regular);
            const bold = urlToBuffer.get(urls.bold);

            if (regular && bold) {
              PDFService.regularFontBytes.set(family, regular);
              PDFService.boldFontBytes.set(family, bold);
            }
          } catch (e) {
            console.error(`Failed to load fonts for ${ family }`, e);
            throw e;
          } finally {
            PDFService.fontLoadingPromises.delete(family);
          }
        })();

        PDFService.fontLoadingPromises.set(family, promise);
        await promise;
      }
    }

    // 2. Ensure bytes are sent to Current Worker
    if (this.worker && !this.workerLoadedFonts.has(family)) {
      if (PDFService.regularFontBytes.has(family) && PDFService.boldFontBytes.has(family)) {
        const regular = PDFService.regularFontBytes.get(family)!;
        const bold = PDFService.boldFontBytes.get(family)!;

        await this.postWorkerMessage('LOAD_FONTS', {
          family,
          regular: regular.slice(0),
          bold: bold.slice(0)
        });
        this.workerLoadedFonts.add(family);
      }
    }
  }

  async initPreview(sourceDoc: PDFDocument) {
    if (!this.worker) return;
    const bytes = await sourceDoc.save();
    await this.postWorkerMessage('INIT', { pdfBytes: bytes });
    await this.loadFonts('huiwen');
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
    items: TocItem[], config: TocConfig, previewOnly = false, pageSize?: { width: number; height: number }):
    Promise<{ newDoc: PDFDocument | null; tocPageCount: number; tocBytes: Uint8Array }> {

    const fontKey = config.fontFamily || 'huiwen';
    await this.loadFonts(fontKey);

    const result = await this.postWorkerMessage('GENERATE', { items, config, previewOnly, pageSize });
    const { pdfBytes, tocPageCount, tocBytes } = result;

    let newDoc = null;
    if (pdfBytes) {
      newDoc = await PDFDocument.load(pdfBytes);
      newDoc.registerFontkit(fontkit);
    }

    return { newDoc, tocPageCount, tocBytes };
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
      const viewport = page.getViewport({ scale });

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;

      const renderTask = page.render({
        canvasContext: context,
        viewport,
      });

      await renderTask.promise.then(() => page.cleanup()).catch(() => page.cleanup());
    } catch (e: any) {
      console.error(`Error rendering page ${ pageNum }:`, e);
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
      } catch (e: any) {
      }
      PDFService.canvasRenderTasks.delete(canvas);
    }

    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = width / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    const ctx = canvas.getContext('2d', { alpha: false });
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

    let viewport = page.getViewport({ scale: targetScale });

    const maxSide = Math.max(viewport.width, viewport.height);

    if (maxSide > maxDimension) {
      const adjustmentRatio = maxDimension / maxSide;
      const finalScale = targetScale * adjustmentRatio;

      viewport = page.getViewport({ scale: finalScale });
      console.log(`Page ${ pageNum } too large (${ maxSide }px). Downscaling to ${ finalScale.toFixed(2) }x`);
    }

    const canvas = document.createElement('canvas');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const context = canvas.getContext('2d', { alpha: false });
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
   * Delegates to worker which scans first 20 pages.
   */
  async detectTocPages(): Promise<number[]> {
    if (!this.worker) return [];
    try {
      const detected = await this.postWorkerMessage('DETECT_TOC', {});
      return detected as number[];
    } catch (e) {
      console.warn('Worker detection failed, returning empty:', e);
      return [];
    }
  }
}