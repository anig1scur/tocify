<script lang="ts">
  import {createEventDispatcher, onDestroy, tick} from 'svelte';
  import {slide} from 'svelte/transition';
  import {cubicOut} from 'svelte/easing';
  import {t} from 'svelte-i18n';
  import {ChevronLeft, ChevronRight, Copy, Eraser, Trash2, X, RotateCcw} from 'lucide-svelte';
  import Modal from './modals/Modal.svelte';
  import {MOTION} from '$lib/utils/motion';
  import {modKey} from '$lib/utils/shortcuts';
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
      } else {
        value.width = value.height = 1;
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
  $: selectedPageSet = new Set(selectedPageNumbers);
  $: regionCountByPage = ignoreRegions.reduce((counts, region) => {
    counts.set(region.pageNum, (counts.get(region.pageNum) || 0) + 1);
    return counts;
  }, new Map<number, number>());
  $: currentPageIndex = allPageNumbers.indexOf(currentPage);
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
    undoStack = [];
    redoStack = [];
    isOpen = true;
    await tick();
    canvasWrap?.closest('[role="dialog"]')?.querySelector('[aria-current="page"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    renderPage();
  }

  // Area edits are undoable while the editor is open (⌘Z / ⌘⇧Z).
  let undoStack: RecognitionIgnoreRegion[][] = [];
  let redoStack: RecognitionIgnoreRegion[][] = [];
  const MAX_UNDO = 50;

  function emitRegions(nextRegions: RecognitionIgnoreRegion[]) {
    dispatch('change', nextRegions.map(normalizeRegion).filter((region) => region.width > 0 && region.height > 0));
  }

  function updateRegions(nextRegions: RecognitionIgnoreRegion[]) {
    undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), ignoreRegions.map((region) => ({...region}))];
    redoStack = [];
    emitRegions(nextRegions);
  }

  function stepHistory(direction: 'undo' | 'redo') {
    const from = direction === 'undo' ? undoStack : redoStack;
    const snapshot = from[from.length - 1];
    if (!snapshot) return;
    const current = ignoreRegions.map((region) => ({...region}));
    if (direction === 'undo') {
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, current];
    } else {
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, current];
    }
    resetInteraction();
    if (focusedRegionId && !snapshot.some((region) => region.id === focusedRegionId)) focusedRegionId = '';
    hoveredRegionId = '';
    emitRegions(snapshot);
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
    closeThumbCache();
    if (sourceCanvas) sourceCanvas.width = sourceCanvas.height = 1;
    sourceCanvas = null;
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

  function stepPage(delta: number) {
    const nextPage = allPageNumbers[currentPageIndex + delta];
    if (!nextPage) return;
    changePage(nextPage);
    tick().then(() => {
      canvasWrap?.closest('[role="dialog"]')?.querySelector('[aria-current="page"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    });
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (!isOpen || e.defaultPrevented || e.isComposing || e.altKey) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;

    if (e.metaKey || e.ctrlKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        e.preventDefault();
        stepHistory(key === 'y' || e.shiftKey ? 'redo' : 'undo');
      }
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && focusedRegionId) {
      e.preventDefault();
      deleteRegion(focusedRegionId);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      stepPage(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      stepPage(1);
    }
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
    resetInteraction();
    focusedRegionId = '';
    hoveredRegionId = '';
    updateRegions(ignoreRegions.filter((region) => region.pageNum !== currentPage));
  }

  function clearAllPages() {
    resetInteraction();
    focusedRegionId = '';
    hoveredRegionId = '';
    updateRegions([]);
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


<svelte:window on:keydown={handleWindowKeydown} />

<Modal
  open={isOpen}
  title={$t('recognition_ignore.title')}
  subtitle={$t('recognition_ignore.instruction')}
  closeLabel={$t('recognition_ignore.close')}
  accent="yellow"
  size="xl"
  tall
  on:close={closeEditor}
  on:submit={closeEditor}
>
  <svelte:fragment slot="icon"><Eraser size={18} strokeWidth={2.25} /></svelte:fragment>

  <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-3 sm:p-4 md:grid-cols-[112px_minmax(0,1fr)_240px] md:grid-rows-1">
    <aside class="recognition-page-list min-h-0 overflow-y-auto overflow-x-hidden py-1" aria-label={$t('recognition_ignore.title')}>
      <div class="flex gap-3 md:flex-col">
        {#each allPageNumbers as page (page)}
          {@const regionCount = regionCountByPage.get(page) || 0}
          <button
            type="button"
            class="page-thumb group shrink-0 text-center"
            class:is-current={page === currentPage}
            on:click={() => changePage(page)}
            aria-label={$t('offset.page_n', {values: {n: page}})}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            <span class="page-thumb-frame relative block">
              <canvas class="mx-auto block bg-white" use:pageThumb={page}></canvas>
              {#if regionCount > 0}
                <span class="region-badge" aria-hidden="true">{regionCount}</span>
              {/if}
            </span>
            <span class="mt-1 flex items-center justify-center gap-1 text-[11px] leading-4 tabular-nums {page === currentPage ? 'font-bold text-black' : 'text-gray-500'}">
              {#if selectedPageSet.has(page)}
                <span class="h-1.5 w-1.5 rounded-full bg-blue-500" aria-hidden="true"></span>
              {/if}
              {page}
            </span>
          </button>
        {/each}
      </div>
    </aside>

    <div class="paper-dots relative min-h-0 min-w-0 overflow-hidden rounded-lg px-4 pt-4 pb-14">
      <div
        class="flex h-full w-full items-center justify-center"
        bind:this={canvasWrap}
        bind:clientWidth={canvasWrapWidth}
        bind:clientHeight={canvasWrapHeight}
        on:pointermove={handlePointerMove}
        on:pointerup={finishInteraction}
        on:pointercancel={(e) => interaction?.pointerId === e.pointerId && resetInteraction()}
        on:lostpointercapture={(e) => interaction?.pointerId === e.pointerId && resetInteraction()}
        role="presentation"
      >
        <div class="recognition-page relative max-w-full" class:is-loading={!sourceCanvas}>
          <canvas
            bind:this={canvasElement}
            class="block max-w-full cursor-crosshair touch-none bg-white"
            on:pointerdown={handlePointerDown}
          ></canvas>
          {#each displayedRegions as region, index (region.id)}
            <div
              class="recognition-area pointer-events-none absolute"
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
                class="area-drag-target pointer-events-auto absolute inset-0 cursor-move touch-none"
                role="button"
                tabindex="0"
                aria-label={$t('recognition_ignore.region_n', {values: {n: index + 1}})}
                title={$t('recognition_ignore.move_region')}
                on:pointerdown={(e) => startRegionInteraction(e, region, 'move')}
                on:focus={() => (focusedRegionId = region.id)}
                on:keydown={(e) => handleRegionKeydown(e, region, 'move')}
              ></div>
              <span class="area-tag" aria-hidden="true">{index + 1}</span>
              <button
                type="button"
                class="area-delete pointer-events-auto"
                on:pointerdown|stopPropagation
                on:click={() => deleteRegion(region.id)}
                title={$t('settings.remove')}
                aria-label={$t('settings.remove') + ' · ' + $t('recognition_ignore.region_n', {values: {n: index + 1}})}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                class="area-resize-handle pointer-events-auto absolute -bottom-2 -right-2 inline-flex h-4 w-4 cursor-nwse-resize touch-none items-center justify-center"
                aria-label={$t('recognition_ignore.resize_region') + ' · ' + $t('recognition_ignore.region_n', {values: {n: index + 1}})}
                title={$t('recognition_ignore.resize_region')}
                on:pointerdown={(e) => startRegionInteraction(e, region, 'resize')}
                on:focus={() => (focusedRegionId = region.id)}
                on:keydown={(e) => handleRegionKeydown(e, region, 'resize')}
              >
                <span class="h-2.5 w-2.5 rounded-[2px] border-2 border-black bg-white"></span>
              </button>
            </div>
          {/each}
        </div>
      </div>

      {#if allPageNumbers.length > 1}
        <div class="page-nav absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 text-gray-600">
          <button
            type="button"
            class="nb-icon-btn h-7 w-7 disabled:opacity-25"
            on:click={() => stepPage(-1)}
            disabled={currentPageIndex <= 0}
            aria-label={$t('recognition_ignore.prev_page')}
            title="{$t('recognition_ignore.prev_page')} (←)"
          >
            <ChevronLeft size={16} />
          </button>
          <span class="min-w-[4.5rem] text-center text-xs tabular-nums">
            {currentPage} / {allPageNumbers.length}
          </span>
          <button
            type="button"
            class="nb-icon-btn h-7 w-7 disabled:opacity-25"
            on:click={() => stepPage(1)}
            disabled={currentPageIndex >= allPageNumbers.length - 1}
            aria-label={$t('recognition_ignore.next_page')}
            title="{$t('recognition_ignore.next_page')} (→)"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      {/if}
    </div>

    <aside class="flex max-h-40 min-h-0 flex-col overflow-hidden bg-white md:max-h-none">
      <div class="flex h-9 shrink-0 items-center justify-between gap-2 pl-1">
        <h3 class="flex min-w-0 items-center gap-2 text-sm font-bold">
          <span class="truncate">{$t('recognition_ignore.current_page_regions')}</span>
          <span class="ui-count">{currentPageRegions.length}</span>
        </h3>
        <button
          type="button"
          on:click={clearCurrentPage}
          class="nb-icon-btn"
          title={$t('recognition_ignore.clear_page')}
          aria-label={$t('recognition_ignore.clear_page')}
          disabled={currentPageRegions.length === 0}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto pt-1">
        {#if currentPageRegions.length === 0}
          <div class="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-3 py-6 text-center text-gray-400">
            <Eraser size={22} strokeWidth={1.75} aria-hidden="true" />
            <p class="text-xs leading-5">{$t('recognition_ignore.empty_hint')}</p>
          </div>
        {:else}
          <div class="flex flex-col gap-0.5">
            {#each currentPageRegions as region, index (region.id)}
              <div
                class="recognition-area-row group flex h-9 items-center gap-1 rounded-md transition-colors duration-100 {activeRegionId === region.id ? 'bg-yellow-100 text-black' : 'text-gray-700 hover:bg-black/[0.04]'}"
                data-region-id={region.id}
                on:mouseenter={() => (hoveredRegionId = region.id)}
                on:mouseleave={() => clearHover(region.id)}
                role="presentation"
                transition:slide={{duration: MOTION.base, easing: cubicOut}}
              >
                <button
                  type="button"
                  class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm"
                  on:click={() => focusRegion(region)}
                  on:focus={() => (hoveredRegionId = region.id)}
                  on:blur={() => clearHover(region.id)}
                  aria-pressed={focusedRegionId === region.id}
                >
                  <span class="grid h-5 w-5 shrink-0 place-items-center rounded bg-black text-[10px] font-bold text-white" aria-hidden="true">{index + 1}</span>
                  <span class="truncate">{$t('recognition_ignore.region_n', {values: {n: index + 1}})}</span>
                </button>
                <button
                  type="button"
                  on:click={() => deleteRegion(region.id)}
                  class="nb-icon-btn h-7 w-7 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                  title={$t('settings.remove')}
                  aria-label={$t('settings.remove') + ' · ' + $t('recognition_ignore.region_n', {values: {n: index + 1}})}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </aside>
  </div>

  <svelte:fragment slot="footer">
    <button
      type="button"
      class="nb-ghost mr-auto hover:!bg-red-50 hover:!text-red-600"
      on:click={clearAllPages}
      title={$t('recognition_ignore.clear_all_pages')}
      aria-label={$t('recognition_ignore.clear_all_pages')}
      disabled={ignoreRegions.length === 0}
    >
      <Trash2 size={14} />
      <span class="hidden sm:inline">{$t('recognition_ignore.clear_all_pages')}</span>
    </button>
    {#if allPageNumbers.length > 1}
      <button
        type="button"
        class="nb-btn bg-white"
        on:click={applyCurrentAreasToAllPages}
        disabled={currentPageRegions.length === 0}
      >
        <Copy size={14} />
        {$t('recognition_ignore.apply_all_pages')}
      </button>
    {/if}
    <button
      type="button"
      class="nb-btn bg-green-500 px-5"
      on:click={closeEditor}
      title="{$t('recognition_ignore.done')} ({modKey} ↩)"
    >
      {$t('recognition_ignore.done')}
    </button>
  </svelte:fragment>
</Modal>

<style>
  .page-thumb-frame {
    width: 92px;
    margin: 0 auto;
    border: 2px solid #e5e7eb;
    border-radius: 6px;
    transition: border-color 120ms ease;
  }

  .page-thumb-frame canvas {
    width: 100% !important;
    height: auto !important;
    border-radius: 4px;
  }

  .page-thumb:hover .page-thumb-frame {
    border-color: #9ca3af;
  }

  .page-thumb.is-current .page-thumb-frame {
    border-color: #000;
  }

  .page-thumb:focus-visible {
    outline: none;
  }

  .page-thumb:focus-visible .page-thumb-frame {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .region-badge {
    position: absolute;
    top: -7px;
    right: -7px;
    display: grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border: 2px solid #000;
    border-radius: 999px;
    background: #facc15;
    color: #000;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    animation: badge-pop 220ms var(--ease-land);
  }

  .recognition-page {
    box-shadow: 0 0 0 1px #e5e7eb;
    transition: opacity 180ms ease;
  }

  .recognition-page.is-loading {
    opacity: 0;
  }

  .area-drag-target {
    border: 1.5px dashed #3b82f6;
    background: rgb(59 130 246 / .04);
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .is-active .area-drag-target {
    border: 2px solid #2563eb;
    background: rgb(59 130 246 / .08);
  }

  .area-drag-target:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .area-tag {
    position: absolute;
    left: -1px;
    bottom: calc(100% + 3px);
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 3px;
    background: #000;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .area-delete {
    position: absolute;
    right: -1px;
    bottom: calc(100% + 3px);
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 2px solid #000;
    border-radius: 4px;
    background: #fff;
    color: #000;
  }

  .area-delete:hover {
    background: #fee2e2;
  }

  .area-delete,
  .area-resize-handle {
    opacity: 0;
    transform: scale(.7);
    transition: opacity 120ms ease, transform 160ms var(--ease-land);
  }

  .is-active .area-delete,
  .is-active .area-resize-handle,
  .area-delete:focus-visible,
  .area-resize-handle:focus-visible {
    opacity: 1;
    transform: scale(1);
  }

  @keyframes badge-pop {
    from {
      transform: scale(.4);
    }
    to {
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .region-badge {
      animation: none;
    }
  }
</style>
