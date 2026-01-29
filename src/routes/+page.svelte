<script lang="ts">
  import {onMount, onDestroy, tick} from 'svelte';
  import {slide, fade, fly} from 'svelte/transition';
  import {t, isLoading} from 'svelte-i18n';
  import {injectAnalytics} from '@vercel/analytics/sveltekit';
  import type * as PdfjsLibTypes from 'pdfjs-dist';
  import {init, trackEvent} from '@aptabase/web';

  import '../lib/i18n';
  import {pdfService, tocItems, curFileFingerprint, tocConfig, autoSaveEnabled, type TocConfig} from '../stores';
  import {PDFService, type PDFState, type TocItem} from '../lib/pdf-service';
  import {setOutline} from '../lib/pdf-outliner';
  import {debounce} from '../lib';
  import {buildTree, convertPdfJsOutlineToTocItems, setNestedValue, findActiveTocPath} from '$lib/utils';
  import {generateToc} from '$lib/toc-service';
  import {applyCustomPrefix, DEFAULT_PREFIX_CONFIG, type LevelConfig} from '$lib/prefix-service';

  import Toast from '../components/Toast.svelte';
  import Footer from '../components/Footer.svelte';

  import AiLoadingModal from '../components/modals/AiLoadingModal.svelte';
  import OffsetModal from '../components/modals/OffsetModal.svelte';
  import HelpModal from '../components/modals/HelpModal.svelte';
  import StarRequestModal from '../components/modals/StarRequestModal.svelte';

  import DownloadBanner from '../components/DownloadBanner.svelte';
  import SidebarPanel from '../components/panels/SidebarPanel.svelte';
  import PreviewPanel from '../components/panels/PreviewPanel.svelte';
  import SeoJsonLd from '../components/SeoJsonLd.svelte';

  import TocRelation from '../components/KnowledgeBoard.svelte';
  import {ChevronRight, ChevronLeft} from 'lucide-svelte';

  injectAnalytics();

  let pdfjs: typeof PdfjsLibTypes | null = null;
  let PdfLib: typeof import('pdf-lib') | null = null;

  let isDragging = false;
  let isFileLoading = false;
  let isAiLoading = false;
  let isPreviewLoading = false;
  let isTocConfigExpanded = false;
  let showNextStepHint = false;
  let hasShownTocHint = false;

  let showGraphDrawer = false;
  let isGraphEntranceVisible = true;

  let showOffsetModal = false;
  let showHelpModal = false;
  let showStarRequestModal = false;
  let offsetPreviewPageNum = 1;

  let toastProps = {
    show: false,
    message: '',
    type: 'success' as 'success' | 'error' | 'info',
  };

  let originalPdfInstance: PdfjsLibTypes.PDFDocumentProxy | null = null;
  let previewPdfInstance: PdfjsLibTypes.PDFDocumentProxy | null = null;
  let offsetRenderTask: PdfjsLibTypes.RenderTask | null = null;

  let pdfState: PDFState = {
    doc: null,
    newDoc: null,
    instance: null,
    filename: '',
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
  };

  let tocRanges = [{start: 1, end: 1, id: 'default'}];
  let activeRangeIndex = 0;
  let tocPageCount = 0;
  let addPhysicalTocPage = false;
  let isPreviewMode = false;
  let pendingTocItems: TocItem[] = [];
  let firstTocItem: TocItem | null = null;
  let aiError: string | null = null;
  let config: TocConfig;

  let lastPdfContentJson = '';
  let lastInsertAtPage = 2;

  let customApiConfig = {
    provider: '',
    apiKey: '',
    doubaoEndpointIdText: '',
    doubaoEndpointIdVision: '',
  };

  onMount(() => {
    $pdfService = new PDFService();
  });

  onMount(() => {
    init('A-US-0422911470');
    trackEvent('app_started', {
      platform: window.__TAURI__ ? 'desktop' : 'web',
      version: '1.0.0',
    });

    const hideUntil = localStorage.getItem('tocify_hide_graph_entrance_until');
    if (hideUntil) {
      const expiry = parseInt(hideUntil, 10);
      if (Date.now() < expiry) {
        isGraphEntranceVisible = false;
      } else {
        localStorage.removeItem('tocify_hide_graph_entrance_until');
      }
    }
  });

  onDestroy(async () => {
    unsubscribeTocItems();
    if (originalPdfInstance) {
      try {
        await originalPdfInstance.destroy();
      } catch (e) {
        console.warn('Error destroying original instance:', e);
      }
    }
    if (previewPdfInstance && previewPdfInstance !== originalPdfInstance) {
      try {
        await previewPdfInstance.destroy();
      } catch (e) {
        console.warn('Error destroying preview instance:', e);
      }
    }
  });

  function getPdfEffectiveData(items: TocItem[]): any[] {
    return items.map((item) => ({
      title: item.title,
      to: item.to,
      children: item.children ? getPdfEffectiveData(item.children) : [],
    }));
  }

  $: {
    config = $tocConfig;
    if (isPreviewMode && !isFileLoading) {
      debouncedUpdatePDF();
    }
  }

  $: currentTocPath = findActiveTocPath(
      $tocItems,
      pdfState.currentPage,
      $tocConfig.pageOffset || 0,
      addPhysicalTocPage,
      tocPageCount,
      config.insertAtPage
  );


  $: if (showOffsetModal) {
    offsetPreviewPageNum = tocRanges[0]?.end + 1 || 1;
    cleanupOffsetRenderTask();
  } else {
    cleanupOffsetRenderTask();
  }

  function cleanupOffsetRenderTask() {
    if (offsetRenderTask) {
      try {
        offsetRenderTask.cancel();
      } catch (e) {
      }
      offsetRenderTask = null;
    }
  }

  let previousAddPhysicalTocPage = addPhysicalTocPage;
  $: {
    if (pdfState.doc && previousAddPhysicalTocPage !== addPhysicalTocPage && !isFileLoading) {
      previousAddPhysicalTocPage = addPhysicalTocPage;
      if (!isPreviewMode) {
        togglePreviewMode();
      }
      toggleShowInsertTocHint();
      if (isPreviewMode) {
        debouncedUpdatePDF();
      }
    }
  }

  $: {
    if (
      showOffsetModal &&
      offsetPreviewPageNum > 0 &&
      offsetPreviewPageNum <= (originalPdfInstance?.numPages || 0) &&
      originalPdfInstance &&
      $pdfService
    ) {
      (async () => {
        await tick();
        renderOffsetPreviewPage(offsetPreviewPageNum);
      })();
    }
  }

  const debouncedUpdatePDF = debounce(updatePDF, 300);

  const toggleShowInsertTocHint = () => {
    if (!hasShownTocHint && addPhysicalTocPage && $tocItems.length > 0) {
      toastProps = {
        show: true,
        message: `ToC pages will be inserted at page ${config.insertAtPage || 2}. You can change it in Settings.`,
        type: 'info',
      };
      setTimeout(() => {
        hasShownTocHint = true;
      }, 2000);
    }
  };

  const unsubscribeTocItems = tocItems.subscribe((items) => {
    if (items.length > 0) showNextStepHint = false;
    if (isFileLoading) return;

    if (!isPreviewMode) return;

    toggleShowInsertTocHint();
    if (isDragging) return;
    const currentContentJson = JSON.stringify(getPdfEffectiveData(items));

    if (currentContentJson === lastPdfContentJson) {
      return;
    }

    lastPdfContentJson = currentContentJson;
    debouncedUpdatePDF();
  });

  const loadPdfLibraries = async () => {
    if (pdfjs && PdfLib) return;
    try {
      const [pdfjsModule, PdfLibModule] = await Promise.all([import('pdfjs-dist'), import('pdf-lib')]);
      pdfjs = pdfjsModule;
      PdfLib = PdfLibModule;
    } catch (error) {
      console.error('Failed to load PDF libraries:', error);
      toastProps = {
        show: true,
        message: 'Failed to load core components. Please refresh and try again.',
        type: 'error',
      };
      throw new Error('Failed to load PDF libraries', {cause: error});
    }
  };

  function updateTocField(fieldPath: string, value: any) {
    tocConfig.update((cfg) => {
      return setNestedValue(cfg, fieldPath, value);
    });
  }

  const updateViewerInstance = () => {
    if (isPreviewMode && previewPdfInstance) {
      pdfState.instance = previewPdfInstance;
      pdfState.totalPages = previewPdfInstance.numPages;
    } else if (originalPdfInstance) {
      pdfState.instance = originalPdfInstance;
      pdfState.totalPages = originalPdfInstance.numPages;
    } else {
      pdfState.instance = null;
      pdfState.totalPages = 0;
    }
    pdfState = {...pdfState};
  };

  async function updatePDF() {
    if (!pdfState.doc || !$pdfService) return;
    if (!pdfjs || !PdfLib) {
      console.error('PDF libraries not loaded.');
      toastProps = {show: true, message: 'Components not loaded. Please reupload your file.', type: 'error'};
      return;
    }

    try {
      const settings = config.prefixSettings;
      const tocItems_ = settings.enabled ? applyCustomPrefix($tocItems, settings.configs) : $tocItems;
      const currentPageBackup = pdfState.currentPage;

      let newDoc = pdfState.doc;

      const currentInsertPage = config.insertAtPage || 2;
      if (addPhysicalTocPage) {
        if (currentInsertPage !== lastInsertAtPage) {
          await $pdfService.initPreview(pdfState.doc);
          lastInsertAtPage = currentInsertPage;
        }

        const res = await $pdfService.updateTocPages(tocItems_, config, currentInsertPage);
        newDoc = res.newDoc;
        tocPageCount = res.tocPageCount;
      } else {
        newDoc = await pdfState.doc.copy();
        tocPageCount = 0;
      }

      setOutline(newDoc, tocItems_, config.pageOffset, tocPageCount);
      const pdfBytes = await newDoc.save({
        useObjectStreams: false,
      });

      const loadingTask = pdfjs.getDocument({
        data: pdfBytes,
        worker: PDFService.sharedWorker,
      });

      const newPreviewInstance = await loadingTask.promise;

      if (previewPdfInstance && previewPdfInstance !== originalPdfInstance) {
        try {
          await previewPdfInstance.destroy();
        } catch (e) {
          console.warn('Error destroying old preview instance:', e);
        }
      }

      previewPdfInstance = newPreviewInstance;
      pdfState.newDoc = newDoc;

      if (isPreviewMode) {
        if (currentPageBackup <= pdfState.totalPages) {
          pdfState.currentPage = currentPageBackup;
        } else {
          pdfState.currentPage = 1;
        }
      } else {
        pdfState.instance = originalPdfInstance;
      }
      updateViewerInstance();
    } catch (error) {
      console.error('Error updating PDF:', error);
      const msg =
        error.name === 'InvalidPDFException'
          ? 'The PDF structure is too old or corrupted to generate a preview.'
          : error.message;
      toastProps = {show: true, message: `Error updating PDF: ${msg}`, type: 'error'};
    }
  }

  const togglePreviewMode = async () => {
    if (!originalPdfInstance) return;

    if (!isPreviewMode) {
      isPreviewLoading = true;
      try {
        if (!previewPdfInstance || previewPdfInstance === originalPdfInstance) {
          await updatePDF();
        }

        isPreviewMode = true;
        toggleShowInsertTocHint();
        await tick();
      } catch (error) {
        console.error('Error generating preview:', error);
        toastProps = {show: true, message: `Error generating preview: ${error.message}`, type: 'error'};
        isPreviewMode = false;
      } finally {
        isPreviewLoading = false;
      }
    } else {
      isPreviewMode = false;
    }

    updateViewerInstance();
  };

  const renderOffsetPreviewPage = async (pageNum: number) => {
    if (!originalPdfInstance || !$pdfService || !showOffsetModal) return;
    
    cleanupOffsetRenderTask();

    const canvas = document.getElementById('offset-preview-canvas') as HTMLCanvasElement;
    if (canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const renderWidth = canvas.clientWidth * dpr;
      if (renderWidth === 0) {
        setTimeout(() => renderOffsetPreviewPage(pageNum), 100);
        return;
      }
      
      const task = await $pdfService.renderPageToCanvas(originalPdfInstance, pageNum, canvas, renderWidth);
      if (task) {
        offsetRenderTask = task;
        task.promise.finally(() => {
          if (offsetRenderTask === task) {
            offsetRenderTask = null;
          }
        });
      }
    }
  };

  const loadPdfFile = async (file: File) => {
    if (!file) return;

    const fingerprint = `${file.name}_${file.size}`;

    curFileFingerprint.set(fingerprint);
    localStorage.setItem('tocify_last_fingerprint', fingerprint);

    isFileLoading = true;
    autoSaveEnabled.set(false);
    showNextStepHint = false;
    hasShownTocHint = false;
    showOffsetModal = false;
    cleanupOffsetRenderTask();
    
    pendingTocItems = [];
    firstTocItem = null;

    tocItems.set([]);
    await tick();

    if (originalPdfInstance) {
      try {
        await originalPdfInstance.destroy();
      } catch (e) {
        console.warn('Error destroying original instance:', e);
      }
    }
    if (previewPdfInstance && previewPdfInstance !== originalPdfInstance) {
      try {
        await previewPdfInstance.destroy();
      } catch (e) {
        console.warn('Error destroying preview instance:', e);
      }
    }

    pdfState.instance = null;
    originalPdfInstance = null;
    previewPdfInstance = null;
    pdfState = {...pdfState};
    await tick();

    pdfState.filename = file.name;
    pdfState.totalPages = 0;

    try {
      await loadPdfLibraries();

      if (!pdfjs || !PdfLib) {
        return;
      }

      const {PDFDocument} = PdfLib;

      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      pdfState.doc = await PDFDocument.load(uint8Array);
      PDFService.sanitizePdfMetadata(pdfState.doc);

      if ($pdfService) {
        const initPage = config.insertAtPage || 2;
        lastInsertAtPage = initPage;
        await $pdfService.initPreview(pdfState.doc);

        const firstPage = pdfState.doc.getPage(1) || pdfState.doc.getPage(0);
        const {width} = firstPage.getSize();
        const autoLayout = PDFService.getAutoLayout(width);
        
        tocConfig.update(c => ({
          ...c,
          firstLevel: { ...c.firstLevel, fontSize: autoLayout.fontSizeL1 },
          otherLevels: { ...c.otherLevels, fontSize: autoLayout.fontSizeLOther }
        }));
      }

      const loadingTask = pdfjs.getDocument({
        data: uint8Array,
        worker: PDFService.sharedWorker,
      });
      originalPdfInstance = await loadingTask.promise;

      previewPdfInstance = originalPdfInstance;
      isPreviewMode = false;
      tocPageCount = 0;
      pdfState.currentPage = 1;
      tocRanges = [{start: 1, end: 1, id: 'default'}];
      activeRangeIndex = 0;

      const session = localStorage.getItem(`toc_draft_${fingerprint}`);

      if (session) {
        const {items, pageOffset} = JSON.parse(session);
        tocItems.set(items);
        updateTocField('pageOffset', pageOffset);
      } else {
        try {
          const existingOutline = await originalPdfInstance.getOutline();

          if (existingOutline && existingOutline.length > 0) {
            const importedItems = await convertPdfJsOutlineToTocItems(existingOutline, originalPdfInstance);
            tocItems.set(importedItems);
            updateTocField('pageOffset', 0);

            toastProps = {show: true, message: 'The raw ToC has been imported from the PDF.', type: 'info'};
          } else {
            tocItems.set([]);
            updateTocField('pageOffset', 0);
          }
        } catch (err) {
          console.warn('PDF load outline error:', err);
          tocItems.set([]);
          updateTocField('pageOffset', 0);
        }
      }

      lastPdfContentJson = JSON.stringify(getPdfEffectiveData($tocItems));

      // auto detect TOC pages
      if ($pdfService && originalPdfInstance) {
        const detected = await $pdfService.detectTocPages(originalPdfInstance);
        if (detected.length > 0) {
          const start = Math.min(...detected);
          const end = Math.max(...detected);
          tocRanges = [{start, end, id: 'detected'}];
          activeRangeIndex = 0;
        }
      }
    } catch (error) {
      console.error('Error loading PDF:', error);
      toastProps = {show: true, message: `Error loading PDF: ${error.message}`, type: 'error'};
    } finally {
      updateViewerInstance();
      await tick();
      isFileLoading = false;
      showNextStepHint = true;
      autoSaveEnabled.set(true);
    }
  };

  const exportPDF = async () => {
    try {
      let fileHandle;
      let writable;
      const isSupported = 'showSaveFilePicker' in window;

      if (isSupported) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: pdfState.filename.replace('.pdf', '_outlined.pdf'),
            types: [
              {
                description: 'PDF Document',
                accept: {'application/pdf': ['.pdf']},
              },
            ],
          });
        } catch (err) {
          if (err.name === 'AbortError') return;
          throw err;
        }
      }

      toastProps = {show: true, message: 'Exporting file...', type: 'info'};

      await updatePDF();
      if (!pdfState.newDoc) {
        toastProps = {show: true, message: 'Error: No PDF document to export.', type: 'error'};
        return;
      }
      const pdfBytes = await pdfState.newDoc.save();

      if (isSupported && fileHandle) {
        writable = await fileHandle.createWritable();
        await writable.write(pdfBytes);
        await writable.close();
      } else {
        const pdfBlob = new Blob([pdfBytes], {type: 'application/pdf'});
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = pdfState.filename.replace('.pdf', '_outlined.pdf');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toastProps = {show: true, message: 'Export Successful!', type: 'success'};

      setTimeout(() => {
        const isDismissed = localStorage.getItem('tocify_hide_star_request') === 'true';
        if (!isDismissed) {
          showStarRequestModal = true;
        }
      }, 1000);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toastProps = {show: true, message: `Error exporting PDF: ${error.message}`, type: 'error'};
    }
  };

  const generateTocFromAI = async () => {
    showNextStepHint = false;

    if (!originalPdfInstance) {
      toastProps = {show: true, message: 'Please load a PDF first.', type: 'error'};
      return;
    }

    isAiLoading = true;
    aiError = null;

    try {
      const res = await generateToc({
        pdfInstance: originalPdfInstance,
        ranges: tocRanges,
        apiKey: customApiConfig.apiKey,
        provider: customApiConfig.provider,
      });

      if (!res || res.length === 0) {
        aiError = 'We could not find a valid ToC on these pages.';
        return;
      }

      const nestedTocItems = buildTree(res);

      pendingTocItems = nestedTocItems;
      firstTocItem = nestedTocItems.length > 0 ? nestedTocItems[0] : null;

      if (firstTocItem) {
        offsetPreviewPageNum = firstTocItem.to;
        showOffsetModal = true;
      } else {
        tocItems.set(nestedTocItems);
        pendingTocItems = [];
      }
    } catch (error) {
      console.error('Error generating ToC from AI:', error);
      aiError = error.message;
      toastProps = {show: true, message: error.message, type: 'error'};
    } finally {
      isAiLoading = false;
    }
  };

  const handleOffsetConfirm = async () => {
    if (!firstTocItem) return;
    const labeledPage = firstTocItem.to;
    const physicalPage = offsetPreviewPageNum;
    const offset = physicalPage - labeledPage;
    updateTocField('pageOffset', offset);

    const hasChinese = pendingTocItems.some((item) => /[\u4e00-\u9fa5]/.test(item.title));
    const rootTitle = hasChinese ? '目录' : 'Contents';
    const firstTitleNormalized = pendingTocItems[0]?.title?.trim().toLowerCase();
    const isDuplicate =
      firstTitleNormalized === '目录' ||
      firstTitleNormalized === 'contents' ||
      firstTitleNormalized === 'table of contents';

    if (!isDuplicate) {
      const rootNode: TocItem = {
        id: `root-${Date.now()}`,
        title: rootTitle,
        to: (tocRanges[0]?.start || 1) - offset,
        children: [],
        open: true,
      };
      pendingTocItems.unshift(rootNode);
    }

    tocItems.set(pendingTocItems);
    showOffsetModal = false;
    pendingTocItems = [];
    firstTocItem = null;

    if (!isPreviewMode) {
      await togglePreviewMode();
    }
  };

  const debouncedJumpToPage = debounce((page: number) => {
    if (page > 0 && page <= pdfState.totalPages) {
      pdfState.currentPage = page;
      pdfState = {...pdfState};
    }
  }, 300);

  const handleTocItemHover = (e: CustomEvent) => {
    if (!isPreviewMode) return;
    const logicalPage = e.detail.to as number;
    jumpToPage(logicalPage);
  };

  const handleUpdateActiveRange = (e: CustomEvent) => {
    const {start, end} = e.detail;
    if (activeRangeIndex >= 0 && activeRangeIndex < tocRanges.length) {
      if (start !== undefined) tocRanges[activeRangeIndex].start = start;
      if (end !== undefined) tocRanges[activeRangeIndex].end = end;
      tocRanges = [...tocRanges];
    }
  };

  const handleAddRange = () => {
    tocRanges = [
      ...tocRanges,
      {
        start: pdfState.currentPage || 1,
        end: pdfState.currentPage || 1,
        id: `range-${Date.now()}`,
      },
    ];
    activeRangeIndex = tocRanges.length - 1;
  };

  const handleRemoveRange = (e: CustomEvent) => {
    const {index} = e.detail;
    tocRanges = tocRanges.filter((_, i) => i !== index);
    if (activeRangeIndex >= tocRanges.length) {
      activeRangeIndex = Math.max(0, tocRanges.length - 1);
    }
  };

  const handleSetActiveRange = (e: CustomEvent) => {
    activeRangeIndex = e.detail.index;
  };

  const handleRangeChange = () => {
    tocRanges = [...tocRanges];
  };

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if ($tocItems.length > 0) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  };

  const jumpToPage = async (logicalPage: number) => {
    if (!isPreviewMode) {
      await togglePreviewMode();
    }
    const physicalContentPage = logicalPage + config.pageOffset;
    let targetPage: number;
    if (physicalContentPage >= (config.insertAtPage || 2)) {
      targetPage = physicalContentPage + tocPageCount;
    } else {
      targetPage = physicalContentPage;
    }
    debouncedJumpToPage(targetPage);
  };

  const jumpToTocPage = async () => {
    if (!previewPdfInstance) {
      toastProps = {show: true, message: 'Please edit the ToC first to generate a preview.', type: 'error'};
      return;
    }
    if (!isPreviewMode) {
      await togglePreviewMode();
    }
    await tick();
    const targetPage = config.insertAtPage || 2;
    if (targetPage > 0 && targetPage <= pdfState.totalPages) {
      pdfState.currentPage = targetPage;
      pdfState = {...pdfState};
    } else {
      toastProps = {show: true, message: `Invalid ToC start page: ${targetPage}`, type: 'error'};
    }
  };

  function handleApiConfigChange(e: CustomEvent) {
    customApiConfig = e.detail;
  }

  function handleApiConfigSave() {
    toastProps = {show: true, message: 'API Settings Saved!', type: 'success'};
  }

  const handleViewerMessage = (event: CustomEvent<{message: string; type: 'success' | 'error' | 'info'}>) => {
    toastProps = {show: true, message: event.detail.message, type: event.detail.type};
  };

  let prefixConfigs = DEFAULT_PREFIX_CONFIG;
  let prefixEnabled = false;

  const handlePrefixChange = (e: CustomEvent) => {
    if (e.detail.configs) prefixConfigs = e.detail.configs;
    if (e.detail.enabled !== undefined) prefixEnabled = e.detail.enabled;

    if (isPreviewMode) debouncedUpdatePDF();
  };

  onMount(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.name === 'RenderingCancelledException') {
        event.preventDefault();
        return;
      }
      const msg = event.reason?.message || event.reason || 'Unknown Async Error';
      toastProps = {show: true, message: msg, type: 'error'};
      event.preventDefault();
    };

    const handleSyncError = (event: ErrorEvent) => {
      const msg = event.message || 'Unknown Error';
      toastProps = {show: true, message: msg, type: 'error'};
    };

    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('error', handleSyncError);

    return () => {
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('error', handleSyncError);
    };
  });
