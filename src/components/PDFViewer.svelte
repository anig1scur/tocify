<script lang="ts">
  import {createEventDispatcher, tick, onDestroy} from 'svelte';
  import {ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, ListOrdered, Eraser} from 'lucide-svelte';
  import {t} from 'svelte-i18n';

  import { tocConfig } from '../stores';
  import { type PDFState, type TocItem } from '$lib/pdf/service';
  import { renderQueue, isRenderCancelled } from '$lib/pdf/render-queue';
  import { formatPageLabel } from '$lib/pdf/page-labels';
  import type {RecognitionIgnoreRegion} from '$lib/pdf/recognition-ignore';

  export let pdfState: PDFState;
  export let originalPdfInstance: any = null;
  export let tocPdfInstance: any = null;
  export let tocPageCount: number = 0;
  export let mode: 'single' | 'grid' = 'single';
  export let tocRanges: {start: number; end: number; id: string}[];
  export let recognitionIgnoreRegions: RecognitionIgnoreRegion[] = [];
  export let activeRangeIndex: number = 0;

  export let jumpToTocPage: (() => Promise<void>) | undefined = undefined;
  export let addPhysicalTocPage: boolean = false;
  export let currentTocPath: TocItem[] = [];
  export let prefetchPageNum: number = 0;
  export let highlightPageNum: number = 0;

  const dispatch = createEventDispatcher();

  let gridPages: {pageNum: number; canvasId: string}[] = [];
  let intersectionObserver: IntersectionObserver | null = null;
  let scrollContainer: HTMLElement;
  let canvasElement: HTMLCanvasElement;

  let canvasesToObserve: HTMLCanvasElement[] = [];
  const visibleGridCanvases = new Set<HTMLCanvasElement>();
  const gridRenderControllers = new WeakMap<HTMLCanvasElement, AbortController>();
  let currentRenderController: AbortController | null = null;
  let currentRenderToken = 0;
  let currentRenderFrame = 0;
  let readingRenderScale = 1.5;
  let hoverPrefetchController: AbortController | null = null;

  let isSelecting = false;
  let selectionStartPage = 0;

  let pressTimer: number | null = null;

  let autoScrollSpeed = 0;
  let autoScrollFrameId: number | null = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  let lastPageId = '';
  let containerWidth = 0;
  let containerHeight = 0;

  let pageLabels: string[] | null = null;
  let lastPageLabelsInstance: any = null;

  let tocVersion = 0;
  $: if (tocPdfInstance) {
    tocVersion++;
  }

  function cancelCurrentRender() {
    currentRenderToken++;
    currentRenderController?.abort();
    currentRenderController = null;
    if (currentRenderFrame) cancelAnimationFrame(currentRenderFrame);
    currentRenderFrame = 0;
  }

  function cleanupObservers() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    stopAutoScroll();
    for (const canvas of visibleGridCanvases) releaseGridCanvas(canvas);
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  onDestroy(() => {
    cancelCurrentRender();
    hoverPrefetchController?.abort();
    cleanupObservers();
  });

  $: ({filename, currentPage, scale, totalPages: stateTotalPages} = pdfState);
  $: activeTotalPages = stateTotalPages;

  function getVirtualPageInfo(pageNum: number) {
    if (!tocPdfInstance || !addPhysicalTocPage) {
      return { instance: originalPdfInstance, localPageNum: pageNum };
    }

    const insertAt = $tocConfig.insertAtPage || 2;
    if (pageNum < insertAt) {
      return { instance: originalPdfInstance, localPageNum: pageNum };
    } else if (pageNum < insertAt + tocPageCount) {
      return { instance: tocPdfInstance, localPageNum: pageNum - insertAt + 1 };
    } else {
      return { instance: originalPdfInstance, localPageNum: pageNum - tocPageCount };
    }
  }

  function getPageId(pageNum: number) {
    const { instance, localPageNum } = getVirtualPageInfo(pageNum);
    if (instance === tocPdfInstance) {
      return `toc-${tocVersion}-${localPageNum}`;
    }
    return `orig-${localPageNum}`;
  }

  function drawIgnoreRegions(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, pageNum: number) {
    const pageRegions = recognitionIgnoreRegions.filter((region) => region.pageNum === pageNum);
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

  function repaintGridCanvasFromCache(canvas: HTMLCanvasElement, pageNum: number) {
    if (pageNum <= 0 || canvas.width === 0 || canvas.height === 0) return;

    const {instance} = getVirtualPageInfo(pageNum);
    if (!instance) return;
    const bitmap = renderQueue.getCached(`thumb-${getPageId(pageNum)}`, instance, Number(canvas.dataset.renderScale));
    if (!bitmap) {
      void renderGridCanvas(canvas, pageNum, true);
      return;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    drawIgnoreRegions(ctx, canvas, pageNum);
  }

  $: currentPageLabel = (originalPdfInstance && $tocConfig.pageLabelSettings.enabled) 
    ? formatPageLabel(currentPage - 1, $tocConfig.pageLabelSettings, {
        tocPageCount,
        insertAtPage: $tocConfig.insertAtPage || 2
      })
    : (pageLabels?.[currentPage - 1] || '');

  async function refreshPageLabels(pdfInstance: any) {
    pageLabels = null;

    if (!pdfInstance || typeof pdfInstance.getPageLabels !== 'function') return;

    try {
      const labels = await pdfInstance.getPageLabels();
      if (lastPageLabelsInstance !== pdfInstance) return;
      pageLabels = labels;
    } catch (e) {
      // Ignore getPageLabels errors and fall back to physical page numbers.
    }
  }

  $: if (originalPdfInstance && originalPdfInstance !== lastPageLabelsInstance) {
    lastPageLabelsInstance = originalPdfInstance;
    refreshPageLabels(originalPdfInstance);
  }

  $: if (!originalPdfInstance) {
    lastPageId = '';
    gridPages = [];
    cleanupObservers();
  }

  function scheduleCurrentRender() {
    cancelCurrentRender();
    currentRenderFrame = requestAnimationFrame(() => {
      currentRenderFrame = 0;
      void renderCurrentPage();
    });
  }

  async function renderCurrentPage() {
    if (!originalPdfInstance || !currentPage || !scale || !canvasElement || mode !== 'single') return;
    const requestedPage = currentPage;
    const requestedScale = scale;
    const pageId = getPageId(requestedPage);
    const {instance, localPageNum} = getVirtualPageInfo(requestedPage);
    if (!instance) return;
    const canvas = canvasElement;
    const token = currentRenderToken;
    const controller = new AbortController();
    currentRenderController = controller;

    try {
      const page = await instance.getPage(localPageNum);
      if (token !== currentRenderToken || controller.signal.aborted) return;
      const baseViewport = page.getViewport({scale: 1});
      const fitScale = Math.min(
        Math.max(0.05, (containerWidth - 40) / baseViewport.width),
        Math.max(0.05, (containerHeight - 40) / baseViewport.height),
      );
      const displayScale = requestedScale * fitScale;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const renderScale = displayScale * dpr;
      const renderKey = renderQueue.getCacheKey(pageId, instance, renderScale);
      readingRenderScale = renderScale;
      canvas.style.width = `${Math.floor(baseViewport.width * displayScale)}px`;
      canvas.style.height = `${Math.floor(baseViewport.height * displayScale)}px`;
      if (lastPageId === renderKey) return;

      const bitmap = await renderQueue.enqueue(pageId, instance, localPageNum, 0, {
        scale: renderScale,
        signal: controller.signal,
      });
      if (token !== currentRenderToken || controller.signal.aborted || mode !== 'single' || canvas !== canvasElement || !canvas.isConnected) return;
      const context = canvas.getContext('2d', {alpha: false});
      if (!context) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
      lastPageId = renderKey;
      canvas.dataset.renderKey = renderKey;

      if (requestedPage < activeTotalPages) {
        const next = getVirtualPageInfo(requestedPage + 1);
        if (next.instance) {
          void renderQueue.enqueue(getPageId(requestedPage + 1), next.instance, next.localPageNum, 3, {
            scale: renderScale,
            signal: controller.signal,
          }).catch((error) => {
            if (!isRenderCancelled(error)) console.error('PDF prefetch error:', error);
          });
        }
      }
    } catch (error) {
      if (!isRenderCancelled(error)) console.error('Rendering error:', error);
    }
  }

  $: if (mode === 'single' && originalPdfInstance && currentPage && scale && containerWidth && containerHeight && canvasElement) {
    tocPdfInstance;
    tocPageCount;
    addPhysicalTocPage;
    $tocConfig.insertAtPage;
    scheduleCurrentRender();
  } else {
    cancelCurrentRender();
  }

  const goToNextPage = () => {
    if (currentPage < activeTotalPages) {
      pdfState.currentPage += 1;
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 1) {
      pdfState.currentPage -= 1;
    }
  };
  const zoomIn = () => {
    pdfState.scale = Math.min(scale + 0.15, 2.0);
  };

  const zoomOut = () => {
    pdfState.scale = Math.max(scale - 0.15, 0.5);
  };

  const resetZoom = () => {
    pdfState.scale = 1.0;
  };

  $: if (prefetchPageNum > 0) {
    handleMouseHover(prefetchPageNum);
  }

  $: if (originalPdfInstance && activeTotalPages > 0) {
    if (gridPages.length !== activeTotalPages) {
      gridPages = Array.from({length: activeTotalPages}, (_, i) => ({
        pageNum: i + 1,
        canvasId: `thumb-canvas-${i + 1}`,
      }));
    }
  } else if (!originalPdfInstance && gridPages.length > 0) {
    gridPages = [];
  }

  async function autoScrollToPage(targetPage: number) {
    if (mode !== 'grid' || !scrollContainer) return;
    await tick();

    const pageEl = scrollContainer.querySelector(`[data-page-num="${targetPage}"]`) as HTMLElement;
    if (pageEl) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = pageEl.getBoundingClientRect();
      const relativeTop = elementRect.top - containerRect.top;
      const targetScrollTop =
        scrollContainer.scrollTop + relativeTop - scrollContainer.clientHeight / 2 + pageEl.clientHeight / 2;

      scrollContainer.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth',
      });
    }
  }

  $: if (activeRangeIndex >= 0 && mode === 'grid' && !isSelecting) {
    const range = tocRanges[activeRangeIndex];
    if (range) autoScrollToPage(range.start);
  }

  let highlightTimer: any;
  $: if (highlightPageNum > 0 && mode === 'grid') {
    autoScrollToPage(highlightPageNum);
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightPageNum = 0;
    }, 2000);
  }

  function scrollLoop() {
    if (autoScrollSpeed === 0 || !scrollContainer) {
      autoScrollFrameId = null;
      return;
    }
    scrollContainer.scrollTop += autoScrollSpeed;

    if (isSelecting) {
      updateSelectionFromPoint(lastMouseX, lastMouseY);
    }

    autoScrollFrameId = requestAnimationFrame(scrollLoop);
  }

  function updateSelectionFromPoint(clientX: number, clientY: number) {
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();

    const clampedX = Math.max(rect.left + 5, Math.min(rect.right - 5, clientX));
    const clampedY = Math.max(rect.top + 5, Math.min(rect.bottom - 5, clientY));

    const targetElement = document.elementFromPoint(clampedX, clampedY);
    if (!targetElement) return;

    const pageItem = targetElement.closest('[data-page-num]') as HTMLElement;
    if (pageItem && pageItem.dataset.pageNum) {
      const pageNum = parseInt(pageItem.dataset.pageNum, 10);
      if (!isNaN(pageNum)) {
        handleMouseEnter(pageNum);
      }
    }
  }

  function stopAutoScroll() {
    autoScrollSpeed = 0;
    if (autoScrollFrameId) {
      cancelAnimationFrame(autoScrollFrameId);
      autoScrollFrameId = null;
    }
  }

  function checkAutoScroll(clientY: number) {
    if (!isSelecting || !scrollContainer) {
      stopAutoScroll();
      return;
    }
    const rect = scrollContainer.getBoundingClientRect();
    const hotZoneSize = 80;

    if (clientY < rect.top + hotZoneSize) {
      autoScrollSpeed = -10;
      if (!autoScrollFrameId) autoScrollFrameId = requestAnimationFrame(scrollLoop);
    } else if (clientY > rect.bottom - hotZoneSize) {
      autoScrollSpeed = 10;
      if (!autoScrollFrameId) autoScrollFrameId = requestAnimationFrame(scrollLoop);
    } else {
      stopAutoScroll();
    }
  }

  function handleMouseHover(pageNum: number) {
    if (mode === 'grid' || !originalPdfInstance) return;
    
    // Prefetch with lower priority
    const { instance, localPageNum } = getVirtualPageInfo(pageNum);
    if (!instance) return;
    const pageId = getPageId(pageNum);
    hoverPrefetchController?.abort();
    hoverPrefetchController = new AbortController();
    void renderQueue.enqueue(pageId, instance, localPageNum, 5, {
      scale: readingRenderScale,
      signal: hoverPrefetchController.signal,
    }).catch((error) => {
      if (!isRenderCancelled(error)) console.error('PDF prefetch error:', error);
    });
  }

  function handleMouseDown(pageNum: number) {
    isSelecting = true;
    selectionStartPage = pageNum;
    dispatch('updateActiveRange', {start: pageNum, end: pageNum});
  }

  function handleMouseEnter(pageNum: number) {
    if (!isSelecting) return;

    const newStart = Math.min(selectionStartPage, pageNum);
    const newEnd = Math.max(selectionStartPage, pageNum);

    const currentRange = tocRanges[activeRangeIndex];
    if (currentRange && (currentRange.start !== newStart || currentRange.end !== newEnd)) {
      dispatch('updateActiveRange', {start: newStart, end: newEnd});
    }
  }

  function handleMouseUp() {
    stopAutoScroll();
    isSelecting = false;
    selectionStartPage = 0;
  }

  function handleGridMouseMove(e: MouseEvent) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (!isSelecting) return;

    checkAutoScroll(e.clientY);
    updateSelectionFromPoint(e.clientX, e.clientY);
  }

  function handleTouchStart(pageNum: number) {
    if (pressTimer) {
      clearTimeout(pressTimer);
    }
    pressTimer = window.setTimeout(() => {
      handleMouseDown(pageNum);
      pressTimer = null;
    }, 300);
  }

  function handleTouchMove(e: TouchEvent) {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }

    if (!isSelecting) return;

    if (e.cancelable) {
      e.preventDefault();
    }

    const touch = e.touches[0];
    if (!touch) return;

    checkAutoScroll(touch.clientY);

    const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!targetElement) return;

    const pageItem = targetElement.closest('[data-page-num]') as HTMLElement;

    if (pageItem && pageItem.dataset.pageNum) {
      const pageNum = parseInt(pageItem.dataset.pageNum, 10);
      if (!isNaN(pageNum)) {
        handleMouseEnter(pageNum);
      }
    }
  }

  function handlePointerMove(e: PointerEvent) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (!isSelecting) return;

    checkAutoScroll(e.clientY);
    updateSelectionFromPoint(e.clientX, e.clientY);
  }

  function handlePointerUp() {
    stopAutoScroll();
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    isSelecting = false;
    selectionStartPage = 0;
  }

  function releaseGridCanvas(canvas: HTMLCanvasElement) {
    gridRenderControllers.get(canvas)?.abort();
    gridRenderControllers.delete(canvas);
    visibleGridCanvases.delete(canvas);
    canvas.width = 1;
    canvas.height = 1;
    delete canvas.dataset.renderKey;
  }

  async function renderGridCanvas(canvas: HTMLCanvasElement, pageNum: number, force = false) {
    if (mode !== 'grid' || !visibleGridCanvases.has(canvas) || pageNum <= 0 || !originalPdfInstance) return;
    const {instance, localPageNum} = getVirtualPageInfo(pageNum);
    if (!instance || !canvas.clientWidth) return;
    gridRenderControllers.get(canvas)?.abort();
    const controller = new AbortController();
    gridRenderControllers.set(canvas, controller);

    try {
      const page = await instance.getPage(localPageNum);
      if (controller.signal.aborted) return;
      const viewport = page.getViewport({scale: 1});
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      const renderScale = canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2) / viewport.width;
      const id = `thumb-${getPageId(pageNum)}`;
      const renderKey = renderQueue.getCacheKey(id, instance, renderScale);
      if (!force && canvas.dataset.renderKey === renderKey) return;
      const bitmap = await renderQueue.enqueue(id, instance, localPageNum, 1, {scale: renderScale, signal: controller.signal});
      if (controller.signal.aborted || mode !== 'grid' || !visibleGridCanvases.has(canvas) || !canvas.isConnected) return;
      const context = canvas.getContext('2d', {alpha: false});
      if (!context) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.dataset.renderKey = renderKey;
      canvas.dataset.renderScale = String(renderScale);
      context.drawImage(bitmap, 0, 0);
      drawIgnoreRegions(context, canvas, pageNum);
    } catch (error) {
      if (!isRenderCancelled(error)) console.error('PDF thumbnail error:', error);
    }
  }

  $: if (mode === 'grid' && scrollContainer && originalPdfInstance) {
    recognitionIgnoreRegions;
    for (const canvas of visibleGridCanvases) {
      repaintGridCanvasFromCache(canvas, Number(canvas.dataset.pageNum));
    }
  }

  function observeViewport(node: HTMLElement) {
    scrollContainer = node;
    intersectionObserver?.disconnect();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const canvas = entry.target as HTMLCanvasElement;
        if (entry.isIntersecting && mode === 'grid') {
          visibleGridCanvases.add(canvas);
          void renderGridCanvas(canvas, Number(canvas.dataset.pageNum));
        } else {
          releaseGridCanvas(canvas);
        }
      }
    }, {root: node, rootMargin: '160px'});
    intersectionObserver = observer;
    for (const canvas of canvasesToObserve) observer.observe(canvas);
    canvasesToObserve = [];

    let lastWidth = node.clientWidth;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      if (node.clientWidth === lastWidth) return;
      lastWidth = node.clientWidth;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        for (const canvas of visibleGridCanvases) void renderGridCanvas(canvas, Number(canvas.dataset.pageNum));
      }, 80);
    });
    resizeObserver.observe(node);

    return {
      destroy() {
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        observer.disconnect();
        if (intersectionObserver === observer) intersectionObserver = null;
        for (const canvas of visibleGridCanvases) releaseGridCanvas(canvas);
      },
    };
  }

  function lazyRender(canvas: HTMLCanvasElement, {pageNum}: {pageNum: number}) {
    canvas.dataset.pageNum = String(pageNum);
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.aspectRatio = '595 / 842';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    if (intersectionObserver) intersectionObserver.observe(canvas);
    else canvasesToObserve.push(canvas);
    return {
      destroy() {
        intersectionObserver?.unobserve(canvas);
        canvasesToObserve = canvasesToObserve.filter((entry) => entry !== canvas);
        releaseGridCanvas(canvas);
      },
    };
  }

