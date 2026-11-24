<script context="module" lang="ts">
  let tocViewCache: any = null;
  let tocResourceCleanup: Promise<void> = Promise.resolve();
  type TocPreparation = {
    instance: import('pdfjs-dist').PDFDocumentProxy;
    ready: Promise<void>;
    pages: Promise<number[]>;
  };
  let tocPreparation: TocPreparation | null = null;
</script>

<script lang="ts">
  import {onMount, onDestroy, tick} from 'svelte';
  import {get} from 'svelte/store';
  import {fade, fly} from 'svelte/transition';
  import {t, isLoading} from 'svelte-i18n';
  import {injectAnalytics} from '@vercel/analytics/sveltekit';
  import type * as PdfjsLibTypes from 'pdfjs-dist';
  import {init, trackEvent} from '@aptabase/web';

  import '../lib/i18n';
  import {pdfService, tocItems, curFileFingerprint, tocConfig, autoSaveEnabled, flushTocDraft, type TocConfig} from '../stores';
  import {PDFService, type PDFState, type TocItem} from '$lib/pdf/service';
  import {workspacePdfFiles} from '$lib/pdf/workspace-files';
  import {
    type ExportableChapter,
    buildChapterExportItems,
    buildOutlineTreeForExport,
    createPageMapForRanges,
    filterSelectedChapterRoots,
    findTocItemById,
    getChapterArchiveFilename,
    getChapterFilename,
    getMergedChapterFilename,
    mergeChapterRanges,
  } from '$lib/pdf/chapter-export';
  import {renderQueue, isRenderCancelled} from '../lib/pdf/render-queue';
  import {setOutline} from '../lib/pdf/outliner';
  import {debounce} from '$lib';
  import {buildTree, convertPdfJsOutlineToTocItems, setNestedValue, findActiveTocPath, cleanTocItems} from '$lib/utils';
  import {generateToc, ERROR_NEEDS_API_KEY} from '$lib/toc-service';
  import {applyCustomPrefix} from '$lib/utils/prefix';
  import {setPageLabels} from '$lib/pdf/page-labels';
  import {createEmptyApiConfig} from '$lib/llm/core';
  import {formatPageRanges} from '$lib/llm/batching';
  import {IS_LOCAL} from '$lib/local';
  import type {RecognitionIgnoreRegion} from '$lib/pdf/recognition-ignore';
  import {createZipBlob, getUniqueZipFilename, type ZipFileEntry} from '$lib/utils/zip';
  import {blurActiveField, hasMod, isBareKey, isDialogOpen, isEditableTarget} from '$lib/utils/shortcuts';

  import Toast from '../components/Toast.svelte';
  import Footer from '../components/Footer.svelte';

  import AiLoadingModal from '../components/modals/AiLoadingModal.svelte';
  import OffsetModal from '../components/modals/OffsetModal.svelte';
  import HelpModal from '../components/modals/HelpModal.svelte';
  import ChapterExportModal from '../components/modals/ChapterExportModal.svelte';
  import StarRequestModal from '../components/modals/StarRequestModal.svelte';

  import SidebarPanel from '../components/panels/SidebarPanel.svelte';
  import PreviewPanel from '../components/panels/PreviewPanel.svelte';
  import RecognitionIgnoreEditor from '../components/RecognitionIgnoreEditor.svelte';
  import SeoJsonLd from '../components/SeoJsonLd.svelte';

  import TocRelation from '../components/KnowledgeBoard.svelte';
  import {ChevronRight, ChevronLeft} from 'lucide-svelte';

  if (!IS_LOCAL) injectAnalytics();

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const TWO_SECONDS = 2000;
  const SEPARATE_EXPORT_ZIP_THRESHOLD = 10;

  let pdfjs: typeof PdfjsLibTypes | null = null;
  let PdfLib: typeof import('pdf-lib') | null = null;

  let isDragging = false;
  let isFileLoading = false;
  let isViewActive = false;
  let isAiLoading = false;
  let isPreviewLoading = false;
  let isTocConfigExpanded = false;
  let addPhysicalTocPage = false;
  
  let highlightPageNum = 0;
  let hasShownTocHint = false;

  let showGraphDrawer = false;
  let isGraphEntranceVisible = true;

  let showOffsetModal = false;
  let showHelpModal = false;
  let showChapterExportModal = false;
  let showStarRequestModal = false;
  let offsetPreviewPageNum = 1;
  let selectedChapterExportIds: string[] = [];
  let chapterExportMode: 'merge' | 'separate' = 'separate';

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
    instance: null,
    filename: '',
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
  };

  let tocRanges = [{start: 1, end: 1, id: 'default'}];
  let tocSelectionPageNumbers: number[] = [];
  let recognitionIgnoreRegions: RecognitionIgnoreRegion[] = [];
  let activeRangeIndex = 0;
  let tocPageCount = 0;
  let isPreviewMode = false;
  let pendingTocItems: TocItem[] = [];
  let firstTocItem: TocItem | null = null;
  let aiError: string | null = null;
  let aiWarning: string | null = null;
  let aiProgress: {current: number; total: number} | null = null;
  let config: TocConfig;

  let lastPdfContentJson = '';
  let lastInsertAtPage = 2;
  let prefetchPageNum = 0;
  let lastConfigJson = '';
  let chapterExportItems: ExportableChapter[] = [];
  let previousAddPhysicalTocPage = addPhysicalTocPage;

  let customApiConfig = createEmptyApiConfig();
  let tocEditor: any;
  let recognitionIgnoreEditor: any;
  let offsetRenderController: AbortController | null = null;

  let pdfLoadSequence = 0;
  let pdfUpdateSequence = 0;
  const pdfLoadingTasks = new Set<PdfjsLibTypes.PDFDocumentLoadingTask>();
  let activeAiController: AbortController | null = null;
  let isExporting = false;
  let hasRestoredView = false;

  restoreTocViewCache();

  function expandTocRanges(ranges: {start: number; end: number; id: string}[], maxPage: number) {
    const pages = new Set<number>();
    const rangeMaxPage = Math.max(0, ...ranges.flatMap((range) => [Number(range.start) || 0, Number(range.end) || 0]));
    const limit = Math.max(maxPage || 0, rangeMaxPage);

    for (const range of ranges) {
      const rawStart = Number(range.start) || 1;
      const rawEnd = Number(range.end) || rawStart;
      const start = Math.max(1, Math.min(limit || rawStart, Math.min(rawStart, rawEnd)));
      const end = Math.max(start, Math.min(limit || rawEnd, Math.max(rawStart, rawEnd)));

      for (let page = start; page <= end; page++) {
        pages.add(page);
      }
    }

    return [...pages].sort((a, b) => a - b);
  }

  $: tocSelectionPageNumbers = expandTocRanges(
    tocRanges,
    originalPdfInstance?.numPages || pdfState.totalPages || 0,
  );

  onMount(async () => {
    if (IS_LOCAL) return;
    init('A-US-0422911470', {
      appVersion: '1.0.0',
    });

    trackEvent('app_started', {
      platform: 'web',
      version: '1.0.0',
    });
  });

  onMount(() => {
    localStorage.removeItem('tocify_client_promo_hidden_until');

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

  onDestroy(() => {
    isViewActive = false;
    pdfLoadSequence++;
    pdfUpdateSequence++;
    debouncedUpdatePDF.cancel();
    flushTocDraft();
    saveTocViewCache();
    void releasePdfResources();
    unsubscribeTocItems();
  });

  onMount(() => {
    isViewActive = true;
    void loadDefaultPdf().then(() => {
      if (tocPreparation) void applyDetectedTocPages(tocPreparation);
    });
  });

  async function applyDetectedTocPages(preparation: TocPreparation) {
    if (tocRanges.length !== 1 || tocRanges[0].id !== 'default') return;
    const initialRanges = tocRanges;
    const detected = await preparation.pages;
    if (!isViewActive || tocPreparation !== preparation || originalPdfInstance !== preparation.instance || tocRanges !== initialRanges || !detected.length) return;
    tocRanges = [{start: Math.min(...detected), end: Math.max(...detected), id: 'detected'}];
    activeRangeIndex = 0;
  }

  function prepareTocInBackground() {
    if (!$pdfService || !pdfState.doc || !originalPdfInstance) return;
    const preparation: TocPreparation = {instance: originalPdfInstance, ready: Promise.resolve(), pages: Promise.resolve([])};
    tocPreparation = preparation;
    const service = $pdfService;
    const doc = pdfState.doc;
    preparation.ready = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      if (tocPreparation === preparation) return service.initPreview(doc, () => tocPreparation === preparation);
    });
    preparation.pages = preparation.ready.then(() => tocPreparation === preparation ? service.detectTocPages() : []).catch((error) => {
      console.warn('PDF background preparation failed:', error);
      return [];
    });
    void applyDetectedTocPages(preparation);
  }

  async function loadDefaultPdf() {
    const files = get(workspacePdfFiles);
    const file = hasRestoredView ? files.toc : files.toc || files.ocr;
    if (file) await loadPdfFile(file, {showLoadHint: false, restoreView: hasRestoredView});
  }

  function releasePdfResources() {
    tocPreparation = null;
    offsetRenderController?.abort();
    activeAiController?.abort();
    activeAiController = null;
    isAiLoading = false;
    const documents = [originalPdfInstance, tocPdfInstance].filter(Boolean) as PdfjsLibTypes.PDFDocumentProxy[];
    const loadingTasks = [...pdfLoadingTasks];
    pdfLoadingTasks.clear();
    originalPdfInstance = null;
    tocPdfInstance = null;
    pdfState = {...pdfState, doc: null, instance: null};
    $pdfService.dispose();
    const worker = PDFService.sharedWorker;
    PDFService.sharedWorker = null;
    for (const instance of documents) renderQueue.clearDocument(instance);
    tocResourceCleanup = tocResourceCleanup.then(async () => {
      await Promise.allSettled([
        ...documents.map((instance) => instance.destroy()),
        ...loadingTasks.map((task) => task.destroy()),
      ]);
      worker?.destroy();
    });
    return tocResourceCleanup;
  }

  function restoreTocViewCache() {
    if (!tocViewCache) return;

    ({
      pdfjs,
      PdfLib,
      isTocConfigExpanded,
      addPhysicalTocPage,
      highlightPageNum,
      hasShownTocHint,
      isGraphEntranceVisible,
      offsetPreviewPageNum,
      selectedChapterExportIds,
      chapterExportMode,
      pdfState,
      tocRanges,
      recognitionIgnoreRegions,
      activeRangeIndex,
      tocPageCount,
      isPreviewMode,
      pendingTocItems,
      firstTocItem,
      aiError,
      aiWarning,
      aiProgress,
      lastPdfContentJson,
      lastInsertAtPage,
      prefetchPageNum,
      lastConfigJson,
      customApiConfig,
      previousAddPhysicalTocPage,
    } = tocViewCache);

    hasRestoredView = true;
    tocViewCache = null;
    isDragging = false;
    isFileLoading = false;
    isAiLoading = false;
    isPreviewLoading = false;
    showGraphDrawer = false;
    showOffsetModal = Boolean(firstTocItem && pendingTocItems.length);
    showHelpModal = false;
    showChapterExportModal = false;
    showStarRequestModal = false;
    pdfState = {...pdfState};
  }

  function saveTocViewCache() {
    tocViewCache = {
      pdfjs,
      PdfLib,
      isTocConfigExpanded,
      addPhysicalTocPage,
      highlightPageNum,
      hasShownTocHint,
      isGraphEntranceVisible,
      offsetPreviewPageNum,
      selectedChapterExportIds,
      chapterExportMode,
      pdfState: {...pdfState, doc: null, instance: null},
      tocRanges,
      recognitionIgnoreRegions,
      activeRangeIndex,
      tocPageCount,
      isPreviewMode,
      pendingTocItems,
      firstTocItem,
      aiError,
      aiWarning,
      aiProgress,
      lastPdfContentJson,
      lastInsertAtPage,
      prefetchPageNum,
      lastConfigJson,
      customApiConfig,
      previousAddPhysicalTocPage,
    };
  }

  function getPdfEffectiveData(items: TocItem[]): any[] {
    return items.map((item) => ({
      title: item.title,
      to: item.to,
      children: item.children ? getPdfEffectiveData(item.children) : [],
    }));
  }

  type SavePickerType = {
    description: string;
    accept: Record<string, string[]>;
  };

  async function saveBlob(
    blob: Blob,
    suggestedName: string,
    pickerType: SavePickerType,
    preferSavePicker = true,
  ) {
    const isSupported = preferSavePicker && 'showSaveFilePicker' in window;

    if (isSupported) {
      try {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [pickerType],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err: any) {
        if (err.name === 'AbortError') return false;
        console.warn('showSaveFilePicker failed:', err);
        // Fall through to blob download
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  async function savePdfBytes(pdfBytes: Uint8Array, suggestedName: string, preferSavePicker = true) {
    return saveBlob(
      new Blob([pdfBytes as BlobPart], {type: 'application/pdf'}),
      suggestedName,
      {
        description: 'PDF Document',
        accept: {'application/pdf': ['.pdf']},
      },
      preferSavePicker,
    );
  }

  // Only trigger updatePDF when config content actually changes, not just reference
  $: {
    config = $tocConfig;
    const currentConfigJson = JSON.stringify($tocConfig);

    if (isPreviewMode && !isFileLoading && lastConfigJson) {
      if (currentConfigJson !== lastConfigJson) {
        syncPreviewPageOffset(JSON.parse(lastConfigJson), config);
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

  $: chapterExportItems = buildChapterExportItems(
    $tocItems,
    $tocConfig.pageOffset || 0,
    originalPdfInstance?.numPages || 0,
    get(t)('chapter_export.untitled'),
  );

  $: {
    const validIds = new Set(chapterExportItems.map((item) => item.id));
    const nextSelectedIds = selectedChapterExportIds.filter((id) => validIds.has(id));
    const selectionChanged =
      nextSelectedIds.length !== selectedChapterExportIds.length ||
      nextSelectedIds.some((id, index) => id !== selectedChapterExportIds[index]);

    if (selectionChanged) {
      selectedChapterExportIds = nextSelectedIds;
    }
  }

  $: if (showOffsetModal) {
    tick().then(() => renderOffsetPreviewPage(offsetPreviewPageNum));
  } else {
  }

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

  const debouncedUpdatePDF = debounce(() => { void updatePDF().catch(() => {}); }, 300);

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

  function syncPreviewPageOffset(previousConfig: TocConfig, nextConfig: TocConfig) {
    const offsetChange = (nextConfig.pageOffset || 0) - (previousConfig.pageOffset || 0);
    if (!offsetChange || !originalPdfInstance) return;

    const insertedPageCount = addPhysicalTocPage ? tocPageCount : 0;
    const previousInsertAt = previousConfig.insertAtPage || 2;
    const currentPage = pdfState.currentPage;

    // Generated TOC pages stay in place while their content is refreshed.
    if (currentPage >= previousInsertAt && currentPage < previousInsertAt + insertedPageCount) return;

    const contentPage = currentPage >= previousInsertAt + insertedPageCount
      ? currentPage - insertedPageCount
      : currentPage;
    const nextContentPage = Math.max(1, Math.min(originalPdfInstance.numPages, contentPage + offsetChange));
    const nextInsertAt = nextConfig.insertAtPage || 2;
    const nextPage = nextContentPage >= nextInsertAt
      ? nextContentPage + insertedPageCount
      : nextContentPage;

    pdfState = {...pdfState, currentPage: nextPage};
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

  async function updatePDF(forceFull = false): Promise<import('pdf-lib').PDFDocument | null> {
    if (!pdfState.doc || !$pdfService || isFileLoading) return null;
    const sourceDoc = pdfState.doc;
    const loadSequence = pdfLoadSequence;
    const sequence = forceFull ? pdfUpdateSequence : ++pdfUpdateSequence;
    const isCurrent = () => isViewActive && loadSequence === pdfLoadSequence && sourceDoc === pdfState.doc
      && (forceFull || sequence === pdfUpdateSequence);
    const settings = structuredClone(config);
    const items = structuredClone($tocItems);
    const insertToc = addPhysicalTocPage;
    if (!forceFull) isPreviewLoading = true;

    try {
      if (!pdfjs || !PdfLib) throw new Error($t('toast.components_not_loaded'));
      if (insertToc && tocPreparation?.instance === originalPdfInstance) await tocPreparation.ready;
      if (!isCurrent()) return null;
      const tocItems_ = settings.prefixSettings.enabled
        ? applyCustomPrefix(items, settings.prefixSettings.configs) : items;
      let newDoc: import('pdf-lib').PDFDocument | null = null;
      let nextTocPageCount = 0;
      let tocBytes: Uint8Array | null = null;

      if (insertToc) {
        const currentInsertPage = settings.insertAtPage || 2;
        if (currentInsertPage !== lastInsertAtPage) {
          await $pdfService.initPreview(sourceDoc, isCurrent);
          if (!isCurrent()) return null;
          lastInsertAtPage = currentInsertPage;
        }
        const pageSize = sourceDoc.getPages()[0]?.getSize();
        const result = await $pdfService.updateTocPages(tocItems_, settings, !forceFull, pageSize);
        if (!isCurrent()) return null;
        newDoc = result.newDoc;
        nextTocPageCount = result.tocPageCount;
        tocBytes = result.tocBytes;
      } else if (forceFull) {
        newDoc = await sourceDoc.copy();
      }

      if (forceFull) {
        if (!isCurrent()) return null;
        if (!newDoc) throw new Error($t('toast.no_pdf_to_export'));
        await setOutline(newDoc, tocItems_, {pageOffset: settings.pageOffset, tocPageCount: nextTocPageCount});
        setPageLabels(newDoc, settings.pageLabelSettings, {
          tocPageCount: nextTocPageCount, insertAtPage: settings.insertAtPage || 2,
        });
        return newDoc;
      }

      let nextTocInstance: PdfjsLibTypes.PDFDocumentProxy | null = null;
      if (tocBytes) {
        const task = pdfjs.getDocument({
          data: tocBytes,
          worker: PDFService.getSharedWorker(),
          cMapUrl: IS_LOCAL ? '/local-assets/cmaps/' : `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
        });
        pdfLoadingTasks.add(task);
        nextTocInstance = await task.promise.finally(() => pdfLoadingTasks.delete(task));
        if (!isCurrent()) {
          await nextTocInstance.destroy();
          return null;
        }
      }
      const previousTocInstance = tocPdfInstance;
      tocPdfInstance = nextTocInstance;
      tocPageCount = nextTocPageCount;
      if (previousTocInstance) {
        renderQueue.clearDocument(previousTocInstance);
        await previousTocInstance.destroy();
      }
      if (!isCurrent()) return null;
      updateViewerInstance();
      pdfState = {...pdfState, currentPage: Math.min(pdfState.currentPage, pdfState.totalPages)};
      return null;
    } catch (error: any) {
      if (!isCurrent() || error.name === 'AbortError') return null;
      if (forceFull) throw error;
      console.error('Error updating PDF:', error);
      const msg = error.name === 'InvalidPDFException' ? $t('toast.pdf_corrupted') : error.message;
      toastProps = {show: true, message: $t('toast.error_updating_pdf', {values: {msg}}), type: 'error'};
      throw error;
    } finally {
      if (!forceFull && sequence === pdfUpdateSequence) isPreviewLoading = false;
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
    const canvas = document.getElementById('offset-preview-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    offsetRenderController?.abort();
    const controller = new AbortController();
    offsetRenderController = controller;
    const instance = originalPdfInstance;

    try {
      const containerHeight = canvas.parentElement?.clientHeight || 0;
      const containerWidth = canvas.parentElement?.clientWidth || 0;
      if (!containerHeight) {
        setTimeout(() => renderOffsetPreviewPage(pageNum), 50);
        return;
      }
      const page = await instance.getPage(pageNum);
      if (controller.signal.aborted) return;
      const viewport = page.getViewport({scale: 1});
      const displayScale = Math.min(containerHeight / viewport.height, containerWidth > 0 ? containerWidth / viewport.width : Infinity);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bitmap = await renderQueue.enqueue(`orig-${pageNum}`, instance, pageNum, 0, {scale: displayScale * dpr, signal: controller.signal});
      if (controller.signal.aborted || !showOffsetModal || instance !== originalPdfInstance || pageNum !== offsetPreviewPageNum || !canvas.isConnected) return;
      const context = canvas.getContext('2d', {alpha: false});
      if (!context) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.style.width = `${Math.floor(viewport.width * displayScale)}px`;
      canvas.style.height = `${Math.floor(viewport.height * displayScale)}px`;
      context.drawImage(bitmap, 0, 0);
    } catch (error) {
      if (!isRenderCancelled(error)) console.error('Offset preview render error:', error);
    }
  };

  const loadPdfFile = async (file: File, {showLoadHint = true, restoreView = false} = {}) => {
    if (!file) return;
    const sequence = ++pdfLoadSequence;
    pdfUpdateSequence++;
    debouncedUpdatePDF.cancel();
    flushTocDraft();
    autoSaveEnabled.set(false);
    isFileLoading = true;
    const isCurrent = () => isViewActive && sequence === pdfLoadSequence;
    const savedView = restoreView ? {
      currentPage: pdfState.currentPage, isPreviewMode, tocRanges, recognitionIgnoreRegions, activeRangeIndex,
    } : null;
    if (!restoreView) {
      hasShownTocHint = false;
      showOffsetModal = false;
      showChapterExportModal = false;
      selectedChapterExportIds = [];
      pendingTocItems = [];
      firstTocItem = null;
    }
    const fingerprint = `${file.name}_${file.size}`;
    curFileFingerprint.set(fingerprint);
    localStorage.setItem('tocify_last_fingerprint', fingerprint);
    tocItems.set(restoreView ? $tocItems : []);
    workspacePdfFiles.update((files) => ({...files, toc: file}));

    try {
      await releasePdfResources();
      if (!isCurrent()) return;
      pdfState = {...pdfState, filename: file.name, totalPages: 0};
      await loadPdfLibraries();
      if (!isCurrent() || !pdfjs || !PdfLib) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent()) return;
      const doc = await PdfLib.PDFDocument.load(bytes);
      if (!isCurrent()) return;
      PDFService.sanitizePdfMetadata(doc);
      pdfState = {...pdfState, doc};
      lastInsertAtPage = config.insertAtPage || 2;
      if (!restoreView) {
        const page = doc.getPage(doc.getPageCount() > 1 ? 1 : 0);
        const layout = PDFService.getAutoLayout(page.getSize().width);
        tocConfig.update((c) => ({...c,
          firstLevel: {...c.firstLevel, fontSize: layout.fontSizeL1},
          otherLevels: {...c.otherLevels, fontSize: layout.fontSizeLOther},
        }));
      }
      const task = pdfjs.getDocument({
        data: bytes,
        worker: PDFService.getSharedWorker(),
          cMapUrl: IS_LOCAL ? '/local-assets/cmaps/' : `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
        cMapPacked: true,
      });
      pdfLoadingTasks.add(task);
      const instance = await task.promise.finally(() => pdfLoadingTasks.delete(task));
      if (!isCurrent()) {
        await instance.destroy();
        return;
      }
      originalPdfInstance = instance;
      tocPageCount = 0;
      isPreviewMode = savedView?.isPreviewMode || false;
      pdfState.currentPage = Math.min(savedView?.currentPage || 1, instance.numPages);
      tocRanges = savedView?.tocRanges || [{start: 1, end: 1, id: 'default'}];
      recognitionIgnoreRegions = savedView?.recognitionIgnoreRegions || [];
      activeRangeIndex = savedView?.activeRangeIndex || 0;

      if (!restoreView) {
        const session = localStorage.getItem(`toc_draft_${fingerprint}`);
        if (session) {
          const {items, pageOffset} = JSON.parse(session);
          tocItems.set(cleanTocItems(items));
          updateTocField('pageOffset', pageOffset);
        } else {
          const outline = await instance.getOutline();
          const items = outline?.length ? await convertPdfJsOutlineToTocItems(outline, instance) : [];
          if (!isCurrent()) return;
          tocItems.set(items);
          updateTocField('pageOffset', 0);
          if (items.length) toastProps = {show: true, message: $t('toast.raw_toc_imported'), type: 'info'};
        }
      }
      lastPdfContentJson = JSON.stringify(getPdfEffectiveData($tocItems));
      prepareTocInBackground();
      if (showLoadHint) toastProps = {show: true, message: $t('msg.pdf_loaded'), type: 'success'};
    } catch (error: any) {
      if (!isCurrent() || error.name === 'AbortError') return;
      await releasePdfResources();
      curFileFingerprint.set('');
      console.error('Error loading PDF:', error);
      toastProps = {show: true, message: $t('toast.error_loading_pdf', {values: {msg: error.message}}), type: 'error'};
    } finally {
      if (isCurrent()) {
        updateViewerInstance();
        isFileLoading = false;
        autoSaveEnabled.set(true);
        if (originalPdfInstance && isPreviewMode) void updatePDF().catch(() => {});
      }
    }
  };

  const exportPDF = async () => {
    if (isExporting || isFileLoading) return;
    isExporting = true;
    const sourceDoc = pdfState.doc;
    const filename = pdfState.filename;
    try {
      toastProps = {show: true, message: $t('toast.exporting'), type: 'info'};
      const document = await updatePDF(true);
      if (sourceDoc !== pdfState.doc || !isViewActive) return;
      if (!document) {
        toastProps = {show: true, message: $t('toast.no_pdf_to_export'), type: 'error'};
        return;
      }
      const pdfBytes = await document.save();
      if (sourceDoc !== pdfState.doc || !isViewActive) return;

      const saved = await savePdfBytes(
        pdfBytes,
        filename.replace(/\.pdf$/i, '_outlined.pdf'),
      );
      if (!saved) {
        return;
      }
      toastProps = {show: true, message: $t('toast.export_success'), type: 'success'};

      setTimeout(() => {
        const isDismissed = localStorage.getItem('tocify_hide_star_request') === 'true';
        if (!isDismissed) {
          if (Math.random() < 1 / 33) {
            showStarRequestModal = true;
          }
        }
      }, 1000);
    } catch (error: any) {
      if (sourceDoc !== pdfState.doc || !isViewActive) return;
      console.error('Error exporting PDF:', error);
      toastProps = {show: true, message: $t('toast.error_exporting', {values: {msg: error.message}}), type: 'error'};
    } finally {
      isExporting = false;
    }
  };

  function openChapterExportModal() {
    selectedChapterExportIds = [];
    chapterExportMode = 'separate';
    showChapterExportModal = true;
  }

  async function exportSelectedChapters() {
    if (isExporting || isFileLoading) return;
    isExporting = true;
    const sequence = pdfLoadSequence;
    const sourceDoc = pdfState.doc;
    const sourceItems = structuredClone($tocItems);
    const pageOffset = $tocConfig.pageOffset || 0;
    const filename = pdfState.filename;
    const isCurrent = () => isViewActive && sequence === pdfLoadSequence && sourceDoc === pdfState.doc;
    try {
      if (!PdfLib || !sourceDoc || !originalPdfInstance) {
        toastProps = {show: true, message: $t('toast.no_pdf_to_export'), type: 'error'};
        return;
      }

      const selectedChapters = chapterExportItems.filter((item) =>
        selectedChapterExportIds.includes(item.id),
      );
      const selectedRootChapters = filterSelectedChapterRoots(selectedChapters, chapterExportItems);

      if (selectedChapters.length === 0) {
        toastProps = {show: true, message: $t('toast.no_chapters_selected'), type: 'error'};
        return;
      }

      toastProps = {show: true, message: $t('toast.exporting_chapters'), type: 'info'};

      const {PDFDocument} = PdfLib;

      if (chapterExportMode === 'merge') {
        const mergedDoc = await PDFDocument.create();
        const mergedRanges = mergeChapterRanges(selectedChapters);
        const pageMap = createPageMapForRanges(mergedRanges);

        for (const range of mergedRanges) {
          const pageIndices = Array.from(
            {length: range.endPage - range.startPage + 1},
            (_, index) => range.startPage - 1 + index,
          );
          const copiedPages = await mergedDoc.copyPages(sourceDoc, pageIndices);
          if (!isCurrent()) return;
          copiedPages.forEach((page) => mergedDoc.addPage(page));
        }

        PDFService.sanitizePdfMetadata(mergedDoc);
        const mergedOutline = selectedRootChapters
          .map((chapter) => findTocItemById(sourceItems, chapter.id))
          .filter(Boolean)
          .map((item) => buildOutlineTreeForExport(item as TocItem, pageMap, pageOffset))
          .filter(Boolean) as TocItem[];

        if (mergedOutline.length > 0) {
          await setOutline(mergedDoc, mergedOutline);
        }

        const mergedBytes = await mergedDoc.save();
        if (!isCurrent()) return;
        const saved = await savePdfBytes(
          mergedBytes,
          getMergedChapterFilename(filename, selectedChapters),
        );
        if (!saved) return;
      } else {
        const shouldZipSeparateExport =
          selectedRootChapters.length > SEPARATE_EXPORT_ZIP_THRESHOLD;
        const zipEntries: ZipFileEntry[] = [];
        const usedZipFilenames = new Set<string>();

        for (const chapter of selectedRootChapters) {
          const chapterDoc = await PDFDocument.create();
          const pageIndices = Array.from(
            {length: chapter.endPage - chapter.startPage + 1},
            (_, index) => chapter.startPage - 1 + index,
          );
          const copiedPages = await chapterDoc.copyPages(sourceDoc, pageIndices);
          if (!isCurrent()) return;
          copiedPages.forEach((page) => chapterDoc.addPage(page));
          PDFService.sanitizePdfMetadata(chapterDoc);
          const pageMap = createPageMapForRanges([
            {startPage: chapter.startPage, endPage: chapter.endPage},
          ]);
          const chapterItem = findTocItemById(sourceItems, chapter.id);
          const chapterOutline = chapterItem
            ? buildOutlineTreeForExport(chapterItem, pageMap, pageOffset)
            : null;

          if (chapterOutline) {
            await setOutline(chapterDoc, [chapterOutline]);
          }

          const chapterBytes = await chapterDoc.save();
          if (!isCurrent()) return;
          const chapterFilename = getChapterFilename(filename, chapter);

          if (shouldZipSeparateExport) {
            zipEntries.push({
              name: getUniqueZipFilename(chapterFilename, usedZipFilenames),
              data: chapterBytes,
            });
          } else {
            const saved = await savePdfBytes(chapterBytes, chapterFilename, false);
            if (!saved) return;
          }
        }

        if (shouldZipSeparateExport) {
          const saved = await saveBlob(
            createZipBlob(zipEntries),
            getChapterArchiveFilename(filename, selectedRootChapters),
            {
              description: 'ZIP Archive',
              accept: {'application/zip': ['.zip']},
            },
          );
          if (!saved) return;
        }
      }

      if (!isCurrent()) return;
      showChapterExportModal = false;
      toastProps = {show: true, message: $t('toast.export_chapters_success'), type: 'success'};
    } catch (error: any) {
      if (!isCurrent()) return;
      console.error('Error exporting chapters:', error);
      toastProps = {show: true, message: $t('toast.error_exporting', {values: {msg: error.message}}), type: 'error'};
    } finally {
      isExporting = false;
    }
  }

  const generateTocFromAI = async () => {

    if (!originalPdfInstance) {
      toastProps = {show: true, message: $t('toast.load_pdf_first'), type: 'error'};
      return;
    }

    activeAiController?.abort();
    const controller = new AbortController();
    activeAiController = controller;
    const instance = originalPdfInstance;
    const isCurrent = () => !controller.signal.aborted && isViewActive && instance === originalPdfInstance;
    isAiLoading = true;
    aiError = null;
    aiWarning = null;
    aiProgress = null;

    try {
      const res = await generateToc({
        signal: controller.signal,
        pdfInstance: instance,
        ranges: tocRanges,
        apiKey: customApiConfig.apiKey,
        provider: customApiConfig.provider,
        customBaseUrl: customApiConfig.customBaseUrl,
        doubaoEndpointIdText: customApiConfig.doubaoEndpointIdText,
        doubaoEndpointIdVision: customApiConfig.doubaoEndpointIdVision,
        modelOverrides: customApiConfig.modelOverrides,
        visionPrompt: customApiConfig.visionPrompt,
        pagesPerRequest: customApiConfig.pagesPerRequest,
        recognitionIgnoreRegions,
        onProgress: (current, total) => {
          if (isCurrent()) aiProgress = {current, total};
        },
      });

      if (!isCurrent()) return;
      const { items, chunkFailures: failures, chunkWarnings: warnings } = res;

      if (warnings.length > 0) {
        aiWarning = warnings
          .map(w => $t('error.chunk_incomplete', {values: {pages: formatPageRanges(w.pages), count: w.itemCount}}))
          .join('\n');
      }

      if (failures.length > 0) {
        aiError = failures
          .map(f => $t('error.chunk_failed', { values: { pages: formatPageRanges(f.pages), reason: f.error } }))
          .join('\n');
      }

      if (!items || items.length === 0) {
        aiError ||= $t('toast.no_valid_toc');
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
      if (!isCurrent()) return;
      console.error('Error generating ToC from AI:', error);
      if (error.code === ERROR_NEEDS_API_KEY) {
        isTocConfigExpanded = false;
        toastProps = {show: true, message: error.message, type: 'error', duration: 6000};
      } else {
        aiError = error.message;
        toastProps = {show: true, message: error.message, type: 'error'};
      }
    } finally {
      if (activeAiController === controller) {
        activeAiController = null;
        isAiLoading = false;
        aiProgress = null;
      }
    }
  };
  
  const handleAiFormatResponse = (e: any) => {
    const { items } = e.detail;
    aiWarning = e.detail.incomplete ? $t('error.text_incomplete') : null;
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

  function openRecognitionIgnoreEditor(e: CustomEvent<{pageNum: number}>) {
    recognitionIgnoreEditor?.openEditor(e.detail.pageNum);
  }

  const handleViewerMessage = (event: CustomEvent<{message: string; type: 'success' | 'error' | 'info'}>) => {
    toastProps = {show: true, message: event.detail.message, type: event.detail.type};
  };

  let shortcutFileInput: HTMLInputElement;

  function handleShortcutFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) loadPdfFile(file);
    input.value = '';
  }

  /** Page-level shortcuts; the ToC tree, preview and dialogs handle their own keys first. */
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (!e.key || e.defaultPrevented || e.isComposing || e.repeat || isDialogOpen()) return;
    const key = e.key.toLowerCase();
    const mod = hasMod(e);

    if (mod && !e.altKey && !e.shiftKey && key === 'o') {
      e.preventDefault();
      shortcutFileInput?.click();
    } else if (mod && !e.altKey && key === 's') {
      // ⌘S exports, ⌘⇧S exports by chapter. Commit the field being typed in first.
      e.preventDefault();
      blurActiveField();
      if (!pdfState.doc) {
        toastProps = {show: true, message: $t('toast.no_pdf_to_export'), type: 'error'};
      } else if (e.shiftKey) {
        openChapterExportModal();
      } else {
        exportPDF();
      }
    } else if (mod && !e.altKey && !e.shiftKey && e.key === 'Enter') {
      // Inside the ToC, ⌘↩ belongs to the outline text (AI Format), not a fresh AI run.
      if (e.target instanceof Element && e.target.closest('.toc-tree')) return;
      e.preventDefault();
      blurActiveField();
      if (originalPdfInstance && !isAiLoading) generateTocFromAI();
    } else if (isBareKey(e) && !e.shiftKey && key === 'p' && !isEditableTarget(e.target)) {
      e.preventDefault();
      togglePreviewMode();
    } else if (e.key === 'Escape' && showGraphDrawer) {
      e.preventDefault();
      showGraphDrawer = false;
    }
  }
</script>

{#if !showGraphDrawer && tocItems && isGraphEntranceVisible}
  <button
    transition:fly={{x: -50, duration: 300}}
    class="fixed -left-1 p-1 md:p-2 md:left-0 top-[40vh] z-40 bg-white border-2 border-black border-l-0 rounded-r-lg shadow-[2px_2px_0px_0px_var(--hard-shadow-color)] hover:bg-yellow-200 transition-colors flex flex-col items-center gap-2 group"
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
    class="flex flex-col mt-5 lg:flex-row lg:items-start lg:mt-8 p-2 md:p-4 md:pr-3 gap-4 lg:gap-8 mx-auto w-[95%] md:w-[90%] xl:w-[80%] 3xl:w-[75%] max-w-6xl justify-between"
  >
    <SidebarPanel
      {pdfState}
      {originalPdfInstance}
      {tocPdfInstance}
      {isAiLoading}
      {aiError}
      {aiWarning}
      {config}
      {customApiConfig}
      {tocPageCount}
      {isPreviewMode}
      bind:tocRanges
      bind:activeRangeIndex
      bind:addPhysicalTocPage
      bind:isTocConfigExpanded
      on:openhelp={() => (showHelpModal = true)}
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
      {tocSelectionPageNumbers}
      {recognitionIgnoreRegions}
      {activeRangeIndex}
      {tocPageCount}
      {addPhysicalTocPage}
      {jumpToTocPage}
      {currentTocPath}
      {prefetchPageNum}
      bind:highlightPageNum
      bind:isDragging
      on:fileselect={(e) => loadPdfFile(e.detail)}
      on:updateActiveRange={handleUpdateActiveRange}
      on:togglePreview={togglePreviewMode}
      on:export={exportPDF}
      on:openChapterExport={openChapterExportModal}
      on:openRecognitionIgnore={openRecognitionIgnoreEditor}
      on:recognitionIgnoreRegionsChange={(e) => (recognitionIgnoreRegions = e.detail)}
    />
  </div>

  <RecognitionIgnoreEditor
    bind:this={recognitionIgnoreEditor}
    pdfInstance={originalPdfInstance}
    {tocRanges}
    {tocSelectionPageNumbers}
    ignoreRegions={recognitionIgnoreRegions}
    totalPages={originalPdfInstance?.numPages || pdfState.totalPages}
    on:change={(e) => (recognitionIgnoreRegions = e.detail)}
  />

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

  <ChapterExportModal
    bind:showChapterExportModal
    bind:selectedChapterIds={selectedChapterExportIds}
    bind:exportMode={chapterExportMode}
    chapters={chapterExportItems}
    on:confirm={exportSelectedChapters}
  />

  <StarRequestModal bind:show={showStarRequestModal} />
{/if}

<svelte:window on:beforeunload={handleBeforeUnload} on:keydown={handleGlobalKeydown} />

<input
  type="file"
  class="hidden"
  accept=".pdf,application/pdf"
  tabindex="-1"
  aria-hidden="true"
  bind:this={shortcutFileInput}
  on:change={handleShortcutFileChange}
/>


<style>
  .writing-mode-vertical {
    writing-mode: vertical-rl;
  }
</style>
