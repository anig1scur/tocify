<script lang="ts">
  import {createEventDispatcher, tick, onDestroy} from 'svelte';
  import {ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, ListOrdered} from 'lucide-svelte';
  import {t} from 'svelte-i18n';

  import { pdfService, tocConfig } from '../stores';
  import { type PDFService, type PDFState, type TocItem } from '$lib/pdf/service';
  import { renderQueue } from '$lib/pdf/render-queue';
  import { formatPageLabel } from '$lib/pdf/page-labels';
  import type { RenderTask } from 'pdfjs-dist';

  export let pdfState: PDFState;
  export let originalPdfInstance: any = null;
  export let tocPdfInstance: any = null;
  export let tocPageCount: number = 0;
  export let mode: 'single' | 'grid' = 'single';
  export let tocRanges: {start: number; end: number; id: string}[];
  export let activeRangeIndex: number = 0;

  export let jumpToTocPage: (() => Promise<void>) | undefined = undefined;
  export let addPhysicalTocPage: boolean = false;
  export let currentTocPath: TocItem[] = [];
  export let prefetchPageNum: number = 0;

  const dispatch = createEventDispatcher();

  let gridPages: {pageNum: number; canvasId: string}[] = [];
  let pdfServiceInstance: PDFService | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let scrollContainer: HTMLElement;
  let canvasElement: HTMLCanvasElement;

  let canvasesToObserve: HTMLCanvasElement[] = [];

  let isSelecting = false;
  let selectionStartPage = 0;

  let pressTimer: number | null = null;
  let loadedFilename: string = '';

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

  const unsubscribePdfService = pdfService.subscribe((val) => (pdfServiceInstance = val));

  function safeCancel(task: RenderTask | null | undefined) {
    if (!task) return;
    try {
      task.cancel();
    } catch (e) {
      // Ignore cancellation errors
    }
  }

  function cleanupObservers() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    stopAutoScroll();
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  onDestroy(() => {
    unsubscribePdfService();
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

  $: currentPageLabel = (originalPdfInstance && $tocConfig.pageLabelSettings.enabled) 
    ? formatPageLabel(currentPage - 1, $tocConfig.pageLabelSettings, activeTotalPages)
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


  $: if (originalPdfInstance && filename && filename !== loadedFilename) {
    loadedFilename = filename;
    tick().then(() => {
      dispatch('fileloaded', {
        message: $t('msg.pdf_loaded'),
        type: 'success',
      });
    });
  }

  $: if (!originalPdfInstance) {
    lastPageId = '';
    gridPages = [];
    cleanupObservers();
  }

  async function renderCurrentPage() {
    if (!originalPdfInstance || !currentPage || !scale || !canvasElement) return;
    
    const pageId = getPageId(currentPage);
    const { instance, localPageNum } = getVirtualPageInfo(currentPage);
    if (!instance) return;

    try {
      const page = await instance.getPage(localPageNum);
      const viewportOrig = page.getViewport({ scale: 1.0 });

      // Calculate relative fit scale
      let baseFitScale = 1.0;
      if (containerWidth > 0 && containerHeight > 0) {
        baseFitScale = Math.min((containerWidth - 40) / viewportOrig.width, (containerHeight - 40) / viewportOrig.height);
      }
      
      const displayScale = scale * baseFitScale;
      const viewport = page.getViewport({ scale: displayScale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.floor(viewport.width * dpr);
      const targetH = Math.floor(viewport.height * dpr);

      // Simple Redundancy Check: if page and canvas size haven't changed, skip
      if (lastPageId === pageId && canvasElement.width === targetW && canvasElement.height === targetH) {
        page.cleanup();
        return;
      }

      const isNewPage = lastPageId !== pageId;
      lastPageId = pageId;

      const ctx = canvasElement.getContext('2d', { alpha: false });
      if (ctx) {
        canvasElement.width = targetW;
        canvasElement.height = targetH;
        canvasElement.style.width = `${Math.floor(viewport.width)}px`;
        canvasElement.style.height = `${Math.floor(viewport.height)}px`;
        if (isNewPage) {
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, targetW, targetH);
        }
      }

      const bitmap = await renderQueue.enqueue(pageId, instance, localPageNum, 0);
      const ctxFinal = canvasElement.getContext('2d', { alpha: false });
      if (!ctxFinal) return;

      ctxFinal.clearRect(0, 0, targetW, targetH);
      ctxFinal.drawImage(bitmap, 0, 0, targetW, targetH);
      page.cleanup();
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') console.error('Rendering error:', e);
    }
  }

  $: if (mode === 'single' && originalPdfInstance && currentPage && scale && containerWidth && containerHeight && (tocPdfInstance || true)) {
    renderCurrentPage();
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

  async function autoScrollToActiveRange() {
    if (mode !== 'grid' || !scrollContainer) return;
    const range = tocRanges[activeRangeIndex];
    if (!range) return;

    const targetPage = range.start;
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

  $: if (activeRangeIndex >= 0 && mode === 'grid') {
    autoScrollToActiveRange();
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
    renderQueue.enqueue(pageId, instance, localPageNum, 5);
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


  function observeViewport(node: HTMLElement) {
    scrollContainer = node;

    if (intersectionObserver) intersectionObserver.disconnect();

    intersectionObserver = new IntersectionObserver(
      async (entries) => {
        entries.forEach(async (entry) => {
          if (entry.isIntersecting) {
            const canvas = entry.target as HTMLCanvasElement;
            const pageNum = parseInt(canvas.dataset.pageNum || '0', 10);

            if (pageNum > 0 && originalPdfInstance) {
              const { instance, localPageNum } = getVirtualPageInfo(pageNum);
              if (!instance) return;

              const dpr = Math.min(window.devicePixelRatio || 1, 2);
              const canvasWidth = canvas.clientWidth;
              
              // Determine scale for grid view (thumbnails)
              // We'll use a fixed width for the scale calculation to be consistent
              const page = await instance.getPage(localPageNum);
              const viewport = page.getViewport({ scale: 1.0 });
              const scale = canvasWidth / viewport.width;
              
              const pageId = getPageId(pageNum);
              
              const bitmap = await renderQueue.enqueue(pageId, instance, localPageNum, 1);
              
              const ctx = canvas.getContext('2d', { alpha: false });
              if (!ctx) return;
              
              canvas.width = Math.floor(viewport.width * scale * dpr);
              canvas.height = Math.floor(viewport.height * scale * dpr);
              canvas.style.width = `${canvasWidth}px`;
              canvas.style.height = 'auto';

              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

              page.cleanup();

              if (intersectionObserver) {
                intersectionObserver.unobserve(canvas);
              }
            }
          }
        });
      },
      {
        root: node,
        rootMargin: '300px',
      },
    );

    canvasesToObserve.forEach((canvas) => {
      if (intersectionObserver) {
        intersectionObserver.observe(canvas);
      }
    });
    canvasesToObserve = [];

    return {
      destroy() {
        if (intersectionObserver) {
          intersectionObserver.disconnect();
          intersectionObserver = null;
        }
      },
    };
  }

  function lazyRender(canvas: HTMLCanvasElement, {pageNum}: {pageNum: number}) {
    canvas.dataset.pageNum = pageNum.toString();

    if (intersectionObserver) {
      intersectionObserver.observe(canvas);
    } else {
      canvasesToObserve.push(canvas);
    }

    return {
      destroy() {
        if (intersectionObserver) {
          intersectionObserver.unobserve(canvas);
        } else {
          canvasesToObserve = canvasesToObserve.filter((c) => c !== canvas);
        }
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
              class="p-1 py-0.5 rounded-lg hover:bg-gray-100 text-black border-2 border-black shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs"
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
        <div class="m-auto p-4 max-w-full">
          <canvas
            class="max-w-full block"
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
          class="relative rounded-lg overflow-hidden border-t-[2px] border-l-[2px] cursor-pointer bg-white transition-all duration-150 transform border-2"
          class:shadow-[3px_3px_0px]={isSelected}
          class:shadow-blue-400={isSelected && isActive}
          class:shadow-gray-400={isSelected && !isActive}
          class:border-blue-500={isSelected && isActive}
          class:border-gray-500={(isSelected && !isActive) || !isSelected}
          class:scale-[1.02]={isSelected}
          style="-webkit-touch-callout: none;"
          on:mousedown={() => handleMouseDown(page.pageNum)}
          on:touchstart={() => handleTouchStart(page.pageNum)}
          on:mouseenter={() => handleMouseEnter(page.pageNum)}
          on:dragstart|preventDefault
          role="gridcell"
          tabindex="0"
        >
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
