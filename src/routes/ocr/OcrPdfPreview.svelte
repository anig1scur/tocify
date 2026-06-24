<script lang="ts">
  import { t } from 'svelte-i18n';
  import { ChevronLeft, ChevronRight, Download, Loader2, RotateCw, Upload, ZoomIn, ZoomOut } from 'lucide-svelte';

  import '../../lib/i18n';
  import DropzoneView from '../../components/DropzoneView.svelte';
  import type { DragMode } from '$lib/ocr/types';

  type OverlayRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  export let pdfFile: File | null = null;
  export let pdfPageCount = 0;
  export let selectedPageNumber = 1;
  export let selectedLineIndex = 0;
  export let selectedLines: any[] = [];
  export let previewScale = 1;
  export let previewRenderKey = '';
  export let previewRenderedKey = '';
  export let previewCanvas: HTMLCanvasElement | null = null;
  export let previewWrapWidth = 0;
  export let previewWrapHeight = 0;
  export let previewScrollContainer: HTMLDivElement | null = null;
  export let previewEditingLineIndex: number | null = null;
  export let previewEditingPageNumber: number | null = null;
  export let previewEditingText = '';
  export let previewEditingTextarea: HTMLTextAreaElement | null = null;
  export let newSelectionState: any = null;
  export let resizeHandles: [DragMode, string][] = [];
  export let isPreviewDragging = false;
  export let isFileLoading = false;
  export let isBuilding = false;

  export let handleFileChange: (event: Event) => void | Promise<void> = () => undefined;
  export let handlePreviewDragEnter: (event: DragEvent) => void = () => undefined;
  export let handlePreviewDragOver: (event: DragEvent) => void = () => undefined;
  export let handlePreviewDragLeave: (event: DragEvent) => void = () => undefined;
  export let handleDrop: (event: DragEvent) => void | Promise<void> = () => undefined;
  export let goToPreviousPreviewPage: () => void = () => undefined;
  export let goToNextPreviewPage: () => void = () => undefined;
  export let zoomPreviewOut: () => void = () => undefined;
  export let zoomPreviewIn: () => void = () => undefined;
  export let resetPreviewZoom: () => void = () => undefined;
  export let startNewSelection: (event: PointerEvent) => void = () => undefined;
  export let handlePreviewPointerMove: (event: PointerEvent) => void = () => undefined;
  export let finishBBoxDrag: (event: PointerEvent) => void = () => undefined;
  export let selectLine: (pageNumber: number, lineIndex: number, options?: { locatePreview?: boolean }) => void = () => undefined;
  export let startBBoxDrag: (event: PointerEvent, mode: DragMode, line?: any, lineIndex?: number) => void = () => undefined;
  export let startPreviewTextEdit: (lineIndex: number) => void | Promise<void> = () => undefined;
  export let commitPreviewTextEdit: () => void = () => undefined;
  export let cancelPreviewTextEdit: () => void = () => undefined;
  export let getOverlayRect: (line: any) => OverlayRect | null = () => null;
  export let getNewSelectionBBox: () => [number, number, number, number] | null = () => null;
  export let imageBBoxToOverlayRect: (bbox: [number, number, number, number]) => OverlayRect | null = () => null;
  export let generateSearchablePdf: () => void | Promise<void> = () => undefined;

  let fileInput: HTMLInputElement | null = null;

  function handlePreviewPageInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const nextPage = parseInt(input.value, 10);
    if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= Math.max(1, pdfPageCount)) {
      selectedPageNumber = nextPage;
      selectedLineIndex = 0;
    } else {
      input.value = String(selectedPageNumber);
    }
  }

  function openFilePicker() {
    fileInput?.click();
  }

  function handleDropzoneKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker();
    }
  }
</script>