</script>

{#if !showGraphDrawer && tocItems && isGraphEntranceVisible}
  <button
    transition:fly={{x: -50, duration: 300}}
    class="fixed -left-1 p-1 md:p-2 md:left-0 top-[40vh] z-40 bg-white border-2 border-black border-l-0 rounded-r-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-200 transition-colors flex flex-col items-center gap-2 group"
    on:click={() => (showGraphDrawer = true)}
    title="Show Content Graph"
  >
    <div class="writing-mode-vertical text-xs font-bold font-mono tracking-widest uppercase rotate-180 select-none">
      Graph
    </div>
    <ChevronRight class="w-5 h-5 group-hover:translate-x-1 transition-transform" />
  </button>
{/if}

<div
  class={`fixed inset-y-0 left-0 z-50 flex transition-transform duration-300 ease-in-out ${showGraphDrawer ? 'translate-x-0' : '-translate-x-full'}`}
>
  <div class="h-full w-[85vw] md:w-[540px] bg-white shadow-[10px_0_15px_-3px_rgba(0,0,0,0.1)] flex flex-col relative">
    <button
      class="p-2 right-0 bottom-[50%] absolute z-50 inline text-gray-400"
      on:click={() => (showGraphDrawer = false)}
    >
      <ChevronLeft class="w-8 h-8 hover:-translate-x-1 transition-transform" />
    </button>

    <div class="flex-1 overflow-hidden relative w-full h-full bg-slate-50">
      <TocRelation
        items={$tocItems}
        onJumpToPage={jumpToPage}
        title={pdfState.filename ? `${pdfState.filename}`.replace('.pdf', '') : 'No file loaded'}
        onHide={() => {
          showGraphDrawer = false;
          isGraphEntranceVisible = false;
          const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
          localStorage.setItem('tocify_hide_graph_entrance_until', expiry.toString());
        }}
      />
    </div>
  </div>

  {#if showGraphDrawer}
    <div
      transition:fade={{duration: 200}}
      class="flex-1 bg-black/20 backdrop-blur-sm cursor-pointer"
      on:click={() => (showGraphDrawer = false)}
    ></div>
  {/if}
</div>

<DownloadBanner />

{#if toastProps.show}
  <Toast
    message={toastProps.message}
    type={toastProps.type}
    on:close={() => (toastProps.show = false)}
  />
{/if}

{#if $isLoading}
  <div class="fixed inset-0 bg-white flex items-center justify-center z-50">
    <div class="animate-spin rounded-full h-12 w-12 border-4 border-black border-t-transparent"></div>
  </div>
{:else}
  <p class="sr-only">
    Generate clickable PDF bookmarks from scanned pages — AI-powered, private, and free.
  </p>
  
  <div
    class="flex flex-col mt-5 lg:flex-row lg:mt-8 p-2 md:p-4 md:pr-3 gap-4 lg:gap-8 mx-auto w-[95%] md:w-[90%] xl:w-[80%] 3xl:w-[75%] justify-between"
  >
      <div
        in:fly={{y: 20, duration: 300, delay: 100}}
        out:fade
        class="contents"
      >
        <SidebarPanel
          {pdfState}
          {originalPdfInstance}
          {previewPdfInstance}
          {isAiLoading}
          {aiError}
          {showNextStepHint}
          {config}
          {customApiConfig}
          {tocPageCount}
          {isPreviewMode}
          bind:tocRanges
          bind:activeRangeIndex
          bind:addPhysicalTocPage
          bind:isTocConfigExpanded
          on:prefixChange={handlePrefixChange}
          on:openhelp={() => (showHelpModal = true)}
          on:apiConfigChange={handleApiConfigChange}
          on:apiConfigSave={handleApiConfigSave}
          on:updateField={(e) => updateTocField(e.detail.path, e.detail.value)}
          on:jumpToTocPage={jumpToTocPage}
          on:jumpToPage={(e) => { jumpToPage(e.detail.to); }}
          on:generateAi={generateTocFromAI}
          on:hoveritem={handleTocItemHover}
          on:fileselect={(e) => loadPdfFile(e.detail)}
          on:viewerMessage={handleViewerMessage}
          on:togglePreview={togglePreviewMode}
          on:export={exportPDF}
          on:addRange={handleAddRange}
          on:removeRange={handleRemoveRange}
          on:setActiveRange={handleSetActiveRange}
          on:rangeChange={handleRangeChange}
          on:updateActiveRange={handleUpdateActiveRange}
        />
      </div>

      <div
        in:fly={{y: 20, duration: 300, delay: 200}}
        out:fade
        class="contents"
      >
        <PreviewPanel
          {isFileLoading}
          bind:pdfState
          {originalPdfInstance}
          {previewPdfInstance}
          {isPreviewMode}
          {isPreviewLoading}
          {tocRanges}
          {activeRangeIndex}
          {addPhysicalTocPage}
          {jumpToTocPage}
          {currentTocPath}
          bind:isDragging
          on:fileselect={(e) => loadPdfFile(e.detail)}
          on:viewerMessage={handleViewerMessage}
          on:updateActiveRange={handleUpdateActiveRange}
          on:togglePreview={togglePreviewMode}
          on:export={exportPDF}
        />
      </div>
  </div>



  <Footer />

  <SeoJsonLd title={$t('meta.title')} />

  <AiLoadingModal
    {isAiLoading}
    {tocRanges}
  />

  <OffsetModal
    bind:showOffsetModal
    bind:offsetPreviewPageNum
    {firstTocItem}
    totalPages={pdfState.totalPages}
    on:confirm={handleOffsetConfirm}
  />

  <HelpModal bind:showHelpModal />

  <StarRequestModal bind:show={showStarRequestModal} />
{/if}

<svelte:window on:beforeunload={handleBeforeUnload} />

<svelte:head>
  <title>{$t('meta.title') || 'Tocify · Add or edit PDF Table of Contents online'}</title>
  <meta
    name="description"
    content={$t('meta.description') ||
      'A free, online tool to automatically generate Table of Contents (bookmarks) for PDFs.'}
  />
  <link
    rel="canonical"
    href="https://tocify.aeriszhu.com/"
  />
  <meta
    name="keywords"
    content="add bookmarks to PDF, PDF table of contents, clickable PDF outline, PDF bookmark editor, create PDF TOC, generate PDF outline, PDF 目录生成, PDF 添加书签, 扫描版 PDF 目录, PDF 在线免费工具"
  />
  <meta
    property="og:title"
    content="Tocify - 给 PDF 自动生成目录"
  />
  <meta
    property="og:description"
    content="一个免费为 PDF 添加目录（书签）的在线工具"
  />
  <meta
    name="twitter:card"
    content="summary_large_image"
  />
  <meta
    name="twitter:image"
    content="/og-image.png"
  />
  <link
    rel="icon"
    href="/favicon.ico"
  />
  <link
    rel="icon"
    type="image/svg+xml"
    href="/favicon.svg"
  />
  <link
    rel="icon"
    type="image/png"
    href="/favicon.png"
  />
</svelte:head>

<style>
  .writing-mode-vertical {
    writing-mode: vertical-rl;
  }
</style>
