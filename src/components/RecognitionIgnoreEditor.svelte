<script lang="ts">
  import {createEventDispatcher, onDestroy, tick} from 'svelte';
  import {fade, fly} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {Copy, Eraser, Trash2, X, RotateCcw} from 'lucide-svelte';
  import type {RecognitionIgnoreRegion} from '$lib/pdf/recognition-ignore';
  import {normalizeRegion} from '$lib/pdf/recognition-ignore';

  export let pdfInstance: any = null;
  export let tocRanges: {start: number; end: number; id: string}[] = [];
  export let tocSelectionPageNumbers: number[] = [];
  export let ignoreRegions: RecognitionIgnoreRegion[] = [];
  export let totalPages = 0;

  const dispatch = createEventDispatcher();

  let isOpen = false;
  let currentPage = 1;
  let canvasElement: HTMLCanvasElement;
  let canvasWrap: HTMLDivElement;
  let canvasWrapWidth = 0;
  let canvasWrapHeight = 0;
  let sourceCanvas: HTMLCanvasElement | null = null;
  let renderToken = 0;
  let focusedRegionId = '';
  let lastThumbPdfInstance: any = null;
  let thumbCacheGeneration = 0;
  const thumbCanvases = new Set<HTMLCanvasElement>();
  const thumbCache = new Map<number, ImageBitmap | HTMLCanvasElement>();
  const thumbRenderPromises = new Map<number, Promise<void>>();

  let isDrawing = false;
  let draft: {startX: number; startY: number; endX: number; endY: number} | null = null;

  function closeThumbCache() {
    thumbCacheGeneration++;
    for (const value of thumbCache.values()) {
      if ('close' in value) {
        value.close();
      }
    }
    thumbCache.clear();
    thumbRenderPromises.clear();
  }

  onDestroy(() => {
    closeThumbCache();
    thumbCanvases.clear();
  });

  $: if (pdfInstance !== lastThumbPdfInstance) {
    lastThumbPdfInstance = pdfInstance;
    closeThumbCache();
  }

  function getSelectedPageNumbers() {
    const pages = new Set<number>();
    const maxRangePage = Math.max(0, ...tocRanges.flatMap((range) => [Number(range.start) || 0, Number(range.end) || 0]));
    const maxPage = Math.max(totalPages || 0, Number(pdfInstance?.numPages) || 0, maxRangePage);

    for (const range of tocRanges) {
      const rawStart = Number(range.start) || 1;
      const rawEnd = Number(range.end) || rawStart;
      const start = Math.max(1, Math.min(maxPage || rawStart, Math.min(rawStart, rawEnd)));
      const end = Math.max(start, Math.min(maxPage || rawEnd, Math.max(rawStart, rawEnd)));

      for (let page = start; page <= end; page++) {
        pages.add(page);
      }
    }
    return [...pages].sort((a, b) => a - b);
  }

  $: selectedPageNumbers = tocSelectionPageNumbers.length > 0 ? tocSelectionPageNumbers : getSelectedPageNumbers();
  $: currentPageRegions = ignoreRegions.filter((region) => region.pageNum === currentPage);
  $: selectedPageRegionCount = ignoreRegions.filter((region) => selectedPageNumbers.includes(region.pageNum)).length;
  $: if (selectedPageNumbers.length > 0 && !selectedPageNumbers.includes(currentPage)) {
    currentPage = selectedPageNumbers[0];
  }
  $: if (isOpen && pdfInstance && currentPage && canvasWrapWidth && canvasWrapHeight) {
    renderPage();
  }
  $: if (isOpen && sourceCanvas) {
    currentPageRegions;
    focusedRegionId;
    redrawCanvas();
  }

  export async function openEditor(pageNum?: number) {
    if (pageNum && selectedPageNumbers.includes(pageNum)) {
      currentPage = pageNum;
    } else if (selectedPageNumbers.length > 0) {
      currentPage = selectedPageNumbers[0];
    }
    isOpen = true;
    await tick();
    renderPage();
  }

  function updateRegions(nextRegions: RecognitionIgnoreRegion[]) {
    dispatch('change', nextRegions.map(normalizeRegion).filter((region) => region.width > 0 && region.height > 0));
  }

  async function renderPage() {
    if (!isOpen || !pdfInstance || !canvasElement || !canvasWrap || !canvasWrapWidth || !canvasWrapHeight) return;

    const token = ++renderToken;
    const page = await pdfInstance.getPage(currentPage);
    const baseViewport = page.getViewport({scale: 1});
    const maxCssWidth = Math.max(240, Math.min(canvasWrapWidth, 560));
    const maxCssHeight = Math.max(240, canvasWrapHeight);
    const cssScale = Math.min(maxCssWidth / baseViewport.width, maxCssHeight / baseViewport.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({scale: cssScale * dpr});

    const nextSourceCanvas = document.createElement('canvas');
    nextSourceCanvas.width = Math.floor(viewport.width);
    nextSourceCanvas.height = Math.floor(viewport.height);

    const sourceCtx = nextSourceCanvas.getContext('2d', {alpha: false});
    if (!sourceCtx) {
      page.cleanup();
      return;
    }

    await page.render({
      canvasContext: sourceCtx,
      viewport,
    }).promise.then(() => page.cleanup()).catch(() => page.cleanup());

    if (token !== renderToken) return;

    sourceCanvas = nextSourceCanvas;
    canvasElement.width = nextSourceCanvas.width;
    canvasElement.height = nextSourceCanvas.height;
    canvasElement.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvasElement.style.height = `${Math.floor(viewport.height / dpr)}px`;
    redrawCanvas();
  }

  function drawRegion(ctx: CanvasRenderingContext2D, region: RecognitionIgnoreRegion, withStroke = false) {
    const x = region.x * canvasElement.width;
    const y = region.y * canvasElement.height;
    const width = region.width * canvasElement.width;
    const height = region.height * canvasElement.height;

    ctx.fillStyle = region.fill === 'black' ? '#000000' : '#ffffff';
    ctx.fillRect(x, y, width, height);

    if (withStroke) {
      const isFocused = region.id === focusedRegionId;
      ctx.strokeStyle = isFocused ? '#2563eb' : '#64748b';
      ctx.lineWidth = isFocused ? 5 : 3;
      ctx.strokeRect(x, y, width, height);
    }
  }

  function getDraftRegion(): RecognitionIgnoreRegion | null {
    if (!draft || !canvasElement) return null;

    const x = Math.min(draft.startX, draft.endX);
    const y = Math.min(draft.startY, draft.endY);
    const width = Math.abs(draft.endX - draft.startX);
    const height = Math.abs(draft.endY - draft.startY);

    if (width < 4 || height < 4) return null;

    return normalizeRegion({
      id: 'draft',
      pageNum: currentPage,
      x: x / canvasElement.width,
      y: y / canvasElement.height,
      width: width / canvasElement.width,
      height: height / canvasElement.height,
      fill: 'white',
    });
  }

  function redrawCanvas() {
    if (!sourceCanvas || !canvasElement) return;

    const ctx = canvasElement.getContext('2d', {alpha: false});
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    for (const region of currentPageRegions) {
      drawRegion(ctx, region, true);
    }

    const draftRegion = getDraftRegion();
    if (draftRegion) {
      drawRegion(ctx, draftRegion, true);
    }
  }

  function getCanvasPoint(e: PointerEvent) {
    const rect = canvasElement.getBoundingClientRect();
    const scaleX = canvasElement.width / rect.width;
    const scaleY = canvasElement.height / rect.height;

    return {
      x: Math.max(0, Math.min(canvasElement.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvasElement.height, (e.clientY - rect.top) * scaleY)),
    };
  }

  function handlePointerDown(e: PointerEvent) {
    if (!sourceCanvas || !canvasElement) return;
    const point = getCanvasPoint(e);
    isDrawing = true;
    draft = {startX: point.x, startY: point.y, endX: point.x, endY: point.y};
    canvasElement.setPointerCapture(e.pointerId);
    redrawCanvas();
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDrawing || !draft) return;

    const point = getCanvasPoint(e);
    draft = {...draft, endX: point.x, endY: point.y};
    redrawCanvas();
  }

  function finishDrawing(e: PointerEvent) {
    if (!isDrawing) return;

    if (canvasElement?.hasPointerCapture(e.pointerId)) {
      canvasElement.releasePointerCapture(e.pointerId);
    }

    const nextRegion = getDraftRegion();
    isDrawing = false;
    draft = null;

    if (!nextRegion) {
      redrawCanvas();
      return;
    }

    const createdRegions = [{
      ...nextRegion,
      id: `recognition-mask-${Date.now()}-${currentPage}-${Math.random().toString(36).slice(2, 8)}`,
      fill: 'white' as const,
    }];

    focusedRegionId = createdRegions.find((region) => region.pageNum === currentPage)?.id || '';
    updateRegions([...ignoreRegions, ...createdRegions]);
  }

  function deleteRegion(id: string) {
    if (focusedRegionId === id) focusedRegionId = '';
    updateRegions(ignoreRegions.filter((region) => region.id !== id));
  }

  function clearCurrentPage() {
    focusedRegionId = '';
    updateRegions(ignoreRegions.filter((region) => region.pageNum !== currentPage));
  }

  function applyCurrentAreasToAllPages() {
    const sourceRegions = currentPageRegions;

    if (selectedPageNumbers.length === 0) return;

    const selectedPageSet = new Set(selectedPageNumbers);
    const nextRegions = ignoreRegions.filter((region) => {
      if (region.pageNum === currentPage) return true;
      return !selectedPageSet.has(region.pageNum);
    });

    const copiedRegions = selectedPageNumbers.flatMap((pageNum) => {
      if (pageNum === currentPage) return [];

      return sourceRegions.map((region) => ({
        ...region,
        id: `recognition-mask-${Date.now()}-${pageNum}-${Math.random().toString(36).slice(2, 8)}`,
        pageNum,
      }));
    });

    updateRegions([...nextRegions, ...copiedRegions]);
  }

  function focusRegion(region: RecognitionIgnoreRegion) {
    focusedRegionId = region.id;
    currentPage = region.pageNum;

    tick().then(() => {
      redrawCanvas();
    });
  }

  function drawThumbIgnoreRegions(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, pageNum: number) {
    const pageRegions = ignoreRegions.filter((region) => region.pageNum === pageNum);
    if (pageRegions.length === 0) return;

    for (const region of pageRegions) {
      ctx.fillStyle = region.fill === 'black' ? '#000000' : '#ffffff';
      ctx.fillRect(
        Math.floor(region.x * canvas.width),
        Math.floor(region.y * canvas.height),
        Math.ceil(region.width * canvas.width),
        Math.ceil(region.height * canvas.height),
      );
    }
  }

  async function renderPageThumb(canvas: HTMLCanvasElement, pageNum: number) {
    if (!pdfInstance) return;

    canvas.dataset.thumbPageNum = String(pageNum);

    const cached = thumbCache.get(pageNum);
    if (cached) {
      repaintPageThumb(canvas, pageNum);
      return;
    }

    const existingRender = thumbRenderPromises.get(pageNum);
    if (existingRender) {
      await existingRender;
      repaintPageThumb(canvas, pageNum);
      return;
    }

    const renderPromise = renderThumbBase(pageNum);
    thumbRenderPromises.set(pageNum, renderPromise);
    await renderPromise;
    thumbRenderPromises.delete(pageNum);
    repaintPageThumb(canvas, pageNum);
  }

  async function renderThumbBase(pageNum: number) {
    if (!pdfInstance) return;

    const renderPdfInstance = pdfInstance;
    const renderGeneration = thumbCacheGeneration;

    try {
      const page = await renderPdfInstance.getPage(pageNum);
      try {
        const baseViewport = page.getViewport({scale: 1});
        const cssWidth = 88;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({scale: (cssWidth / baseViewport.width) * dpr});
        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = Math.floor(viewport.width);
        baseCanvas.height = Math.floor(viewport.height);

        const ctx = baseCanvas.getContext('2d', {alpha: false});
        if (!ctx) return;

        await page.render({canvasContext: ctx, viewport}).promise;

        const renderedThumb = typeof createImageBitmap !== 'undefined'
          ? await createImageBitmap(baseCanvas)
          : baseCanvas;

        if (renderPdfInstance === pdfInstance && renderGeneration === thumbCacheGeneration) {
          thumbCache.set(pageNum, renderedThumb);
        } else if ('close' in renderedThumb) {
          renderedThumb.close();
        }
      } finally {
        page.cleanup();
      }
    } catch (e) {
      // Thumbnail failures should not block the editor.
    }
  }

  $: if (isOpen && pdfInstance) {
    ignoreRegions;
    for (const thumb of thumbCanvases) {
      repaintPageThumb(thumb, parseInt(thumb.dataset.thumbPageNum || '0', 10));
    }
  }

  function repaintPageThumb(canvas: HTMLCanvasElement, pageNum: number) {
    const base = thumbCache.get(pageNum);
    if (!base) return;

    const ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) return;

    canvas.width = base.width;
    canvas.height = base.height;
    canvas.style.width = '88px';
    canvas.style.height = 'auto';
    canvas.dataset.thumbPageNum = String(pageNum);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    drawThumbIgnoreRegions(ctx, canvas, pageNum);
  }

  function pageThumb(node: HTMLCanvasElement, pageNum: number) {
    thumbCanvases.add(node);
    renderPageThumb(node, pageNum);

    return {
      update(nextPageNum: number) {
        renderPageThumb(node, nextPageNum);
      },
      destroy() {
        thumbCanvases.delete(node);
      },
    };
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-50 p-4"
    transition:fade={{duration: 150}}
    on:click|self={() => (isOpen = false)}
    role="presentation"
  >
    <div
      class="bg-white rounded-lg p-5 md:p-6 w-[90%] md:w-[80%] max-w-5xl h-[90vh] max-h-[90vh] overflow-hidden border-2 border-gray-300 flex flex-col"
      transition:fly={{y: 20, duration: 200}}
      role="dialog"
      aria-modal="true"
      aria-label={$t('recognition_ignore.title')}
    >
      <div class="flex justify-between items-start gap-4 mb-4">
        <div class="min-w-0">
          <h2 class="truncate text-xl md:text-2xl font-bold">{$t('recognition_ignore.instruction')}</h2>
        </div>
        <button
          on:click={() => (isOpen = false)}
          class="p-1 rounded-full text-black hover:bg-gray-100 transition-colors"
          title={$t('recognition_ignore.close')}
          aria-label={$t('recognition_ignore.close')}
        >
          <X size={24} />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden rounded-lg border-2 border-black">
        <div class="grid h-full md:grid-cols-[136px_minmax(0,1fr)_260px] gap-0 min-h-0">
          <aside class="min-h-0 overflow-auto border-b md:border-b-0 md:border-r border-black/10 bg-white p-2">
            <div class="flex flex-col gap-2">
              {#each selectedPageNumbers as page}
                <button
                  class="rounded-md border p-1.5 text-center transition-colors {page === currentPage ? 'border-black bg-yellow-100/70' : 'border-transparent bg-white hover:bg-gray-100'}"
                  on:click={() => {
                    currentPage = page;
                    focusedRegionId = '';
                  }}
                >
                  <canvas
                    class="mx-auto block rounded bg-white shadow-sm"
                    use:pageThumb={page}
                  ></canvas>
                  <div class="mt-1 text-center text-xs text-gray-600">
                    {$t('offset.page_n', {values: {n: page}})}
                  </div>
                </button>
              {/each}
            </div>
          </aside>

          <div class="min-h-0 overflow-hidden bg-gray-50 p-3 md:p-4">
            <div
              class="w-full h-full flex items-center justify-center"
              bind:this={canvasWrap}
              bind:clientWidth={canvasWrapWidth}
              bind:clientHeight={canvasWrapHeight}
            >
              <canvas
                bind:this={canvasElement}
                class="max-w-full bg-white border-2 border-black cursor-crosshair touch-none"
                on:pointerdown={handlePointerDown}
                on:pointermove={handlePointerMove}
                on:pointerup={finishDrawing}
                on:pointercancel={finishDrawing}
              ></canvas>
            </div>
          </div>

          <aside class="border-t md:border-t-0 md:border-l border-black/10 bg-white flex min-h-0 flex-col">
            <div class="min-h-0 flex-1 overflow-auto p-3">
              <div class="flex items-center justify-between gap-2 mb-3">
                <h3 class="font-bold text-sm">{$t('recognition_ignore.current_page_regions')}</h3>
                <button
                  on:click={clearCurrentPage}
                  class="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"
                  title={$t('recognition_ignore.clear_page')}
                  disabled={currentPageRegions.length === 0}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              {#if selectedPageNumbers.length > 1 && selectedPageRegionCount > 0}
                <button
                  class="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-black bg-yellow-300 px-2 py-2 text-sm font-bold text-black shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px]"
                  on:click={applyCurrentAreasToAllPages}
                >
                  <Copy size={15} />
                  {$t('recognition_ignore.apply_all_pages')}
                </button>
              {/if}

              {#if currentPageRegions.length === 0}
                <div class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-3 py-8 text-center">
                  <div class="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-400">
                    <Eraser size={18} />
                  </div>
                  <p class="mt-1 text-xs text-gray-500">{$t('recognition_ignore.empty_hint')}</p>
                </div>
              {:else}
                <div class="flex flex-col gap-2">
                  {#each currentPageRegions as region, index (region.id)}
                    <div
                      class="flex items-center justify-between gap-2 border rounded p-2 text-left transition-colors {focusedRegionId === region.id ? 'border-black bg-yellow-100/70' : 'border-gray-200 bg-white hover:bg-gray-100'}"
                      on:click={() => focusRegion(region)}
                      on:keydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          focusRegion(region);
                        }
                      }}
                      role="button"
                      tabindex="0"
                    >
                      <div class="min-w-0">
                        <div class="text-sm font-bold">
                          {$t('recognition_ignore.region_n', {values: {n: index + 1}})}
                        </div>
                      </div>
                      <button
                        on:click|stopPropagation={() => deleteRegion(region.id)}
                        class="p-1.5 rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                        title={$t('settings.remove')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </aside>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row gap-3 justify-end mt-5">
        <button
          type="button"
          class="inline-flex items-center justify-center px-4 py-2 font-bold bg-green-500 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
          on:click={() => (isOpen = false)}
        >
          {$t('recognition_ignore.done')}
        </button>
      </div>
    </div>
  </div>
{/if}