<main class="flex flex-col w-full lg:w-[70%] min-w-0 h-fit lg:sticky lg:top-5 lg:self-start">
  <div
    class="relative h-fit pb-4 min-h-[85vh] border-black border-2 rounded-lg bg-white shadow-[2px_2px_0px_rgba(0,0,0,1)]"
    role="region"
    aria-label={$t('ocr_lab.pdf_preview_title')}
    on:dragenter={handlePreviewDragEnter}
    on:dragover={handlePreviewDragOver}
    on:dragleave={handlePreviewDragLeave}
    on:drop={handleDrop}
  >
    <input bind:this={fileInput} type="file" accept="application/pdf" class="hidden" on:change={handleFileChange} />

    {#if pdfFile}
      <div class="relative z-10 h-full flex flex-col">
        <div class="h-[85vh] rounded-lg relative w-full bg-white">
          <div class="flex flex-col h-full absolute w-full inset-0 z-10 bg-white rounded-md">
            <div class="flex items-center flex-col justify-start w-full px-2 md:px-4 py-2 bg-white border-b-2 border-black rounded-t-md overflow-x-auto">
              <div class="flex z-10 items-center justify-between w-full">
                <div class="w-[70%] text-gray-600 font-serif flex gap-1 sm:gap-2 items-center text-sm md:text-base">
                  <span class="truncate">{pdfFile.name}</span>
                  <span class="text-gray-300">|</span>
                  <div class="flex items-center gap-1 flex-nowrap">
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, pdfPageCount)}
                      value={selectedPageNumber}
                      on:change={handlePreviewPageInput}
                      class="w-15 text-center border-b border-gray-300 focus:border-black outline-none bg-transparent p-0 text-gray-800"
                    />
                    <span class="min-w-12">/ {pdfPageCount || 0}</span>
                  </div>
                </div>

                <div class="flex items-center gap-1 w-[30%] flex-[0]">
                  <button on:click={zoomPreviewOut} class="p-1 md:p-2 rounded-lg hover:bg-gray-100 text-gray-600" title={$t('tooltip.zoom_out')}>
                    <ZoomOut size={20} />
                  </button>
                  <span class="min-w-[30px] text-center text-gray-600 text-sm md:text-base md:min-w-[40px]">
                    {Math.round(previewScale * 100)}%
                  </span>
                  <button on:click={zoomPreviewIn} class="p-1 md:p-2 rounded-lg hover:bg-gray-100 text-gray-600" title={$t('tooltip.zoom_in')}>
                    <ZoomIn size={20} />
                  </button>
                  <button on:click={resetPreviewZoom} class="p-1 md:p-2 rounded-lg hover:bg-gray-100 text-gray-600" title={$t('tooltip.reset')}>
                    <RotateCw size={20} />
                  </button>
                </div>
              </div>
            </div>

            <div
              class="relative flex-1 overflow-hidden bg-gray-50 single-view-container"
              bind:clientWidth={previewWrapWidth}
              bind:clientHeight={previewWrapHeight}
            >
              <button
                on:click={goToPreviousPreviewPage}
                disabled={selectedPageNumber <= 1}
                class="absolute left-2 top-1/2 -translate-y-1/2 p-1 md:left-4 md:p-2 rounded-full bg-white shadow-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed z-20 border-2 border-black"
              >
                <ChevronLeft size={24} />
              </button>

              <div bind:this={previewScrollContainer} class="w-full h-full overflow-auto flex">
                <div class="m-auto p-4 min-w-max min-h-max">
                  <div class="relative mx-auto w-fit">
                    <canvas
                      bind:this={previewCanvas}
                      class="block bg-white cursor-crosshair"
                      on:pointerdown={startNewSelection}
                      on:pointermove={handlePreviewPointerMove}
                      on:pointerup={finishBBoxDrag}
                      on:pointercancel={finishBBoxDrag}
                    ></canvas>

                    {#if selectedLines.length && previewCanvas && previewRenderedKey === previewRenderKey}
                      <div class="absolute inset-0 pointer-events-none">
                        {#each selectedLines as line, lineIndex}
                          {@const overlayRect = getOverlayRect(line)}
                          {#if overlayRect}
                            <button
                              type="button"
                              class="group absolute pointer-events-auto cursor-move border-2 transition-colors {lineIndex === selectedLineIndex ? 'border-yellow-500 bg-yellow-300/35' : 'border-sky-400 bg-sky-200/20 hover:bg-sky-200/30'}"
                              style:left={`${overlayRect.left}px`}
                              style:top={`${overlayRect.top}px`}
                              style:width={`${Math.max(4, overlayRect.width)}px`}
                              style:height={`${Math.max(4, overlayRect.height)}px`}
                              title={line.text}
                              on:click={() => selectLine(Number(selectedPageNumber), lineIndex)}
                              on:dblclick|stopPropagation|preventDefault={() => startPreviewTextEdit(lineIndex)}
                              on:pointerdown={(event) => {
                                selectLine(Number(selectedPageNumber), lineIndex, { locatePreview: false });
                                startBBoxDrag(event, 'move', line, lineIndex);
                              }}
                            >
                              {#if lineIndex === selectedLineIndex}
                                {#each resizeHandles as handle}
                                  <span
                                    class="absolute w-3 h-3 bg-white border-2 border-yellow-600 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 {handle[1]}"
                                    on:pointerdown|stopPropagation={(event) => startBBoxDrag(event, handle[0], line, lineIndex)}
                                  ></span>
                                {/each}
                              {/if}
                            </button>
                            {#if previewEditingLineIndex === lineIndex && Number(previewEditingPageNumber) === Number(selectedPageNumber)}
                              <textarea
                                bind:this={previewEditingTextarea}
                                bind:value={previewEditingText}
                                rows="1"
                                class="absolute z-30 pointer-events-auto resize-none rounded-md border-2 border-black bg-yellow-50/95 px-2 py-1 text-xs leading-snug text-gray-900 shadow-[2px_2px_0px_rgba(0,0,0,1)] outline-none"
                                style:left={`${overlayRect.left}px`}
                                style:top={`${overlayRect.top}px`}
                                style:width={`${Math.max(140, overlayRect.width)}px`}
                                style:min-height={`${Math.max(34, overlayRect.height)}px`}
                                spellcheck="false"
                                on:dblclick|stopPropagation
                                on:pointerdown|stopPropagation
                                on:keydown={(event) => {
                                  if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    commitPreviewTextEdit();
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelPreviewTextEdit();
                                  }
                                }}
                                on:blur={commitPreviewTextEdit}
                              ></textarea>
                            {/if}
                          {/if}
                        {/each}
                      </div>
                    {/if}

                    {#if newSelectionState && previewRenderedKey === previewRenderKey}
                      {@const newSelectionBBox = getNewSelectionBBox()}
                      {@const newSelectionRect = newSelectionBBox ? imageBBoxToOverlayRect(newSelectionBBox) : null}
                      {#if newSelectionRect}
                        <div
                          class="absolute pointer-events-none border-2 border-dashed border-emerald-700 bg-emerald-300/20"
                          style:left={`${newSelectionRect.left}px`}
                          style:top={`${newSelectionRect.top}px`}
                          style:width={`${Math.max(4, newSelectionRect.width)}px`}
                          style:height={`${Math.max(4, newSelectionRect.height)}px`}
                        ></div>
                      {/if}
                    {/if}
                  </div>
                </div>
              </div>

              <button
                on:click={goToNextPreviewPage}
                disabled={selectedPageNumber >= Math.max(1, pdfPageCount)}
                class="absolute right-2 top-1/2 -translate-y-1/2 p-1 md:right-4 md:p-2 rounded-full bg-white shadow-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed z-20 border-2 border-black"
              >
                <ChevronRight size={24} />
              </button>
            </div>
          </div>
        </div>

        <div class="flex flex-col md:flex-row md:justify-end gap-3 md:gap-2 pt-4 relative z-10 mx-3 md:mr-3 md:mx-0">
          <button
            class="btn flex gap-2 items-center justify-center font-bold bg-white text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 w-full md:w-auto"
            on:click={openFilePicker}
            title={$t('tooltip.upload_new')}
          >
            <Upload size={16} />
            {$t('btn.upload_new')}
          </button>
          <button
            class="btn flex gap-2 items-center justify-center font-bold bg-green-500 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 w-full md:w-auto {(!pdfFile || isFileLoading) ? 'disabled:bg-gray-300 disabled:cursor-not-allowed' : 'disabled:bg-green-500 disabled:cursor-wait'}"
            on:click={generateSearchablePdf}
            disabled={!pdfFile || isFileLoading || isBuilding}
            aria-busy={isBuilding}
            title={$t('tooltip.export_pdf')}
          >
            {#if isBuilding}
              <Loader2 size={16} class="animate-spin" />
            {:else}
              <Download size={16} />
            {/if}
            {$t('btn.generate_pdf')}
          </button>
        </div>
      </div>
    {:else}
      <div
        class="absolute inset-0"
        role="button"
        tabindex="0"
        on:click={openFilePicker}
        on:keydown={handleDropzoneKeydown}
      >
        <DropzoneView isDragging={isPreviewDragging} hasInstance={false} />
      </div>
    {/if}

    {#if pdfFile && isPreviewDragging}
      <div class="absolute inset-0 z-30">
        <DropzoneView isDragging={true} hasInstance={true} />
      </div>
    {/if}

    {#if isFileLoading}
      <div class="absolute inset-0 z-40 bg-white/80 flex items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-4 border-black border-t-transparent"></div>
      </div>
    {/if}
  </div>
</main>