</script>

<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
  on:mousemove={handleGridMouseMove}
  on:mouseup={handleMouseUp}
  on:touchend={handlePointerUp}
  on:touchcancel={handlePointerUp}
/>

<div class="h-[85vh] rounded-lg relative w-full bg-white">
  <div
    class="flex flex-col h-full absolute w-full inset-0 z-10 bg-white rounded-md"
    class:hidden={mode !== 'single'}
  >
    <div
      class="flex items-center flex-col justify-start w-full px-2 md:px-4 py-2 bg-white border-b-2 border-black rounded-t-md overflow-x-auto"
    >
      <div class="flex z-10 items-center justify-between w-full">
        <div class="w-[70%] text-gray-600 font-serif flex gap-1 sm:gap-2 items-center text-sm md:text-base">
          <span class="truncate">{filename}</span>
          <span class="text-gray-300">|</span>
          <div class="flex items-center gap-1 flex-nowrap">
            <input
              type="number"
              min="1"
              max={activeTotalPages}
              value={currentPage}
              on:change={(e) => {
                const val = parseInt(e.currentTarget.value, 10);
                if (!isNaN(val) && val >= 1 && val <= activeTotalPages) {
                  pdfState.currentPage = val;
                } else {
                  e.currentTarget.value = currentPage.toString();
                }
              }}
              class="w-15 text-center border-b border-gray-300 focus:border-black outline-none bg-transparent p-0 text-gray-800"
            />
            {#if currentPageLabel}
              <span class="text-xs text-gray-400 font-mono">({currentPageLabel})</span>
            {/if}
            <span class="min-w-12">/ {activeTotalPages}</span>
          </div>

          {#if tocPdfInstance && jumpToTocPage}
            <button
              on:click={jumpToTocPage}
              class="p-1 sm:min-w-12 py-0.5 rounded-lg hover:bg-gray-100 text-black border-2 border-black shadow-[1px_1px_0px_var(--hard-shadow-color)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              title={$t('tooltip.jump_toc')}
            >
              <ListOrdered
                size={11}
                class="inline-block"
              /> 
              <span class="hidden sm:inline">ToC</span>
            </button>
          {/if}
        </div>

        <div class="flex items-center gap-1 w-[30%] flex-[0]">
          <button
            on:click={zoomOut}
            class="p-1 md:p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title={$t('tooltip.zoom_out')}
          >
            <ZoomOut size={20} />
          </button>
          <span class="min-w-[30px] text-center text-gray-600 text-sm md:text-base md:min-w-[40px]">
            {Math.round(scale * 100)}%
          </span>
          <button
            on:click={zoomIn}
            class="p-1 md:p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title={$t('tooltip.zoom_in')}
          >
            <ZoomIn size={20} />
          </button>
          <button
            on:click={resetZoom}
            class="p-1 md:p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title={$t('tooltip.reset')}
          >
            <RotateCw size={20} />
          </button>
        </div>
      </div>
    </div>

    <div
      class="relative flex-1 overflow-hidden bg-gray-50 single-view-container"
      bind:clientWidth={containerWidth}
      bind:clientHeight={containerHeight}
    >
      {#if currentTocPath.length > 0}
        <div class="absolute z-30 pointer-events-none max-w-[70%] md:max-w-[60%]">
          <div
            class="backdrop-blur-sm border border-gray-200 p-2 text-xs rounded-[0_0_20px_0] backdrop-blur-sm bg-white/20 text-gray-600 font-mono space-y-0.5"
          >
            {#each currentTocPath as item, i}
              <div
                class="truncate flex items-center gap-2"
                style="padding-left: {i * 12}px;"
              >
                {#if i > 0}
                  <div class="w-[3px] h-[3px] bg-gray-500 shrink-0"></div>
                {/if}
                <span>{item.title}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <button
        on:click={goToPrevPage}
        disabled={currentPage <= 1}
        class="absolute left-2 top-1/2 -translate-y-1/2 p-1 md:left-4 md:p-2 rounded-full bg-white shadow-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed z-20 border-2 border-black"
      >
        <ChevronLeft size={24} />
      </button>

      <div class="w-full h-full overflow-auto flex">
        <div class="m-auto p-4 min-w-max min-h-max">
          <canvas
            class="block"
            bind:this={canvasElement}
          ></canvas>
        </div>
      </div>

      <button
        on:click={goToNextPage}
        disabled={currentPage >= activeTotalPages}
        class="absolute right-2 top-1/2 -translate-y-1/2 p-1 md:right-4 md:p-2 rounded-full bg-white shadow-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed z-20 border-2 border-black"
      >
        <ChevronRight size={24} />
      </button>
    </div>
  </div>

  <div
    class="absolute inset-0 z-0 bg-gray-50 overflow-auto rounded-md"
    class:hidden={mode !== 'grid'}
    use:observeViewport
  >
    <div
      class="grid grid-cols-2 gap-3 p-3 select-none md:grid-cols-3 md:gap-4 2xl:grid-cols-4 2xl:gap-5"
      class:cursor-grabbing={isSelecting}
      on:touchmove|nonpassive={handleTouchMove}
      on:touchend={handlePointerUp}
      on:touchcancel={handlePointerUp}
      on:contextmenu|preventDefault
      role="grid"
      tabindex="0"
    >
      {#each gridPages as page (page.pageNum)}
        {@const rangeIndex = tocRanges.findIndex((r) => page.pageNum >= r.start && page.pageNum <= r.end)}
        {@const isSelected = rangeIndex !== -1}
        {@const isActive = rangeIndex === activeRangeIndex}
        {@const isStart = tocRanges.some((r) => r.start === page.pageNum)}
        {@const isEnd = tocRanges.some((r) => r.end === page.pageNum)}
        <div
          data-page-num={page.pageNum}
          class="group relative rounded-lg overflow-hidden border-t-[2px] border-l-[2px] cursor-pointer bg-white transition-all duration-150 transform border-2"
          class:shadow-[3px_3px_0px]={isSelected}
          class:shadow-blue-400={isSelected && isActive}
          class:shadow-gray-400={isSelected && !isActive}
          class:border-blue-500={isSelected && isActive}
          class:border-gray-500={(isSelected && !isActive) || !isSelected}
          class:scale-[1.02]={isSelected}
          class:ring-4={highlightPageNum === page.pageNum}
          class:ring-green-400={highlightPageNum === page.pageNum}
          class:ring-offset-2={highlightPageNum === page.pageNum}
          style="-webkit-touch-callout: none;"
          on:mousedown={() => handleMouseDown(page.pageNum)}
          on:touchstart={() => handleTouchStart(page.pageNum)}
          on:mouseenter={() => handleMouseEnter(page.pageNum)}
          on:dragstart|preventDefault
          role="gridcell"
          tabindex="0"
        >
          {#if isSelected}
            <button
              class="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-black shadow-sm opacity-0 transition-all hover:bg-gray-50 hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
              on:mousedown|stopPropagation
              on:touchstart|stopPropagation
              on:click|stopPropagation={() => dispatch('openRecognitionIgnore', {pageNum: page.pageNum})}
              title={$t('recognition_ignore.open')}
              aria-label={$t('recognition_ignore.open')}
            >
              <Eraser size={15} />
            </button>
          {/if}

          {#if isStart}
            <span
              class="absolute -top-2.5 -left-2.5 z-10 rounded-full pr-2 pl-3 pt-3 text-xs font-bold text-white shadow-lg {isActive
                ? 'bg-blue-600'
                : 'bg-gray-500'}"
            >
              {$t('label.start')}
            </span>
          {/if}

          {#if isEnd}
            <span
              class="absolute -bottom-2.5 -right-2.5 z-10 rounded-full pl-2 pr-3 pb-[10px] pt-[2px] text-xs font-bold text-white shadow-lg {isActive
                ? 'bg-blue-600'
                : 'bg-gray-500'}"
            >
              {$t('label.end')}
            </span>
          {/if}

          <canvas
            id={page.canvasId}
            class:cursor-grabbing={isSelecting}
            class="w-full border-b bg-white h-[calc(100%-30px)]"
            use:lazyRender={{pageNum: page.pageNum}}
          ></canvas>

          <div class="text-center text-xs p-2 bg-white">
            {page.pageNum}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
