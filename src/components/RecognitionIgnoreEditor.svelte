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
  let hoveredRegionId = '';
  let lastThumbPdfInstance: any = null;
  let thumbCacheGeneration = 0;
  const thumbCanvases = new Set<HTMLCanvasElement>();
  const thumbCache = new Map<number, ImageBitmap | HTMLCanvasElement>();
  const thumbRenderPromises = new Map<number, Promise<void>>();

  type RegionInteraction = {
    pointerId: number;
    mode: 'move' | 'resize';
    region: RecognitionIgnoreRegion;
    startX: number;
    startY: number;
  } | {pointerId: number; mode: 'draw'};
  let interaction: RegionInteraction | null = null;
  let editedRegion: RecognitionIgnoreRegion | null = null;
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
    renderToken++;
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
  $: allPageNumbers = Array.from({length: Number(pdfInstance?.numPages) || totalPages || 0}, (_, index) => index + 1);
  $: currentPageRegions = ignoreRegions.filter((region) => region.pageNum === currentPage);
  $: displayedRegions = currentPageRegions.map((region) => editedRegion && editedRegion.id === region.id ? editedRegion : region);
  $: activeRegionId = hoveredRegionId || focusedRegionId;
  $: if (allPageNumbers.length > 0 && !allPageNumbers.includes(currentPage)) {
    currentPage = allPageNumbers[0];
  }
  $: if (isOpen && pdfInstance && currentPage && canvasWrapWidth && canvasWrapHeight) {
    renderPage();
  }
  $: if (isOpen && sourceCanvas) {
    displayedRegions;
    draft;
    redrawCanvas();
  }

  export async function openEditor(pageNum?: number) {
    resetInteraction();
    sourceCanvas = null;
    renderToken++;
    hoveredRegionId = '';
    if (pageNum && allPageNumbers.includes(pageNum)) {
      currentPage = pageNum;
    } else {
      currentPage = selectedPageNumbers.find((page) => allPageNumbers.includes(page)) || allPageNumbers[0] || 1;
    }
    isOpen = true;
    await tick();
    canvasWrap?.closest('[role="dialog"]')?.querySelector('[aria-current="page"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
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
    const maxCssWidth = Math.min(canvasWrapWidth, 560);
    const maxCssHeight = canvasWrapHeight;
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
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 * canvasElement.width / canvasElement.getBoundingClientRect().width;
      ctx.strokeRect(x, y, width, height);
    }
  }

  function getDraftRegion(): RecognitionIgnoreRegion | null {
    if (!draft || !canvasElement) return null;

    const x = Math.min(draft.startX, draft.endX);
    const y = Math.min(draft.startY, draft.endY);
    const width = Math.abs(draft.endX - draft.startX);
    const height = Math.abs(draft.endY - draft.startY);

    const rect = canvasElement.getBoundingClientRect();
    if (width * rect.width < 4 || height * rect.height < 4) return null;

    return normalizeRegion({
      id: 'draft',
      pageNum: currentPage,
      x,
      y,
      width,
      height,
      fill: 'white',
    });
  }

  function redrawCanvas() {
    if (!sourceCanvas || !canvasElement) return;

    const ctx = canvasElement.getContext('2d', {alpha: false});
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    for (const region of displayedRegions) {
      drawRegion(ctx, region);
    }

    const draftRegion = getDraftRegion();
    if (draftRegion) {
      drawRegion(ctx, draftRegion, true);
    }
  }

  function getCanvasPoint(e: PointerEvent, clampToPage = true) {
    const rect = canvasElement.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    return {
      x: clampToPage ? Math.max(0, Math.min(1, x)) : x,
      y: clampToPage ? Math.max(0, Math.min(1, y)) : y,
    };
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0 || interaction || !sourceCanvas || !canvasElement) return;
    e.preventDefault();
    const point = getCanvasPoint(e);
    interaction = {pointerId: e.pointerId, mode: 'draw'};
    focusedRegionId = '';
    hoveredRegionId = '';
    draft = {startX: point.x, startY: point.y, endX: point.x, endY: point.y};
    canvasWrap.setPointerCapture(e.pointerId);
  }

  function startRegionInteraction(e: PointerEvent, region: RecognitionIgnoreRegion, mode: 'move' | 'resize') {
    if (e.button !== 0 || interaction || !sourceCanvas) return;
    e.preventDefault();
    const point = getCanvasPoint(e, false);
    focusedRegionId = region.id;
    hoveredRegionId = '';
    editedRegion = {...region};
    interaction = {pointerId: e.pointerId, mode, region: {...region}, startX: point.x, startY: point.y};
    canvasWrap.setPointerCapture(e.pointerId);
  }

  function resizeRegion(region: RecognitionIgnoreRegion, deltaX: number, deltaY: number) {
    const rect = canvasElement.getBoundingClientRect();
    const minWidth = Math.min(region.width, 12 / rect.width);
    const minHeight = Math.min(region.height, 12 / rect.height);
    const right = Math.max(region.x + minWidth, Math.min(1, region.x + region.width + deltaX));
    const bottom = Math.max(region.y + minHeight, Math.min(1, region.y + region.height + deltaY));
    return {...region, width: right - region.x, height: bottom - region.y};
  }

  function handlePointerMove(e: PointerEvent) {
    if (!interaction || e.pointerId !== interaction.pointerId) return;
    if (interaction.mode === 'draw') {
      if (!draft) return;
      const point = getCanvasPoint(e);
      draft = {...draft, endX: point.x, endY: point.y};
      return;
    }

    const point = getCanvasPoint(e, false);
    const {region, startX, startY, mode} = interaction;
    const deltaX = point.x - startX;
    const deltaY = point.y - startY;
    editedRegion = mode === 'resize' ? resizeRegion(region, deltaX, deltaY) : {
      ...region,
      x: Math.max(0, Math.min(1 - region.width, region.x + deltaX)),
      y: Math.max(0, Math.min(1 - region.height, region.y + deltaY)),
    };
  }

  function resetInteraction() {
    const pointerId = interaction?.pointerId;
    interaction = null;
    draft = null;
    editedRegion = null;
    if (pointerId !== undefined && canvasWrap?.hasPointerCapture(pointerId)) {
      canvasWrap.releasePointerCapture(pointerId);
    }
  }

  function finishInteraction(e: PointerEvent) {
    if (!interaction || e.pointerId !== interaction.pointerId) return;
    handlePointerMove(e);
    if (interaction.mode !== 'draw') {
      const updated = editedRegion;
      if (updated) updateRegions(ignoreRegions.map((region) => region.id === updated.id ? updated : region));
      resetInteraction();
      return;
    }

    const nextRegion = getDraftRegion();
    resetInteraction();
    if (!nextRegion) return;
    const createdRegion = {
      ...nextRegion,
      id: `recognition-mask-${Date.now()}-${currentPage}-${Math.random().toString(36).slice(2, 8)}`,
      fill: 'white' as const,
    };
    focusedRegionId = createdRegion.id;
    updateRegions([...ignoreRegions, createdRegion]);
  }

  function handleRegionKeydown(e: KeyboardEvent, region: RecognitionIgnoreRegion, mode: 'move' | 'resize') {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || interaction) return;
    e.preventDefault();
    const rect = canvasElement.getBoundingClientRect();
    const step = e.shiftKey ? 10 : 1;
    const deltaX = (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0) / rect.width;
    const deltaY = (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) / rect.height;
    const updated = mode === 'resize' ? resizeRegion(region, deltaX, deltaY) : {
      ...region,
      x: Math.max(0, Math.min(1 - region.width, region.x + deltaX)),
      y: Math.max(0, Math.min(1 - region.height, region.y + deltaY)),
    };
    updateRegions(ignoreRegions.map((item) => item.id === region.id ? updated : item));
  }

  function closeEditor() {
    resetInteraction();
    hoveredRegionId = '';
    isOpen = false;
    renderToken++;
  }

  function changePage(pageNum: number) {
    if (pageNum === currentPage) return;
    resetInteraction();
    focusedRegionId = '';
    hoveredRegionId = '';
    sourceCanvas = null;
    renderToken++;
    currentPage = pageNum;
  }

  function clearHover(id: string) {
    if (hoveredRegionId === id) hoveredRegionId = '';
  }

  function deleteRegion(id: string) {
    if (focusedRegionId === id) focusedRegionId = '';
    clearHover(id);
    updateRegions(ignoreRegions.filter((region) => region.id !== id));
  }

  function clearCurrentPage() {
    focusedRegionId = '';
    hoveredRegionId = '';
    updateRegions(ignoreRegions.filter((region) => region.pageNum !== currentPage));
  }

  function applyCurrentAreasToAllPages() {
    const sourceRegions = currentPageRegions;

    if (allPageNumbers.length === 0) return;

    const allPageSet = new Set(allPageNumbers);
    const nextRegions = ignoreRegions.filter((region) => {
      if (region.pageNum === currentPage) return true;
      return !allPageSet.has(region.pageNum);
    });

    const copiedRegions = allPageNumbers.flatMap((pageNum) => {
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
    node.width = 88;
    node.height = 124;
    node.style.width = '88px';
    node.style.height = 'auto';
    node.dataset.thumbPageNum = String(pageNum);

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        renderPageThumb(node, pageNum);
        observer?.unobserve(node);
      }
    }, {root: node.closest('.recognition-page-list'), rootMargin: '120px'});

    if (observer) observer.observe(node);
    else renderPageThumb(node, pageNum);

    return {
      update(nextPageNum: number) {
        pageNum = nextPageNum;
        node.dataset.thumbPageNum = String(pageNum);
        if (observer) observer.observe(node);
        else renderPageThumb(node, pageNum);
      },
      destroy() {
        observer?.disconnect();
        thumbCanvases.delete(node);
      },
    };
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-50 p-3 sm:p-4"
    transition:fade={{duration: 150}}
    on:click|self={closeEditor}
    role="presentation"
  >
    <div
      class="bg-white rounded-lg p-4 md:p-5 w-full max-w-5xl h-[90vh] max-h-[90dvh] overflow-hidden border border-gray-200 flex flex-col"
      transition:fly={{y: 20, duration: 200}}
      role="dialog"
      aria-modal="true"
      aria-label={$t('recognition_ignore.title')}
    >
      <div class="flex justify-between items-start gap-3 mb-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <Eraser size={20} class="shrink-0 text-black" aria-hidden="true" />
            <h2 class="text-base md:text-xl font-bold">{$t('recognition_ignore.instruction')}</h2>
          </div>
        </div>
        <button
          type="button"
          on:click={closeEditor}
          class="p-1 rounded text-gray-500 hover:bg-gray-100 hover:text-black"
          title={$t('recognition_ignore.close')}
          aria-label={$t('recognition_ignore.close')}
        >
          <X size={20} />
        </button>
      </div>

      <div class="min-h-0 flex-1 grid grid-rows-[auto_minmax(0,1fr)_auto] md:grid-rows-1 md:grid-cols-[104px_minmax(0,1fr)_208px] gap-3">
        <aside class="recognition-page-list min-h-0 overflow-auto">
          <div class="flex md:flex-col gap-2">
            {#each allPageNumbers as page (page)}
              <button
                type="button"
                class="shrink-0 rounded-md border p-1.5 text-center transition-colors {page === currentPage ? 'border-blue-400 bg-blue-50' : 'border-transparent bg-white hover:bg-gray-50'}"
                on:click={() => changePage(page)}
                aria-label={$t('offset.page_n', {values: {n: page}})}
                aria-current={page === currentPage ? 'page' : undefined}
              >
                <canvas class="mx-auto block rounded-sm bg-white" use:pageThumb={page}></canvas>
                <div class="mt-1 text-center text-xs text-gray-600">
                  {$t('offset.page_n', {values: {n: page}})}
                </div>
              </button>
            {/each}
          </div>
        </aside>

        <div class="min-h-0 min-w-0 overflow-hidden rounded-md bg-gray-50 p-3 md:p-4">
          <div
            class="w-full h-full flex items-center justify-center"
            bind:this={canvasWrap}
            bind:clientWidth={canvasWrapWidth}
            bind:clientHeight={canvasWrapHeight}
            on:pointermove={handlePointerMove}
            on:pointerup={finishInteraction}
            on:pointercancel={(e) => interaction?.pointerId === e.pointerId && resetInteraction()}
            on:lostpointercapture={(e) => interaction?.pointerId === e.pointerId && resetInteraction()}
            role="presentation"
          >
            <div class="recognition-page relative max-w-full" class:invisible={!sourceCanvas}>
              <canvas
                bind:this={canvasElement}
                class="block max-w-full bg-white cursor-crosshair touch-none"
                on:pointerdown={handlePointerDown}
              ></canvas>
              {#each displayedRegions as region, index (region.id)}
                <div
                  class="recognition-area absolute pointer-events-none"
                  class:is-active={activeRegionId === region.id}
                  data-region-id={region.id}
                  data-active={activeRegionId === region.id}
                  style:left={region.x * 100 + '%'}
                  style:top={region.y * 100 + '%'}
                  style:width={region.width * 100 + '%'}
                  style:height={region.height * 100 + '%'}
                  on:mouseenter={() => (hoveredRegionId = region.id)}
                  on:mouseleave={() => clearHover(region.id)}
                  role="presentation"
                >
                  <div
                    class="area-drag-target absolute inset-0 pointer-events-auto cursor-move touch-none"
                    role="button"
                    tabindex="0"
                    aria-label={$t('recognition_ignore.region_n', {values: {n: index + 1}})}
                    title={$t('recognition_ignore.move_region')}
                    on:pointerdown={(e) => startRegionInteraction(e, region, 'move')}
                    on:focus={() => (focusedRegionId = region.id)}
                    on:keydown={(e) => handleRegionKeydown(e, region, 'move')}
                  ></div>
                  <span class="area-label absolute left-0 bottom-full mb-1 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] leading-4 text-white whitespace-nowrap">
                    {$t('recognition_ignore.region_n', {values: {n: index + 1}})}
                  </span>
                  <button
                    type="button"
                    class="area-resize-handle absolute -right-2.5 -bottom-2.5 inline-flex h-5 w-5 items-center justify-center pointer-events-auto cursor-nwse-resize touch-none"
                    aria-label={$t('recognition_ignore.resize_region') + ' · ' + $t('recognition_ignore.region_n', {values: {n: index + 1}})}
                    title={$t('recognition_ignore.resize_region')}
                    on:pointerdown={(e) => startRegionInteraction(e, region, 'resize')}
                    on:focus={() => (focusedRegionId = region.id)}
                    on:keydown={(e) => handleRegionKeydown(e, region, 'resize')}
                  >
                    <span class="h-2.5 w-2.5 rounded-sm border border-blue-500 bg-white"></span>
                  </button>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <aside class="flex min-h-0 max-h-36 md:max-h-none flex-col">
          <div class="flex items-center justify-between gap-2 mb-2">
            <h3 class="font-bold text-sm">{$t('recognition_ignore.current_page_regions')}</h3>
            <button
              type="button"
              on:click={clearCurrentPage}
              class="p-1 rounded text-gray-500 hover:bg-gray-100 hover:text-black disabled:opacity-40"
              title={$t('recognition_ignore.clear_page')}
              aria-label={$t('recognition_ignore.clear_page')}
              disabled={currentPageRegions.length === 0}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div class="min-h-0 overflow-auto">
            {#if currentPageRegions.length === 0}
              <div class="px-3 pt-12 pb-4 text-center">
                <p class="text-xs text-gray-500">{$t('recognition_ignore.empty_hint')}</p>
              </div>
            {:else}
              <div class="flex flex-col gap-1">
                {#each currentPageRegions as region, index (region.id)}
                  <div
                    class="recognition-area-row flex items-center gap-2 rounded transition-colors {activeRegionId === region.id ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}"
                    data-region-id={region.id}
                    on:mouseenter={() => (hoveredRegionId = region.id)}
                    on:mouseleave={() => clearHover(region.id)}
                    role="presentation"
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
                      on:click={() => focusRegion(region)}
                      on:focus={() => (hoveredRegionId = region.id)}
                      on:blur={() => clearHover(region.id)}
                      aria-pressed={focusedRegionId === region.id}
                    >
                      <span class="h-2 w-2 shrink-0 rounded-sm border border-current" aria-hidden="true"></span>
                      {$t('recognition_ignore.region_n', {values: {n: index + 1}})}
                    </button>
                    <button
                      type="button"
                      on:click={() => deleteRegion(region.id)}
                      class="mr-1 p-1 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      title={$t('settings.remove')}
                      aria-label={$t('settings.remove') + ' · ' + $t('recognition_ignore.region_n', {values: {n: index + 1}})}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          {#if allPageNumbers.length > 1 && currentPageRegions.length > 0}
            <button
              type="button"
              class="mt-2 inline-flex shrink-0 self-start items-center gap-1.5 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-black"
              on:click={applyCurrentAreasToAllPages}
            >
              <Copy size={14} />
              {$t('recognition_ignore.apply_all_pages')}
            </button>
          {/if}
        </aside>
      </div>

      <div class="flex justify-end mt-3">
        <button
          type="button"
          class="inline-flex items-center justify-center px-4 py-1.5 text-sm font-bold bg-green-500 text-black border border-black/20 rounded"
          on:click={closeEditor}
        >
          {$t('recognition_ignore.done')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .area-drag-target {
    border: 1px dashed #60a5fa;
  }

  .is-active .area-drag-target {
    border: 2px solid #3b82f6;
  }

  .area-drag-target:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .area-label,
  .area-resize-handle {
    opacity: 0;
  }

  .is-active .area-label,
  .is-active .area-resize-handle,
  .area-resize-handle:focus-visible {
    opacity: 1;
  }
</style>
