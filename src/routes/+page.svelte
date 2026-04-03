<script lang="ts">
  import {onMount, onDestroy, tick} from 'svelte';
  import {get} from 'svelte/store';
  import {fade, fly} from 'svelte/transition';
  import {t, isLoading} from 'svelte-i18n';
  import {injectAnalytics} from '@vercel/analytics/sveltekit';
  import type * as PdfjsLibTypes from 'pdfjs-dist';
  import {init, trackEvent} from '@aptabase/web';

  import '../lib/i18n';
  import {pdfService, tocItems, curFileFingerprint, tocConfig, autoSaveEnabled, type TocConfig} from '../stores';
  import {PDFService, type PDFState, type TocItem} from '$lib/pdf/service';
  import {renderQueue} from '../lib/pdf/render-queue';
  import {setOutline} from '../lib/pdf/outliner';
  import {debounce} from '$lib';
  import {buildTree, convertPdfJsOutlineToTocItems, setNestedValue, findActiveTocPath, cleanTocItems} from '$lib/utils';
  import {generateToc, ERROR_NEEDS_API_KEY} from '$lib/toc-service';
  import {applyCustomPrefix} from '$lib/utils/prefix';
  import {setPageLabels} from '$lib/pdf/page-labels';

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

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const TWO_SECONDS = 2000;

  let pdfjs: typeof PdfjsLibTypes | null = null;
  let PdfLib: typeof import('pdf-lib') | null = null;

  let isDragging = false;
  let isFileLoading = false;
  let isAiLoading = false;
  let isPreviewLoading = false;
  let isTocConfigExpanded = false;
  let showNextStepHint = false;
  let addPhysicalTocPage = false;
  
  let highlightPageNum = 0;
  let hasShownTocHint = false;

  let showGraphDrawer = false;
  let isGraphEntranceVisible = true;

  let showOffsetModal = false;
  let showHelpModal = false;
  let showStarRequestModal = false;
  let offsetPreviewPageNum = 1;
  let requestCnt = 0;

  let toastProps: {
    show: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
    duration?: number;
  } = {
    show: false,
    message: '',
    type: 'success',
    duration: 3000,
  };

  let originalPdfInstance: PdfjsLibTypes.PDFDocumentProxy | null = null;
  let tocPdfInstance: PdfjsLibTypes.PDFDocumentProxy | null = null;

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
  let isPreviewMode = false;
  let pendingTocItems: TocItem[] = [];
  let firstTocItem: TocItem | null = null;
  let aiError: string | null = null;
  let aiProgress: {current: number; total: number} | null = null;
  let config: TocConfig;

  let lastPdfContentJson = '';
  let lastInsertAtPage = 2;
  let prefetchPageNum = 0;
  let lastConfigJson = '';

  let customApiConfig = {
    provider: '',
    apiKey: '',
    doubaoEndpointIdText: '',
    doubaoEndpointIdVision: '',
  };
  let tocEditor: any;

  onMount(async () => {
    init('A-US-0422911470', {
      appVersion: '1.0.0',
    });

    trackEvent('app_started', {
      platform: 'web',
      version: '1.0.0',
    });
  });

  onMount(() => {
    $pdfService = new PDFService();

    const hideUntil = localStorage.getItem('tocify_hide_graph_entrance_until');
    if (hideUntil) {
      const expiry = parseInt(hideUntil, 10);
      if (Date.now() < expiry) {
        isGraphEntranceVisible = false;
      } else {
        localStorage.removeItem('tocify_hide_graph_entrance_until');
      }
    }

    // Global error handlers
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.name === 'RenderingCancelledException') {
        event.preventDefault();
        return;
      }
      const msg = event.reason?.message || event.reason || $t('toast.unknown_async_error');
      toastProps = {show: true, message: msg, type: 'error'};
      event.preventDefault();
    };

    const handleSyncError = (event: ErrorEvent) => {
      const msg = event.message || $t('toast.unknown_error');
      toastProps = {show: true, message: msg, type: 'error'};
    };

    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('error', handleSyncError);

    return () => {
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('error', handleSyncError);
    };
  });

  onDestroy(async () => {
    unsubscribeTocItems();
    if (originalPdfInstance) {
      try {
        await originalPdfInstance.destroy();
      } catch (e: any) {
        console.warn('Error destroying original instance:', e);
      }
    }
    if (tocPdfInstance) {
      try {
        await tocPdfInstance.destroy();
      } catch (e: any) {
        console.warn('Error destroying TOC instance:', e);
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

  // Only trigger updatePDF when config content actually changes, not just reference
  $: {
    config = $tocConfig;
    const currentConfigJson = JSON.stringify($tocConfig);

    if (isPreviewMode && !isFileLoading && lastConfigJson) {
      if (currentConfigJson !== lastConfigJson) {
        debouncedUpdatePDF();
      }
    }
    lastConfigJson = currentConfigJson;
  }

  $: currentTocPath = findActiveTocPath(
    $tocItems,
    pdfState.currentPage,
    $tocConfig.pageOffset || 0,
    addPhysicalTocPage,
    tocPageCount,
    config.insertAtPage,
  );

  $: if (showOffsetModal) {
    tick().then(() => renderOffsetPreviewPage(offsetPreviewPageNum));
  } else {
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
      tick().then(() => renderOffsetPreviewPage(offsetPreviewPageNum));
    }
  }

  const debouncedUpdatePDF = debounce(updatePDF, 300);

  const toggleShowInsertTocHint = () => {
    if (!hasShownTocHint && addPhysicalTocPage && $tocItems.length > 0) {
      toastProps = {
        show: true,
        message: $t('toast.toc_insert_hint', {values: {page: config.insertAtPage || 2}}),
        type: 'info',
      };
      setTimeout(() => {
        hasShownTocHint = true;
      }, TWO_SECONDS);
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
    } catch (error: any) {
      console.error('Failed to load PDF libraries:', error);
      toastProps = {
        show: true,
        message: $t('toast.load_failed'),
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
    pdfState.instance = originalPdfInstance;
    if (isPreviewMode) {
      pdfState.totalPages = (originalPdfInstance?.numPages || 0) + tocPageCount;
    } else {
      pdfState.totalPages = originalPdfInstance?.numPages || 0;
    }
    pdfState = {...pdfState};
  };

  async function updatePDF(forceFull = false) {
    const isFull = !isPreviewMode || forceFull;
    if (!pdfState.doc || !$pdfService) return;
    isPreviewLoading = true;

    if (!pdfjs || !PdfLib) {
      console.error('PDF libraries not loaded.');
      toastProps = {show: true, message: $t('toast.components_not_loaded'), type: 'error'};
      return;
    }

    try {
      const settings = config.prefixSettings;
      const tocItems_ = settings.enabled ? applyCustomPrefix($tocItems, settings.configs) : $tocItems;

      let newDoc = pdfState.doc;

      const fontKey = config.fontFamily || 'huiwen';
      const isFontMissing = !PDFService.regularFontBytes.has(fontKey);
      if (isFontMissing) {
        const translate = get(t);
        toastProps = {
          show: true,
          message: translate('msg.font_loading', {values: {font: fontKey}}),
          type: 'info',
          duration: 100000,
        };
        isPreviewLoading = true;
      }

      const currentInsertPage = config.insertAtPage || 2;
      let tocBytes: Uint8Array | null = null;

      if (addPhysicalTocPage) {
        if (currentInsertPage !== lastInsertAtPage) {
          await $pdfService.initPreview(pdfState.doc);
          lastInsertAtPage = currentInsertPage;
        }

        const firstPage = pdfState.doc.getPages()[0];
        const pageSize = firstPage ? firstPage.getSize() : undefined;

        const res = await $pdfService.updateTocPages(tocItems_, config, !isFull, pageSize);
        newDoc = res.newDoc || pdfState.doc;
        tocPageCount = res.tocPageCount;
        tocBytes = res.tocBytes;

        if (isFontMissing) {
          if (PDFService.regularFontBytes.has(fontKey)) {
            toastProps = {
              show: true,
              message: $t('msg.font_loaded', {values: {font: fontKey}}),
              type: 'success',
              duration: 3000,
            };
          } else {
            toastProps = {
              show: true,
              message: $t('msg.font_load_failed', {values: {font: fontKey}}),
              type: 'error',
              duration: 5000,
            };
          }
        }
      } else {
        newDoc = await pdfState.doc.copy();
        tocPageCount = 0;
      }

      setOutline(newDoc!, tocItems_, { pageOffset: config.pageOffset, tocPageCount });
      setPageLabels(newDoc!, config.pageLabelSettings, { tocPageCount, insertAtPage: config.insertAtPage || 2 });

      if (isFull) {
        const pdfBytes = await newDoc!.save({
          useObjectStreams: false,
        });
        pdfState.newDoc = newDoc;
      }

      if (tocBytes) {
        const loadingTask = pdfjs.getDocument({
          data: tocBytes,
          worker: PDFService.sharedWorker || undefined,
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
        });

        const newTocInstance = await loadingTask.promise;

        if (tocPdfInstance) {
          try {
            await tocPdfInstance.destroy();
          } catch (e) {
            console.warn('Error destroying old TOC instance:', e);
          }
        }

        tocPdfInstance = newTocInstance;
      } else {
        if (tocPdfInstance) {
          try {
            await tocPdfInstance.destroy();
          } catch (e) {}
        }
        tocPdfInstance = null;
      }

      if (isFull) {
        pdfState.newDoc = newDoc;
      }

      if (isPreviewMode) {
        pdfState.totalPages = (originalPdfInstance?.numPages || 0) + tocPageCount;

        if (pdfState.currentPage > pdfState.totalPages) {
          pdfState.currentPage = pdfState.totalPages;
        }
      } else {
        pdfState.totalPages = originalPdfInstance?.numPages || 0;
      }

      pdfState = {...pdfState};
    } catch (error: any) {
      console.error('Error updating PDF:', error);
      const msg =
        error.name === 'InvalidPDFException'
          ? $t('toast.pdf_corrupted')
          : error.message;
      toastProps = {show: true, message: $t('toast.error_updating_pdf', {values: {msg}}), type: 'error'};
    } finally {
      if (isPreviewLoading && !isFileLoading) {
        // Only reset if we are not in another loading state, though simply false is usually fine here
        isPreviewLoading = false;
      }
    }
  }

  const togglePreviewMode = async () => {
    if (!originalPdfInstance) return;

    if (!isPreviewMode) {
      isPreviewLoading = true;
      try {
        if (!tocPdfInstance) {
          await updatePDF();
        }

        isPreviewMode = true;
        toggleShowInsertTocHint();
        await tick();
      } catch (error: any) {
        console.error('Error generating preview:', error);
        toastProps = {show: true, message: $t('toast.error_generating_preview', {values: {msg: error.message}}), type: 'error'};
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
    if (!originalPdfInstance || !showOffsetModal) return;

    const canvas = document.getElementById('offset-preview-canvas') as HTMLCanvasElement;
    if (canvas) {
      const pageId = `orig-${pageNum}`;
      // Use premium priority (0) for modal preview
      const bitmap = await renderQueue.enqueue(pageId, originalPdfInstance, pageNum, 0);

      const ctx = canvas.getContext('2d', {alpha: false});
      if (!ctx || !showOffsetModal) return;

      const containerHeight = canvas.parentElement?.clientHeight || 0;
      const containerWidth = canvas.parentElement?.clientWidth || 0;

      if (containerHeight === 0) {
        setTimeout(() => renderOffsetPreviewPage(pageNum), 50);
        return;
      }

      const aspectRatio = bitmap.width / bitmap.height;
      const displayHeight = containerHeight;
      const displayWidth = displayHeight * aspectRatio;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(displayWidth * dpr);
      canvas.height = Math.floor(displayHeight * dpr);
      canvas.style.width = `${Math.floor(displayWidth)}px`;
      canvas.style.height = `${Math.floor(displayHeight)}px`;

      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
  };

  const loadPdfFile = async (file: File) => {
    if (!file) return;

    renderQueue.clear();

    const fingerprint = `${file.name}_${file.size}`;
    curFileFingerprint.set(fingerprint);
    localStorage.setItem('tocify_last_fingerprint', fingerprint);

    isFileLoading = true;
    autoSaveEnabled.set(false);
    showNextStepHint = false;
    hasShownTocHint = false;
    showOffsetModal = false;

    pendingTocItems = [];
    firstTocItem = null;

    tocItems.set([]);
    await tick();

    if (originalPdfInstance) {
      try {
        await originalPdfInstance.destroy();
      } catch (e: any) {
        console.warn('Error destroying original instance:', e);
      }
    }
    if (tocPdfInstance) {
      try {
        await tocPdfInstance.destroy();
      } catch (e: any) {
        console.warn('Error destroying TOC instance:', e);
      }
    }

    pdfState.instance = null;
    originalPdfInstance = null;
    tocPdfInstance = null;
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

        const firstPage = pdfState.doc.getPage(pdfState.doc.getPageCount() > 1 ? 1 : 0);
        const {width} = firstPage.getSize();
        const autoLayout = PDFService.getAutoLayout(width);

        tocConfig.update((c) => ({
          ...c,
          firstLevel: {...c.firstLevel, fontSize: autoLayout.fontSizeL1},
          otherLevels: {...c.otherLevels, fontSize: autoLayout.fontSizeLOther},
        }));
      }

      const loadingTask = pdfjs.getDocument({
        data: uint8Array,
        worker: PDFService.sharedWorker || undefined,
        cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
        cMapPacked: true,
      });
      originalPdfInstance = await loadingTask.promise;

      tocPdfInstance = null;
      isPreviewMode = false;
      tocPageCount = 0;
      pdfState.currentPage = 1;
      tocRanges = [{start: 1, end: 1, id: 'default'}];
      activeRangeIndex = 0;

      const session = localStorage.getItem(`toc_draft_${fingerprint}`);

      if (session) {
        const {items, pageOffset} = JSON.parse(session);
        tocItems.set(cleanTocItems(items));
        updateTocField('pageOffset', pageOffset);
      } else {
        try {
          const existingOutline = await originalPdfInstance.getOutline();

          if (existingOutline && existingOutline.length > 0) {
            const importedItems = await convertPdfJsOutlineToTocItems(existingOutline, originalPdfInstance);
            tocItems.set(importedItems);
            updateTocField('pageOffset', 0);

            toastProps = {show: true, message: $t('toast.raw_toc_imported'), type: 'info'};
          } else {
            tocItems.set([]);
            updateTocField('pageOffset', 0);
          }
        } catch (err: any) {
          console.warn('PDF load outline error:', err);
          tocItems.set([]);
          updateTocField('pageOffset', 0);
        }
      }

      lastPdfContentJson = JSON.stringify(getPdfEffectiveData($tocItems));

      // auto detect TOC pages
      if ($pdfService && originalPdfInstance) {
        const detected = await $pdfService.detectTocPages();
        if (detected.length > 0) {
          const start = Math.min(...detected);
          const end = Math.max(...detected);
          tocRanges = [{start, end, id: 'detected'}];
          activeRangeIndex = 0;
        }
      }
    } catch (error: any) {
      console.error('Error loading PDF:', error);
      toastProps = {show: true, message: $t('toast.error_loading_pdf', {values: {msg: error.message}}), type: 'error'};
    } finally {
      updateViewerInstance();
      await tick();
      isFileLoading = false;

      const hideHintUntil = localStorage.getItem('tocify_hide_next_step_hint_until');
      if (hideHintUntil && Date.now() < parseInt(hideHintUntil, 10)) {
        showNextStepHint = false;
      } else {
        showNextStepHint = true;
      }

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
          fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: pdfState.filename.replace('.pdf', '_outlined.pdf'),
            types: [
              {
                description: 'PDF Document',
                accept: {'application/pdf': ['.pdf']},
              },
            ],
          });
        } catch (err: any) {
          if (err.name === 'AbortError') return;
          throw err;
        }
      }

      toastProps = {show: true, message: $t('toast.exporting'), type: 'info'};

      await updatePDF(true);
      if (!pdfState.newDoc) {
        toastProps = {show: true, message: $t('toast.no_pdf_to_export'), type: 'error'};
        return;
      }
      const pdfBytes = await pdfState.newDoc.save();

      if (isSupported && fileHandle) {
        writable = await fileHandle.createWritable();
        await writable.write(pdfBytes);
        await writable.close();
      } else {
        const pdfBlob = new Blob([pdfBytes as any], {type: 'application/pdf'});
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = pdfState.filename.replace('.pdf', '_outlined.pdf');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toastProps = {show: true, message: $t('toast.export_success'), type: 'success'};

      setTimeout(() => {
        const isDismissed = localStorage.getItem('tocify_hide_star_request') === 'true';
        if (!isDismissed) {
          requestCnt += 1;
          
          let probability = 1.0;
          if (requestCnt === 1) probability = 0.5;
          else if (requestCnt === 2) probability = 0.75;

          if (Math.random() < probability) {
            showStarRequestModal = true;
          }
        }
      }, 1000);
    } catch (error: any) {
      console.error('Error exporting PDF:', error);
      toastProps = {show: true, message: $t('toast.error_exporting', {values: {msg: error.message}}), type: 'error'};
    }
  };

  const generateTocFromAI = async () => {
    showNextStepHint = false;

    if (!originalPdfInstance) {
      toastProps = {show: true, message: $t('toast.load_pdf_first'), type: 'error'};
      return;
    }

    isAiLoading = true;
    aiError = null;
    aiProgress = null;

    try {
      const res = await generateToc({
        pdfInstance: originalPdfInstance,
        ranges: tocRanges,
        apiKey: customApiConfig.apiKey,
        provider: customApiConfig.provider,
        doubaoEndpointIdText: customApiConfig.doubaoEndpointIdText,
        doubaoEndpointIdVision: customApiConfig.doubaoEndpointIdVision,
        onProgress: (current, total) => {
          aiProgress = { current, total };
        },
      });

      const { items, chunkFailures: failures } = res;

      if (failures.length > 0) {
        aiError = failures
          .map(f => $t('error.chunk_failed', { values: { start: f.start, end: f.end, reason: f.error } }))
          .join('\n');
      }

      if (!items || items.length === 0) {
        aiError = $t('toast.no_valid_toc');
        return;
      }

      const nestedTocItems = buildTree(items);

      pendingTocItems = nestedTocItems;
      firstTocItem = nestedTocItems.length > 0 ? nestedTocItems[0] : null;

      if (firstTocItem) {
        const lastTocPage = tocRanges[0]?.end || firstTocItem.to;
        offsetPreviewPageNum = Math.min(lastTocPage + 1, originalPdfInstance?.numPages || 1);
        showOffsetModal = true;
      } else {
        tocItems.set(nestedTocItems);
        pendingTocItems = [];
      }
    } catch (error: any) {
      console.error('Error generating ToC from AI:', error);
      if (error.code === ERROR_NEEDS_API_KEY) {
        isTocConfigExpanded = false;
        toastProps = {show: true, message: error.message, type: 'error', duration: 6000};
      } else {
        aiError = error.message;
        toastProps = {show: true, message: error.message, type: 'error'};
      }
    } finally {
      isAiLoading = false;
      aiProgress = null;
    }
  };
  
  const handleAiFormatResponse = (e: any) => {
    const { items } = e.detail;
    pendingTocItems = items;
    firstTocItem = items.length > 0 ? items[0] : null;

    if (firstTocItem) {
      offsetPreviewPageNum = Math.min(firstTocItem.to, originalPdfInstance?.numPages || 1);
      showOffsetModal = true;
    } else {
      if (tocEditor) tocEditor.saveHistory();
      tocItems.set(items);
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

    if (tocEditor) tocEditor.saveHistory();
    tocItems.set(pendingTocItems);
    showOffsetModal = false;
    pendingTocItems = [];
    firstTocItem = null;

    if (!isPreviewMode) {
      await togglePreviewMode();
    }
  };

  const handleOffsetSkip = () => {
    if (pendingTocItems.length > 0) {
      pendingTocItems.shift();
      firstTocItem = pendingTocItems.length > 0 ? pendingTocItems[0] : null;

      if (!firstTocItem) {
        showOffsetModal = false;
        tocItems.set([]);
      }
    }
  };

  const jumpToPage = (page: number) => {
    if (page > 0 && page <= (pdfState.totalPages || originalPdfInstance?.numPages || Infinity)) {
      if (isPreviewMode) {
        pdfState.currentPage = page;
        pdfState = {...pdfState};
      } else {
        highlightPageNum = page;
      }
    }
  };
  const debouncedJumpToPage = debounce(jumpToPage, 300);

  const handleTocItemHover = (e: CustomEvent) => {
    if (!isPreviewMode) return;
    const logicalPage = e.detail.to as number;
    const physicalContentPage = logicalPage + config.pageOffset;
    if (physicalContentPage >= (config.insertAtPage || 2)) {
      prefetchPageNum = physicalContentPage + tocPageCount;
    } else {
      prefetchPageNum = physicalContentPage;
    }
    debouncedJumpToPage(prefetchPageNum);
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
    const lastRange = tocRanges.length > 0 ? tocRanges[tocRanges.length - 1] : null;
    let nextStart = lastRange ? lastRange.end + 1 : pdfState.currentPage || 1;

    if (nextStart < 1) nextStart = 1;

    tocRanges = [
      ...tocRanges,
      {
        start: nextStart,
        end: nextStart,
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

  const jumpToLogicalPage = async (logicalPage: number) => {
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
    if (!tocPdfInstance) {
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

  const handleCloseNextStepHint = () => {
    showNextStepHint = false;
    const expiry = Date.now() + THIRTY_DAYS;
    localStorage.setItem('tocify_hide_next_step_hint_until', expiry.toString());
  };

  const handleViewerMessage = (event: CustomEvent<{message: string; type: 'success' | 'error' | 'info'}>) => {
    toastProps = {show: true, message: event.detail.message, type: event.detail.type};
  };
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
      {#key $curFileFingerprint}
        <TocRelation
          items={$tocItems}
          onJumpToPage={jumpToLogicalPage}
          title={pdfState.filename ? `${pdfState.filename}`.replace('.pdf', '') : 'No file loaded'}
          onHide={() => {
            showGraphDrawer = false;
            isGraphEntranceVisible = false;
            const expiry = Date.now() + THIRTY_DAYS;
            localStorage.setItem('tocify_hide_graph_entrance_until', expiry.toString());
          }}
        />
      {/key}
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
    duration={toastProps.duration}
    on:close={() => (toastProps.show = false)}
  />
{/if}

{#if $isLoading}
  <div class="fixed inset-0 bg-white flex items-center justify-center z-50">
    <div class="animate-spin rounded-full h-12 w-12 border-4 border-black border-t-transparent"></div>
  </div>
{:else}
  <h1 class="sr-only">Generate PDF bookmarks / table of contents in browser — AI-powered, private, online and free.</h1>

  <div
    class="flex flex-col mt-5 lg:flex-row lg:mt-8 p-2 md:p-4 md:pr-3 gap-4 lg:gap-8 mx-auto w-[95%] md:w-[90%] xl:w-[80%] 3xl:w-[75%] justify-between"
  >
    <SidebarPanel
      {pdfState}
      {originalPdfInstance}
      {tocPdfInstance}
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
      on:openhelp={() => (showHelpModal = true)}
      on:closeNextStepHint={handleCloseNextStepHint}
      on:apiConfigChange={handleApiConfigChange}
      on:apiConfigSave={handleApiConfigSave}
      on:updateField={(e) => updateTocField(e.detail.path, e.detail.value)}
      on:jumpToTocPage={jumpToTocPage}
      on:jumpToPage={(e) => {
        let physicalTarget = e.detail.page !== undefined ? e.detail.page : (e.detail.to + config.pageOffset);
        let finalPage = physicalTarget;
        if (isPreviewMode) {
           if (physicalTarget >= (config.insertAtPage || 2)) {
              finalPage = physicalTarget + tocPageCount;
           }
        }
        jumpToPage(finalPage);
      }}
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
      on:aiFormatResponse={handleAiFormatResponse}
      bind:tocEditor
    />

    <PreviewPanel
      {isFileLoading}
      bind:pdfState
      {originalPdfInstance}
      {tocPdfInstance}
      {isPreviewMode}
      {isPreviewLoading}
      {tocRanges}
      {activeRangeIndex}
      {tocPageCount}
      {addPhysicalTocPage}
      {jumpToTocPage}
      {currentTocPath}
      {prefetchPageNum}
      bind:highlightPageNum
      bind:isDragging
      on:fileselect={(e) => loadPdfFile(e.detail)}
      on:viewerMessage={handleViewerMessage}
      on:updateActiveRange={handleUpdateActiveRange}
      on:togglePreview={togglePreviewMode}
      on:export={exportPDF}
    />
  </div>

  <Footer />

  <SeoJsonLd title={$t('meta.title')} />

  <AiLoadingModal
    {isAiLoading}
    {tocRanges}
    {aiProgress}
  />

  <OffsetModal
    bind:showOffsetModal
    bind:offsetPreviewPageNum
    {firstTocItem}
    totalPages={pdfState.totalPages}
    on:confirm={handleOffsetConfirm}
    on:skip={handleOffsetSkip}
  />

  <HelpModal bind:showHelpModal />

  <StarRequestModal bind:show={showStarRequestModal} />
{/if}

<svelte:window on:beforeunload={handleBeforeUnload} />


<style>
  .writing-mode-vertical {
    writing-mode: vertical-rl;
  }
</style>
