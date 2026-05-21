export type RenderTask = {
  id: string;
  pdfInstance: any;
  pageNum: number;
  priority: number;
  resolve: (bitmap: ImageBitmap | HTMLCanvasElement) => void;
  reject: (err: any) => void;
};

export class RenderQueue {
  private queue: RenderTask[] = [];
  private activeCount = 0;
  private maxConcurrency = 6;
  private STANDARD_RENDER_SCALE = 1.5;
  private maxCacheItems = 80;
  private cache = new Map<string, ImageBitmap | HTMLCanvasElement>();

  getCached(id: string): ImageBitmap | HTMLCanvasElement | undefined {
    const cached = this.cache.get(id);
    if (!cached) return undefined;

    this.cache.delete(id);
    this.cache.set(id, cached);
    return cached;
  }

  enqueue(
    id: string,
    pdfInstance: any,
    pageNum: number,
    priority: number = 1
  ): Promise<ImageBitmap | HTMLCanvasElement> {
    const cached = this.getCached(id);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve, reject) => {
      const existing = this.queue.find((t) => t.id === id);
      if (existing) {
        if (priority < existing.priority) {
          existing.priority = priority;
          this.queue.sort((a, b) => a.priority - b.priority);
        }

        const oldResolve = existing.resolve;
        const oldReject = existing.reject;
        existing.resolve = (bmp) => {
          oldResolve(bmp);
          resolve(bmp);
        };
        existing.reject = (err) => {
          oldReject(err);
          reject(err);
        };
        return;
      }

      this.queue.push({ id, pdfInstance, pageNum, priority, resolve, reject });
      this.queue.sort((a, b) => a.priority - b.priority);

      this.processNext();
    });
  }

  private async processNext() {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.processTask(task);
    }
  }

  private async processTask(task: RenderTask) {
    const cached = this.getCached(task.id);
    if (cached) {
      task.resolve(cached);
      this.processNext();
      return;
    }

    this.activeCount++;

    try {
      const page = await task.pdfInstance.getPage(task.pageNum);

      try {
        const viewport = page.getViewport({ scale: this.STANDARD_RENDER_SCALE });

        let canvas: HTMLCanvasElement | OffscreenCanvas;
        if (typeof OffscreenCanvas !== 'undefined') {
          canvas = new OffscreenCanvas(viewport.width, viewport.height);
        } else {
          canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
        }

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Could not create canvas context');

        await page.render({
          canvasContext: ctx,
          viewport: viewport,
        }).promise;

        let result: ImageBitmap | HTMLCanvasElement;
        if (typeof createImageBitmap !== 'undefined') {
          result = await createImageBitmap(canvas);
        } else {
          result = canvas as HTMLCanvasElement;
        }

        this.cache.set(task.id, result);
        this.trimCache();
        task.resolve(result);
      } finally {
        page.cleanup();
      }
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') {
        console.error(`RenderQueue Error (Page ${ task.pageNum }):`, e);
      }
      task.reject(e);
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  clear() {
    this.queue = [];
    for (const [_, value] of this.cache.entries()) {
      if ('close' in value) {
        (value as ImageBitmap).close();
      }
    }
    this.cache.clear();
  }

  private trimCache() {
    while (this.cache.size > this.maxCacheItems) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) return;

      const oldest = this.cache.get(oldestKey);
      if (oldest && 'close' in oldest) {
        (oldest as ImageBitmap).close();
      }
      this.cache.delete(oldestKey);
    }
  }
}

export const renderQueue = new RenderQueue();
