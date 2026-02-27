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
  private STANDARD_RENDER_SCALE = 2.0;
  public cache = new Map<string, ImageBitmap | HTMLCanvasElement>();

  enqueue(
    id: string,
    pdfInstance: any,
    pageNum: number,
    priority: number = 1
  ): Promise<ImageBitmap | HTMLCanvasElement> {
    if (this.cache.has(id)) {
      return Promise.resolve(this.cache.get(id)!);
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
    if (this.cache.has(task.id)) {
      task.resolve(this.cache.get(task.id)!);
      this.processNext();
      return;
    }

    this.activeCount++;

    try {
      const page = await task.pdfInstance.getPage(task.pageNum);

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
      task.resolve(result);

      page.cleanup();
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
}

export const renderQueue = new RenderQueue();
