import type {PDFDocumentProxy, RenderTask as PdfRenderTask} from 'pdfjs-dist';

export type PageBitmap = ImageBitmap | HTMLCanvasElement;
export type RenderOptions = {scale?: number; signal?: AbortSignal};

type Subscriber = {
  resolve: (bitmap: PageBitmap) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type RenderJob = {
  key: string;
  pdfInstance: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  priority: number;
  generation: number;
  cancelled: boolean;
  renderTask?: PdfRenderTask;
  subscribers: Set<Subscriber>;
};

export function isRenderCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'RenderingCancelledException');
}

export class RenderQueue {
  private queue: RenderJob[] = [];
  private pending = new Map<string, RenderJob>();
  private activeCount = 0;
  private maxConcurrency = 3;
  private maxCacheBytes = 64 * 1024 * 1024;
  private maxPagePixels = 8 * 1024 * 1024;
  private cacheBytes = 0;
  private generation = 0;
  private documentIds = new WeakMap<object, number>();
  private nextDocumentId = 1;
  private cache = new Map<string, PageBitmap>();

  private getDocumentId(pdfInstance: PDFDocumentProxy): number {
    let id = this.documentIds.get(pdfInstance);
    if (!id) {
      id = this.nextDocumentId++;
      this.documentIds.set(pdfInstance, id);
    }
    return id;
  }

  private normalizeScale(scale = 1.5): number {
    return Math.max(0.05, Math.round((Number.isFinite(scale) ? scale : 1.5) * 1000) / 1000);
  }

  getCacheKey(id: string, pdfInstance: PDFDocumentProxy, scale = 1.5): string {
    return `${this.getDocumentId(pdfInstance)}:${id}:${this.normalizeScale(scale)}`;
  }

  getCached(id: string, pdfInstance: PDFDocumentProxy, scale = 1.5): PageBitmap | undefined {
    const key = this.getCacheKey(id, pdfInstance, scale);
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached;
  }

  enqueue(
    id: string,
    pdfInstance: PDFDocumentProxy,
    pageNum: number,
    priority = 1,
    {scale = 1.5, signal}: RenderOptions = {},
  ): Promise<PageBitmap> {
    if (signal?.aborted) return Promise.reject(this.cancelledError());
    const cached = this.getCached(id, pdfInstance, scale);
    if (cached) return Promise.resolve(cached);

    const key = this.getCacheKey(id, pdfInstance, scale);
    let job = this.pending.get(key);
    if (!job) {
      job = {key, pdfInstance, pageNum, scale: this.normalizeScale(scale), priority, generation: this.generation, cancelled: false, subscribers: new Set()};
      this.pending.set(key, job);
      this.queue.push(job);
    } else {
      job.priority = Math.min(job.priority, priority);
    }
    const requestedJob = job;

    const promise = new Promise<PageBitmap>((resolve, reject) => {
      const subscriber: Subscriber = {resolve, reject, signal};
      subscriber.onAbort = () => {
        this.detachSubscriber(requestedJob, subscriber);
        reject(this.cancelledError());
        if (!requestedJob.subscribers.size) this.cancelJob(requestedJob);
      };
      requestedJob.subscribers.add(subscriber);
      signal?.addEventListener('abort', subscriber.onAbort, {once: true});
    });
    this.queue.sort((a, b) => a.priority - b.priority);
    this.processNext();
    return promise;
  }

  private cancelledError(): DOMException {
    return new DOMException('PDF render cancelled', 'AbortError');
  }

  private detachSubscriber(job: RenderJob, subscriber: Subscriber) {
    if (subscriber.onAbort) subscriber.signal?.removeEventListener('abort', subscriber.onAbort);
    job.subscribers.delete(subscriber);
  }

  private settleJob(job: RenderJob, bitmap?: PageBitmap, error?: unknown) {
    for (const subscriber of [...job.subscribers]) {
      this.detachSubscriber(job, subscriber);
      if (bitmap) subscriber.resolve(bitmap);
      else subscriber.reject(error);
    }
  }

  private cancelJob(job: RenderJob) {
    job.cancelled = true;
    this.queue = this.queue.filter((entry) => entry !== job);
    if (this.pending.get(job.key) === job) this.pending.delete(job.key);
    job.renderTask?.cancel();
    this.settleJob(job, undefined, this.cancelledError());
  }

  private processNext() {
    while (this.activeCount < this.maxConcurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.activeCount++;
      void this.processJob(job);
    }
  }

  private async processJob(job: RenderJob) {
    let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
    let bitmap: PageBitmap | undefined;
    try {
      const page = await job.pdfInstance.getPage(job.pageNum);
      try {
        if (job.cancelled || job.generation !== this.generation) throw this.cancelledError();
        let viewport = page.getViewport({scale: job.scale});
        if (viewport.width * viewport.height > this.maxPagePixels) {
          viewport = page.getViewport({scale: job.scale * Math.sqrt(this.maxPagePixels / (viewport.width * viewport.height))});
        }
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
          canvas = new OffscreenCanvas(width, height);
        } else {
          canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext('2d', {alpha: false});
        if (!context) throw new Error('Could not create canvas context');
        job.renderTask = page.render({canvasContext: context as CanvasRenderingContext2D, viewport});
        await job.renderTask.promise;
        if (job.cancelled || job.generation !== this.generation) throw this.cancelledError();
        bitmap = typeof createImageBitmap !== 'undefined' ? await createImageBitmap(canvas) : canvas as HTMLCanvasElement;
        if (job.cancelled || job.generation !== this.generation) throw this.cancelledError();
        this.cache.set(job.key, bitmap);
        this.cacheBytes += bitmap.width * bitmap.height * 4;
        this.trimCache();
        this.settleJob(job, bitmap);
      } finally {
        page.cleanup();
      }
    } catch (error) {
      if (bitmap) this.disposeBitmap(bitmap);
      this.settleJob(job, undefined, error);
    } finally {
      if (canvas && canvas !== bitmap) {
        canvas.width = 1;
        canvas.height = 1;
      }
      if (this.pending.get(job.key) === job) this.pending.delete(job.key);
      this.activeCount--;
      this.processNext();
    }
  }

  clearDocument(pdfInstance: PDFDocumentProxy) {
    for (const job of [...this.pending.values()]) {
      if (job.pdfInstance === pdfInstance) this.cancelJob(job);
    }
    const prefix = `${this.getDocumentId(pdfInstance)}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.removeCached(key);
    }
    this.processNext();
  }

  clear() {
    this.generation++;
    for (const job of [...this.pending.values()]) this.cancelJob(job);
    for (const key of [...this.cache.keys()]) this.removeCached(key);
  }

  private disposeBitmap(bitmap: PageBitmap) {
    if ('close' in bitmap) bitmap.close();
    else {
      bitmap.width = 1;
      bitmap.height = 1;
    }
  }

  private removeCached(key: string, deferRelease = false) {
    const bitmap = this.cache.get(key);
    if (!bitmap) return;
    this.cacheBytes -= bitmap.width * bitmap.height * 4;
    this.cache.delete(key);
    // Let subscribers draw a just-resolved bitmap before another job evicts it.
    if (deferRelease) setTimeout(() => this.disposeBitmap(bitmap), 0);
    else this.disposeBitmap(bitmap);
  }

  private trimCache() {
    while (this.cacheBytes > this.maxCacheBytes && this.cache.size > 1) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.removeCached(oldestKey, true);
    }
  }
}

export const renderQueue = new RenderQueue();
