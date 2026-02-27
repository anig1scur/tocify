<script lang="ts">
  import {fade} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {createEventDispatcher} from 'svelte';
  import Dropzone from 'svelte-file-dropzone';

  import DropzoneView from '../DropzoneView.svelte';
  import PDFViewer from '../PDFViewer.svelte';
  import PDFControls from '../PDFControls.svelte';

  export let isFileLoading = false;
  export let isDragging = false;
  export let pdfState: any;
  export let originalPdfInstance: any;
  export let tocPdfInstance: any;

  export let isPreviewMode = false;
  export let isPreviewLoading = false;

  export let tocRanges: {start: number; end: number; id: string}[];
  export let activeRangeIndex: number;
  export let addPhysicalTocPage: boolean;
  export let tocPageCount: number;
  export let currentTocPath: any[] = []; // TocItem[]
  export let prefetchPageNum: number = 0;

  export let jumpToTocPage: () => Promise<void>;

  const dispatch = createEventDispatcher();
  let fileInputRef: HTMLInputElement;

  function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      dispatch('fileselect', target.files[0]);
      target.value = '';
    }
  }

  function handleDrop(e: CustomEvent) {
    isDragging = false;
    const {acceptedFiles} = e.detail;
    if (acceptedFiles.length) {
      dispatch('fileselect', acceptedFiles[0]);
    }
  }

  function forwardFileLoadedEvent(e: CustomEvent) {
    dispatch('viewerMessage', e.detail);
  }
</script>

<div class="flex flex-col w-full lg:w-[70%]">
  <div
    class="h-fit pb-4 min-h-[85vh] top-5 sticky border-black border-2 rounded-lg bg-white shadow-[2px_2px_0px_rgba(0,0,0,1)]"
  >
    {#if isFileLoading}
      <div
        class="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-50 rounded-lg"
        transition:fade={{duration: 100}}
      >
        <div class="flex flex-col items-center gap-4">
          <div class="animate-spin rounded-full h-12 w-12 border-4 border-black border-t-transparent"></div>
          <span class="text-xl font-bold">{$t('status.loading_rendering')}</span>
        </div>
      </div>
    {:else}
      <Dropzone
        containerClasses="absolute inset-0 w-full h-full"
        accept=".pdf"
        disableDefaultStyles
        on:drop={handleDrop}
        on:dragenter={() => (isDragging = true)}
        on:dragleave={() => (isDragging = false)}
      >
        <DropzoneView
          {isDragging}
          hasInstance={!!pdfState.instance}
        />
      </Dropzone>
    {/if}

    {#if pdfState.instance}
      <div class="relative z-10 h-full flex flex-col">
        <PDFViewer
          bind:pdfState
          mode={isPreviewMode ? 'single' : 'grid'}
          {originalPdfInstance}
          {tocPdfInstance}
          {tocPageCount}
          {tocRanges}
          {activeRangeIndex}
          on:updateActiveRange
          on:fileloaded={forwardFileLoadedEvent}
          {jumpToTocPage}
          {addPhysicalTocPage}
          {currentTocPath}
          {prefetchPageNum}
        />

        <input
          type="file"
          class="hidden"
          accept=".pdf"
          bind:this={fileInputRef}
          on:change={handleFileInputChange}
        />

        <PDFControls
          {isPreviewLoading}
          {isPreviewMode}
          {originalPdfInstance}
          doc={pdfState.doc}
          on:triggerUpload={() => fileInputRef?.click()}
          on:togglePreview={() => dispatch('togglePreview')}
          on:export={() => dispatch('export')}
        />
      </div>
    {/if}
  </div>
</div>
