<script context="module" lang="ts">
  let ocrViewCache: any = null;
  let activeOcrRunPromise: Promise<void> | null = null;
  let activeOcrRunState: any = null;
  let activeOcrRunControl: { runId: number; cancelled: boolean } | null = null;
  let lastOcrRunSnapshot: any = null;
  let nextOcrRunId = 1;
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import * as pdfjsLib from 'pdfjs-dist';

  import '../../lib/i18n';
  import Footer from '../../components/Footer.svelte';
  import Header from '../../components/Header.svelte';
  import SeoJsonLd from '../../components/SeoJsonLd.svelte';
  import HelpModal from '../../components/modals/HelpModal.svelte';
  import { buildSearchablePdf, normalizeSearchableOcr } from '$lib/pdf/searchable';
  import { isLegacyBrowser } from '$lib/utils';
  import OcrControls from './OcrControls.svelte';
  import OcrPdfPreview from './OcrPdfPreview.svelte';
  import OcrResultTree from './OcrResultTree.svelte';
  import {
    clamp,
    getLineBBox,
    getLineMergeKey,
    markLineUserEdited,
    mergeIncomingOcrPage,
    type OcrBBox,
    sortLinesForReadingOrder,
  } from '$lib/ocr/geometry';
  import {
    convertLocalResult,
    renderPdfPageAsCanvas,
  } from '$lib/ocr/image-processing';
  import {
    INTERNAL_PAGE_BATCH_SIZE,
    INTERNAL_TEXT_DETECTION_BATCH_SIZE,
    INTERNAL_TEXT_RECOGNITION_BATCH_SIZE,
    OCR_BOX_EXTENSION_MAX,
    OCR_BOX_EXTENSION_MIN,
    OCR_BOX_EXTENSION_STEP,
    OCR_ENGINE_CREATE_TIMEOUT_MS,
    OCR_LINE_ID_KEY,
    OCR_MAX_WORKER_POOL_SIZE,
    OCR_MIN_WORKER_POOL_SIZE,
    OCR_MODEL_CONFIGS,
    OCR_PAGE_PREDICT_TIMEOUT_MS,
    OCR_RUNTIME_SETTINGS_STORAGE_KEY,
    OCR_SELECTION_HISTORY_LIMIT,
    OCR_TREE_STICKY_PAGE_HEIGHT,
    OCR_TREE_STICKY_PAGE_TOP,
    OCR_TREE_STICKY_SEARCH_TOP,
    PREVIEW_DEFAULT_SCALE,
    PREVIEW_LOCATED_BOX_HORIZONTAL_PADDING,
    PREVIEW_MAX_SCALE,
    PREVIEW_MIN_LOCATED_BOX_HEIGHT,
    PREVIEW_MIN_SCALE,
  } from '$lib/ocr/config';
  import type {
    DragMode,
    LocalOcrEngine,
    OcrBackend,
    OcrModelSize,
    OcrProgress,
    OcrResolutionQuality,
    OcrSelectionHistoryEntry,
    OcrSelectionState,
    OcrTreeSortMode,
  } from '$lib/ocr/types';
  import {
    clampOcrBoxExtension,
    clampOcrWorkerPoolSize,
    disposeLateOcrEngine,
    getEffectiveOcrWorkerPoolSize as resolveEffectiveOcrWorkerPoolSize,
    getOcrOrtRuntimeConfig,
    getOcrResolutionQualitySize,
    normalizeOcrModelSize,
    normalizeOcrResolutionQuality,
    shouldUseOcrWorker,
    supportsWorkerFetch,
    withTimeout,
  } from '$lib/ocr/runtime';

  class OcrRunCancelledError extends Error {
    constructor() {
      super('OCR run cancelled');
      this.name = 'OcrRunCancelledError';
    }
  }

  let pdfFile: File | null = null;
  let pdfBytes: Uint8Array | null = null;
  let pdfInstance: pdfjsLib.PDFDocumentProxy | null = null;
  let localOcrPool: LocalOcrEngine[] = [];
  let localOcrRuntimeKey = '';

  let isFileLoading = false;
  let isInitializingOcr = false;
  let isRunningOcr = false;
  let isCancellingOcr = false;
  let isBuilding = false;
  let showHelpModal = false;
  let isPreviewDragging = false;
  let previewDragDepth = 0;
  let ocrProgress: OcrProgress | null = null;
  let errorMessage = '';
  let lastLocalOcrError = '';

  let pageStart = 1;
  let pageEnd = 1;
  let ocrModelSize: OcrModelSize = 'tiny';
  let ocrWorkerPoolSize = 4;
  let ocrResolutionQuality: OcrResolutionQuality = 'standard';
  let ocrWatermarkCleanup = false;
  let ocrBoxExtension = 2.0;
  let ocrJson = '';
  let timingSummary = '';
  let editorDoc: any = null;
  let selectedPageNumber = 1;
  let selectedLineIndex = 0;
  let ocrTreeSearch = '';
  let ocrTreeSortMode: OcrTreeSortMode = 'reading';
  let ocrTreeScrollContainer: HTMLDivElement | null = null;
  let lastOcrTreeScrollKey = '';
  let ocrJsonSyncTimeout: number | null = null;
  let previewCanvas: HTMLCanvasElement | null = null;
  let previewDisplayWidth = 0;
  let previewDisplayHeight = 0;
  let previewWrapWidth = 0;
  let previewWrapHeight = 0;
  let previewScale = PREVIEW_DEFAULT_SCALE;
  let previewRenderKey = '';
  let previewRenderedKey = '';
  let isPreviewRendering = false;
  let previewScrollContainer: HTMLDivElement | null = null;
  let previewLocateSequence = 0;
  let previewEditingLineIndex: number | null = null;
  let previewEditingPageNumber: number | null = null;
  let previewEditingLineKey = '';
  let previewEditingText = '';
  let previewEditingTextarea: HTMLTextAreaElement | null = null;
  let lastSyncedCompletedRunId: number | null = null;
  let nextOcrLineEditorId = 1;
  let ocrUndoStack: OcrSelectionHistoryEntry[] = [];
  let ocrRedoStack: OcrSelectionHistoryEntry[] = [];
  let dragState: {
    pointerId: number;
    mode: DragMode;
    startX: number;
    startY: number;
    original: OcrBBox;
    targetLine: any;
    pageNumber: number;
    lineIndex: number;
    lineId: string;
    selectionBefore: OcrSelectionState;
  } | null = null;
  let newSelectionState: {
    pointerId: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null = null;
  let ocrRunSyncInterval: number | null = null;

  restoreOcrViewCache();
  syncOcrRunStateFromModule();

  const resizeHandles: [DragMode, string][] = [
    ['top-left', '-left-1.5 -top-1.5 cursor-nwse-resize'],
    ['top', 'left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize'],
    ['top-right', '-right-1.5 -top-1.5 cursor-nesw-resize'],
    ['right', '-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize'],
    ['bottom-right', '-right-1.5 -bottom-1.5 cursor-nwse-resize'],
    ['bottom', 'left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize'],
    ['bottom-left', '-left-1.5 -bottom-1.5 cursor-nesw-resize'],
    ['left', '-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize'],
  ];

  $: editorPages = Array.isArray(editorDoc?.pages) ? editorDoc.pages : [];
  $: selectedPageData = editorPages.find((page: any) => Number(page?.page) === Number(selectedPageNumber));
  $: selectedLines = Array.isArray(selectedPageData?.lines) ? selectedPageData.lines : [];
  $: selectedLine = selectedLines[selectedLineIndex] ?? null;
  $: flatOcrLines = editorPages.flatMap((page: any) =>
    (Array.isArray(page?.lines) ? page.lines : []).map((line: any, lineIndex: number) => {
      const pageNumber = Number(page?.page);
      return {
        pageNumber,
        lineIndex,
        line,
        score: getOcrLineScore(line),
      };
    }),
  );
  $: ocrTreeSearchTerm = ocrTreeSearch.trim().toLowerCase();
  $: searchedOcrLines = ocrTreeSearchTerm
    ? flatOcrLines.filter((item: any) => {
      const text = String(item.line?.text ?? '').toLowerCase();
      const page = String(item.pageNumber);
      return text.includes(ocrTreeSearchTerm)
        || page.includes(ocrTreeSearchTerm)
        || `p${page}`.includes(ocrTreeSearchTerm);
    })
    : flatOcrLines;
  $: filteredOcrLines = ocrTreeSortMode === 'confidence'
    ? [...searchedOcrLines].sort((a, b) => {
      const scoreDelta = a.score - b.score;
      if (scoreDelta !== 0) return scoreDelta;
      return a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex;
    })
    : searchedOcrLines;
  $: selectedTreeScrollKey = `${Number(selectedPageNumber)}:${Number(selectedLineIndex)}:${ocrTreeSearchTerm}`;
  $: if (selectedPageData && selectedLineIndex >= selectedLines.length) {
    selectedLineIndex = Math.max(0, selectedLines.length - 1);
  }
  $: if ((isInitializingOcr || isRunningOcr) && selectedTreeScrollKey !== lastOcrTreeScrollKey) {
    lastOcrTreeScrollKey = selectedTreeScrollKey;
  }
  $: if (
    !isInitializingOcr
    && !isRunningOcr
    && ocrTreeScrollContainer
    && flatOcrLines.length
    && selectedTreeScrollKey !== lastOcrTreeScrollKey
  ) {
    lastOcrTreeScrollKey = selectedTreeScrollKey;
    void scrollSelectedOcrTreeItem();
  }
  $: if (pdfInstance && selectedPageNumber && previewCanvas && previewWrapWidth && previewWrapHeight) {
    const nextPreviewRenderKey = `${selectedPageNumber}:${previewWrapWidth}:${previewWrapHeight}:${previewScale}:${selectedPageData?.imageWidth ?? 0}:${selectedPageData?.imageHeight ?? 0}`;
    if (nextPreviewRenderKey !== previewRenderKey) {
      previewRenderKey = nextPreviewRenderKey;
      void renderPreviewPage();
    }
  }
  $: ocrProgressPercent = ocrProgress
    ? Math.max(0, Math.min(100, Math.round((ocrProgress.current / Math.max(1, ocrProgress.total)) * 100)))
    : 0;
  pdfjsLib.GlobalWorkerOptions.workerSrc = isLegacyBrowser() ? '/pdf.worker.legacy.min.mjs' : '/pdf.worker.min.mjs';

  function applyOcrRunPatch(patch: Record<string, any>) {
    if ('isInitializingOcr' in patch && patch.isInitializingOcr !== isInitializingOcr) isInitializingOcr = patch.isInitializingOcr;
    if ('isRunningOcr' in patch && patch.isRunningOcr !== isRunningOcr) isRunningOcr = patch.isRunningOcr;
    if ('isCancellingOcr' in patch && patch.isCancellingOcr !== isCancellingOcr) isCancellingOcr = patch.isCancellingOcr;
    if ('ocrProgress' in patch && patch.ocrProgress !== ocrProgress) ocrProgress = patch.ocrProgress;
    if ('errorMessage' in patch && patch.errorMessage !== errorMessage) errorMessage = patch.errorMessage;
    if ('timingSummary' in patch && patch.timingSummary !== timingSummary) timingSummary = patch.timingSummary;
    if ('ocrJson' in patch && patch.ocrJson !== ocrJson) ocrJson = patch.ocrJson;
    if ('editorDoc' in patch && patch.editorDoc !== editorDoc) editorDoc = patch.editorDoc;
    if ('pageStart' in patch && patch.pageStart !== pageStart) pageStart = patch.pageStart;
    if ('pageEnd' in patch && patch.pageEnd !== pageEnd) pageEnd = patch.pageEnd;
    if ('selectedPageNumber' in patch && patch.selectedPageNumber !== selectedPageNumber) selectedPageNumber = patch.selectedPageNumber;
    if ('selectedLineIndex' in patch && patch.selectedLineIndex !== selectedLineIndex) selectedLineIndex = patch.selectedLineIndex;
    if ('ocrModelSize' in patch && patch.ocrModelSize !== ocrModelSize) ocrModelSize = normalizeOcrModelSize(patch.ocrModelSize);
    if ('ocrWatermarkCleanup' in patch && patch.ocrWatermarkCleanup !== ocrWatermarkCleanup) ocrWatermarkCleanup = Boolean(patch.ocrWatermarkCleanup);
    if ('ocrBoxExtension' in patch && patch.ocrBoxExtension !== ocrBoxExtension) ocrBoxExtension = clampOcrBoxExtension(patch.ocrBoxExtension);
    if ('lastLocalOcrError' in patch && patch.lastLocalOcrError !== lastLocalOcrError) lastLocalOcrError = patch.lastLocalOcrError;

    if (activeOcrRunState) {
      const hasActiveStateChanges = Object.entries(patch).some(
        ([key, value]) => activeOcrRunState[key] !== value,
      );
      if (hasActiveStateChanges) {
        activeOcrRunState = { ...activeOcrRunState, ...patch };
        lastOcrRunSnapshot = { ...activeOcrRunState };
      }
    }
  }

  function syncOcrRunStateFromModule() {
    const snapshot = activeOcrRunState || lastOcrRunSnapshot;
    if (!snapshot) return;
    if (snapshot.pdfBytes && pdfBytes && snapshot.pdfBytes !== pdfBytes) return;
    const isActiveSnapshot = Boolean(activeOcrRunPromise || snapshot.isRunningOcr || snapshot.isInitializingOcr || snapshot.isCancellingOcr);
    if (!isActiveSnapshot && lastSyncedCompletedRunId === snapshot.runId) return;

    applyOcrRunPatch({
      isInitializingOcr: Boolean(snapshot.isInitializingOcr),
      isRunningOcr: Boolean(snapshot.isRunningOcr),
      isCancellingOcr: Boolean(snapshot.isCancellingOcr),
      ocrProgress: snapshot.ocrProgress ?? null,
      errorMessage: snapshot.errorMessage ?? '',
      timingSummary: snapshot.timingSummary ?? timingSummary,
      ocrJson: snapshot.ocrJson ?? ocrJson,
      editorDoc: snapshot.editorDoc ?? editorDoc,
      pageStart: snapshot.pageStart ?? pageStart,
      pageEnd: snapshot.pageEnd ?? pageEnd,
      ocrModelSize: snapshot.ocrModelSize ?? ocrModelSize,
      ocrWatermarkCleanup: snapshot.ocrWatermarkCleanup ?? ocrWatermarkCleanup,
      ocrBoxExtension: snapshot.ocrBoxExtension ?? ocrBoxExtension,
      lastLocalOcrError: snapshot.lastLocalOcrError ?? lastLocalOcrError,
    });
    if (!isActiveSnapshot) {
      lastSyncedCompletedRunId = snapshot.runId ?? lastSyncedCompletedRunId;
    }
  }

  function looksLikePdf(bytes: Uint8Array) {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    );
  }

  onMount(() => {
    restoreOcrRuntimeSettings();
    syncOcrRunStateFromModule();
    ocrRunSyncInterval = window.setInterval(syncOcrRunStateFromModule, 250);

    return () => {
      if (ocrRunSyncInterval) {
        window.clearInterval(ocrRunSyncInterval);
        ocrRunSyncInterval = null;
      }
      if (ocrJsonSyncTimeout !== null) {
        window.clearTimeout(ocrJsonSyncTimeout);
        ocrJsonSyncTimeout = null;
      }
    };
  });

  onDestroy(() => {
    saveOcrViewCache();
  });

  function restoreOcrViewCache() {
    if (!ocrViewCache) return;

    ({
      pdfFile,
      pdfBytes,
      pdfInstance,
      localOcrRuntimeKey,
      pageStart,
      pageEnd,
      ocrModelSize,
      ocrWatermarkCleanup,
      ocrWorkerPoolSize,
      ocrResolutionQuality,
      ocrBoxExtension,
      ocrJson,
      timingSummary,
      editorDoc,
      selectedPageNumber,
      selectedLineIndex,
      ocrTreeSearch,
      ocrTreeSortMode,
      previewScale,
      lastLocalOcrError,
    } = ocrViewCache);

    ocrWorkerPoolSize = clampOcrWorkerPoolSize(ocrWorkerPoolSize);
    ocrModelSize = normalizeOcrModelSize(ocrModelSize);
    ocrWatermarkCleanup = Boolean(ocrWatermarkCleanup);
    ocrResolutionQuality = normalizeOcrResolutionQuality(ocrResolutionQuality);
    ocrBoxExtension = clampOcrBoxExtension(ocrBoxExtension);

    localOcrPool = Array.isArray(ocrViewCache.localOcrPool)
      ? ocrViewCache.localOcrPool
      : ocrViewCache.localOcr
        ? [ocrViewCache.localOcr]
        : [];

    if (localOcrPool.length && localOcrRuntimeKey !== getLocalOcrRuntimeKey()) {
      const stalePool = localOcrPool;
      localOcrPool = [];
      localOcrRuntimeKey = '';
      void Promise.all(stalePool.map((ocr) => ocr.dispose().catch(() => undefined)));
    }

    isFileLoading = false;
    isInitializingOcr = false;
    isRunningOcr = false;
    isCancellingOcr = false;
    isBuilding = false;
    showHelpModal = false;
    isPreviewDragging = false;
    ocrProgress = null;
    errorMessage = '';
  }

  function saveOcrViewCache() {
    ocrViewCache = {
      pdfFile,
      pdfBytes,
      pdfInstance,
      localOcrPool,
      localOcrRuntimeKey,
      pageStart,
      pageEnd,
      ocrModelSize,
      ocrWatermarkCleanup,
      ocrWorkerPoolSize,
      ocrResolutionQuality,
      ocrBoxExtension,
      ocrJson,
      timingSummary,
      editorDoc,
      selectedPageNumber,
      selectedLineIndex,
      ocrTreeSearch,
      ocrTreeSortMode,
      previewScale,
      lastLocalOcrError,
    };
  }

  function resetStateForNewFile() {
    clearOcrSelectionHistory();
    errorMessage = '';
    ocrProgress = null;
    timingSummary = '';
    editorDoc = null;
    ocrJson = '';
    isCancellingOcr = false;
    ocrTreeSearch = '';
    ocrTreeSortMode = 'reading';
    selectedLineIndex = 0;
    pageStart = 1;
    pageEnd = 1;
    selectedPageNumber = 1;
    previewDisplayWidth = 0;
    previewDisplayHeight = 0;
  }

  function getEffectiveOcrWorkerPoolSize() {
    return resolveEffectiveOcrWorkerPoolSize(ocrWorkerPoolSize);
  }

  function restoreOcrRuntimeSettings() {
    if (typeof window === 'undefined') return;

    try {
      const rawSettings = window.localStorage.getItem(OCR_RUNTIME_SETTINGS_STORAGE_KEY);
      if (!rawSettings) return;

      const settings = JSON.parse(rawSettings);
      ocrModelSize = normalizeOcrModelSize(settings?.modelSize);
      ocrWorkerPoolSize = clampOcrWorkerPoolSize(settings?.workerPoolSize);
      ocrResolutionQuality = normalizeOcrResolutionQuality(settings?.resolutionQuality);
      ocrWatermarkCleanup = Boolean(settings?.watermarkCleanup);
      ocrBoxExtension = clampOcrBoxExtension(settings?.boxExtension);
    } catch {
      // Ignore corrupted user preferences and fall back to defaults.
    }
  }

  function persistOcrRuntimeSettings() {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(
        OCR_RUNTIME_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          modelSize: normalizeOcrModelSize(ocrModelSize),
          workerPoolSize: clampOcrWorkerPoolSize(ocrWorkerPoolSize),
          resolutionQuality: normalizeOcrResolutionQuality(ocrResolutionQuality),
          watermarkCleanup: Boolean(ocrWatermarkCleanup),
          boxExtension: clampOcrBoxExtension(ocrBoxExtension),
        }),
      );
    } catch {
      // Storage may be unavailable in private browsing or restricted contexts.
    }
  }

  function getOcrQualitySize() {
    return getOcrResolutionQualitySize(ocrResolutionQuality);
  }

  function clampOcrPageNumber(value: unknown, totalPages = pdfInstance?.numPages || 1) {
    const page = Math.floor(Number(value));
    if (!Number.isFinite(page)) return 1;
    return Math.max(1, Math.min(totalPages, page));
  }

  function normalizeOcrPageRange(
    start: unknown = pageStart,
    end: unknown = pageEnd,
    totalPages = pdfInstance?.numPages || 1,
  ) {
    const safeStart = clampOcrPageNumber(start, totalPages);
    const safeEnd = clampOcrPageNumber(end, totalPages);

    return safeStart <= safeEnd
      ? { start: safeStart, end: safeEnd }
      : { start: safeEnd, end: safeStart };
  }

  function handleOcrPageRangeChange(options: { start?: unknown; end?: unknown } = {}) {
    const range = normalizeOcrPageRange(
      'start' in options ? options.start : pageStart,
      'end' in options ? options.end : pageEnd,
    );

    pageStart = range.start;
    pageEnd = range.end;
  }

  function getOcrLineScore(lineOrItem: any) {
    const score = Number(lineOrItem?.score ?? lineOrItem?.line?.score);
    return Number.isFinite(score) ? score : Number.POSITIVE_INFINITY;
  }

  function getHighlightedTextSegments(text: unknown, searchTerm: string) {
    const value = String(text ?? '');
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return [{ text: value, hit: false }];

    const segments: { text: string; hit: boolean }[] = [];
    const lowerValue = value.toLowerCase();
    let cursor = 0;
    let matchIndex = lowerValue.indexOf(needle);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        segments.push({ text: value.slice(cursor, matchIndex), hit: false });
      }

      const nextCursor = matchIndex + needle.length;
      segments.push({ text: value.slice(matchIndex, nextCursor), hit: true });
      cursor = nextCursor;
      matchIndex = lowerValue.indexOf(needle, cursor);
    }

    if (cursor < value.length) {
      segments.push({ text: value.slice(cursor), hit: false });
    }

    return segments.length ? segments : [{ text: value, hit: false }];
  }

  function doesOcrPageMatchSearch(item: any, searchTerm: string) {
    if (!searchTerm) return false;
    const page = String(item?.pageNumber ?? '');
    return page.includes(searchTerm) || `p${page}`.includes(searchTerm);
  }

  function setOcrTreeSortMode(mode: OcrTreeSortMode) {
    if (ocrTreeSortMode === mode) return;
    ocrTreeSortMode = mode;

    void tick().then(() => {
      if (!ocrTreeScrollContainer || typeof window === 'undefined') return;
      const rect = ocrTreeScrollContainer.getBoundingClientRect();
      const listTop = rect.top + (window.scrollY || document.documentElement.scrollTop || 0);
      window.scrollTo({
        top: Math.max(0, listTop - OCR_TREE_STICKY_PAGE_TOP),
        behavior: 'auto',
      });
    });
  }

  function autosizeTextarea(node: HTMLTextAreaElement, text: string) {
    let previousText = text;

    const resize = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };

    node.addEventListener('input', resize);
    void tick().then(resize);

    return {
      update(nextText: string) {
        if (nextText === previousText) return;
        previousText = nextText;
        void tick().then(resize);
      },
      destroy() {
        node.removeEventListener('input', resize);
      },
    };
  }

  function getLocalOcrRuntimeKey() {
    const ortRuntime = getOcrOrtRuntimeConfig();
    return [
      `model:${ocrModelSize}`,
      `quality:${ocrResolutionQuality}`,
      `workers:${getEffectiveOcrWorkerPoolSize()}`,
      `execution:${shouldUseOcrWorker() ? 'worker' : 'main'}`,
      `ort:${ortRuntime.runtime}`,
      `backend:${ortRuntime.backend}`,
      `page:${INTERNAL_PAGE_BATCH_SIZE}`,
      `det:${INTERNAL_TEXT_DETECTION_BATCH_SIZE}`,
      `rec:${INTERNAL_TEXT_RECOGNITION_BATCH_SIZE}`,
    ].join('|');
  }

  function isOcrRunCancelled(control: { runId: number; cancelled: boolean } | null) {
    return Boolean(control && (control.cancelled || activeOcrRunControl !== control));
  }

  function assertOcrRunActive(control: { runId: number; cancelled: boolean } | null) {
    if (isOcrRunCancelled(control)) {
      throw new OcrRunCancelledError();
    }
  }

  function isOcrRunCancelledError(error: unknown) {
    return error instanceof OcrRunCancelledError;
  }

  function cancelLocalOcr() {
    if (!activeOcrRunControl || !activeOcrRunPromise) return;
    activeOcrRunControl.cancelled = true;
    applyOcrRunPatch({
      isCancellingOcr: true,
    });
  }

  function handleOcrRuntimeSettingChange(
    options: { modelSize?: unknown; workerPoolSize?: unknown; resolutionQuality?: unknown; watermarkCleanup?: unknown; boxExtension?: unknown } = {},
  ) {
    const nextModelSize = normalizeOcrModelSize(
      'modelSize' in options ? options.modelSize : ocrModelSize,
    );
    const nextWorkerPoolSize = clampOcrWorkerPoolSize(
      'workerPoolSize' in options ? options.workerPoolSize : ocrWorkerPoolSize,
    );
    const nextResolutionQuality = normalizeOcrResolutionQuality(
      'resolutionQuality' in options ? options.resolutionQuality : ocrResolutionQuality,
    );
    const nextWatermarkCleanup = Boolean(
      'watermarkCleanup' in options ? options.watermarkCleanup : ocrWatermarkCleanup,
    );
    const nextBoxExtension = clampOcrBoxExtension(
      'boxExtension' in options ? options.boxExtension : ocrBoxExtension,
    );
    const shouldDisposeOcrPool = nextModelSize !== ocrModelSize
      || nextWorkerPoolSize !== ocrWorkerPoolSize
      || nextResolutionQuality !== ocrResolutionQuality;

    ocrModelSize = nextModelSize;
    ocrWorkerPoolSize = nextWorkerPoolSize;
    ocrResolutionQuality = nextResolutionQuality;
    ocrWatermarkCleanup = nextWatermarkCleanup;
    ocrBoxExtension = nextBoxExtension;
    persistOcrRuntimeSettings();

    if (shouldDisposeOcrPool && localOcrPool.length) {
      void disposeLocalOcrPool();
    }
  }

  async function loadPdf(file: File) {
    isFileLoading = true;
    errorMessage = '';

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (!looksLikePdf(bytes)) {
        throw new Error($t('ocr_lab.errors.not_pdf'));
      }

      if (pdfInstance) {
        await pdfInstance.destroy().catch(() => undefined);
      }

      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
      const instance = await loadingTask.promise;

      pdfFile = file;
      pdfBytes = bytes.slice();
      pdfInstance = instance;
      pageStart = 1;
      pageEnd = instance.numPages;
      selectedPageNumber = 1;
      resetPreviewViewForDocument();
    } catch (error: any) {
      errorMessage = error?.message || $t('ocr_lab.errors.load_failed');
    } finally {
      isFileLoading = false;
    }
  }

  async function handleFileChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    resetStateForNewFile();
    await loadPdf(file);
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    previewDragDepth = 0;
    isPreviewDragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    resetStateForNewFile();
    await loadPdf(file);
  }

  function handlePreviewDragEnter(event: DragEvent) {
    event.preventDefault();
    previewDragDepth += 1;
    isPreviewDragging = true;
  }

  function handlePreviewDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    isPreviewDragging = true;
  }

  function handlePreviewDragLeave(event: DragEvent) {
    event.preventDefault();
    previewDragDepth = Math.max(0, previewDragDepth - 1);
    if (previewDragDepth === 0) {
      isPreviewDragging = false;
    }
  }

  function parseJson(options: { syncSelection?: boolean } = {}) {
    const syncSelection = options.syncSelection ?? true;
    errorMessage = '';
    const sourceDoc = editorDoc ?? JSON.parse(ocrJson);
    const parsed = normalizeSearchableOcr(sourceDoc);
    if (!editorDoc) {
      editorDoc = sourceDoc;
    }
    if (syncSelection && parsed.pages.length > 0 && !parsed.pages.some((page) => page.page === selectedPageNumber)) {
      selectedPageNumber = parsed.pages[0].page;
      selectedLineIndex = 0;
    }
    return parsed;
  }

  function upsertIncrementalOcrPage(pageResult: any) {
    const existingPages = Array.isArray(editorDoc?.pages) ? editorDoc.pages : [];
    const pageNumber = Number(pageResult?.page);
    const nextPages = [...existingPages];
    const existingIndex = nextPages.findIndex((page: any) => Number(page?.page) === pageNumber);
    const mergedPage = mergeIncomingOcrPage(existingIndex >= 0 ? nextPages[existingIndex] : null, pageResult);

    if (existingIndex >= 0) {
      nextPages[existingIndex] = mergedPage;
    } else {
      nextPages.push(mergedPage);
    }

    nextPages.sort((a: any, b: any) => Number(a?.page) - Number(b?.page));
    editorDoc = { ...(editorDoc || {}), pages: nextPages };
    syncJsonFromEditor();
  }

  function flushOcrJsonFromEditor() {
    if (!editorDoc) return ocrJson;
    if (ocrJsonSyncTimeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(ocrJsonSyncTimeout);
      ocrJsonSyncTimeout = null;
    }
    ocrJson = JSON.stringify(editorDoc, null, 2);
    applyOcrRunPatch({ ocrJson });
    return ocrJson;
  }

  function scheduleOcrJsonSync() {
    if (!editorDoc) return;
    if (typeof window === 'undefined') {
      flushOcrJsonFromEditor();
      return;
    }

    if (ocrJsonSyncTimeout !== null) {
      window.clearTimeout(ocrJsonSyncTimeout);
    }

    ocrJsonSyncTimeout = window.setTimeout(() => {
      ocrJsonSyncTimeout = null;
      if (!editorDoc) return;
      ocrJson = JSON.stringify(editorDoc, null, 2);
      applyOcrRunPatch({ ocrJson });
    }, 180);
  }

  function syncJsonFromEditor(validate = false) {
    if (!editorDoc) return;
    if (validate) {
      parseJson();
      flushOcrJsonFromEditor();
      applyOcrRunPatch({ editorDoc, ocrJson });
      return;
    }

    scheduleOcrJsonSync();
    applyOcrRunPatch({ editorDoc });
  }

  function getCurrentImageSize() {
    const width = Number(selectedPageData?.imageWidth ?? previewCanvas?.width ?? 1);
    const height = Number(selectedPageData?.imageHeight ?? previewCanvas?.height ?? 1);
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
    };
  }

  function getPreviewDisplaySize() {
    return {
      width: Math.max(1, previewDisplayWidth || previewCanvas?.clientWidth || 1),
      height: Math.max(1, previewDisplayHeight || previewCanvas?.clientHeight || 1),
    };
  }

  function getOverlayRect(line: any) {
    if (!line?.bbox || !previewCanvas) return null;
    const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
    const { width: displayWidth, height: displayHeight } = getPreviewDisplaySize();
    const [x1, y1, x2, y2] = line.bbox.map((value: unknown) => Number(value));

    return {
      left: (x1 / imageWidth) * displayWidth,
      top: (y1 / imageHeight) * displayHeight,
      width: ((x2 - x1) / imageWidth) * displayWidth,
      height: ((y2 - y1) / imageHeight) * displayHeight,
    };
  }

  function imageBBoxToOverlayRect(bbox: [number, number, number, number]) {
    if (!previewCanvas) return null;
    const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
    const { width: displayWidth, height: displayHeight } = getPreviewDisplaySize();
    const [x1, y1, x2, y2] = bbox;
    return {
      left: (x1 / imageWidth) * displayWidth,
      top: (y1 / imageHeight) * displayHeight,
      width: ((x2 - x1) / imageWidth) * displayWidth,
      height: ((y2 - y1) / imageHeight) * displayHeight,
    };
  }

  function getNewSelectionBBox(): [number, number, number, number] | null {
    if (!newSelectionState) return null;
    return normalizeEditorBBox([
      Math.min(newSelectionState.startX, newSelectionState.currentX),
      Math.min(newSelectionState.startY, newSelectionState.currentY),
      Math.max(newSelectionState.startX, newSelectionState.currentX),
      Math.max(newSelectionState.startY, newSelectionState.currentY),
    ]);
  }

  function pointerToImagePoint(event: PointerEvent) {
    if (!previewCanvas) return { x: 0, y: 0 };
    const canvasRect = previewCanvas.getBoundingClientRect();
    const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
    return {
      x: clamp(((event.clientX - canvasRect.left) / canvasRect.width) * imageWidth, 0, imageWidth),
      y: clamp(((event.clientY - canvasRect.top) / canvasRect.height) * imageHeight, 0, imageHeight),
    };
  }

  function normalizeEditorBBox(bbox: [number, number, number, number]): [number, number, number, number] {
    const { width, height } = getCurrentImageSize();
    const minSize = 2;
    let [x1, y1, x2, y2] = bbox;
    x1 = clamp(x1, 0, width);
    x2 = clamp(x2, 0, width);
    y1 = clamp(y1, 0, height);
    y2 = clamp(y2, 0, height);

    if (x2 - x1 < minSize) x2 = clamp(x1 + minSize, 0, width);
    if (y2 - y1 < minSize) y2 = clamp(y1 + minSize, 0, height);
    return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)];
  }

  function clonePlainValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function setOcrLineEditorId(line: any, lineId: string) {
    if (!line || typeof line !== 'object') return;
    Object.defineProperty(line, OCR_LINE_ID_KEY, {
      value: lineId,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  function getOcrLineEditorId(line: any) {
    if (!line || typeof line !== 'object') return '';
    const existingId = String(line[OCR_LINE_ID_KEY] ?? '');
    if (existingId) return existingId;

    const nextId = `line-${nextOcrLineEditorId++}`;
    setOcrLineEditorId(line, nextId);
    return nextId;
  }

  function cloneOcrHistoryLine(line: any, lineId = getOcrLineEditorId(line)) {
    const clone = clonePlainValue(line);
    setOcrLineEditorId(clone, lineId);
    return clone;
  }

  function getCurrentOcrSelectionState(): OcrSelectionState {
    return {
      pageNumber: Number(selectedPageNumber) || 1,
      lineIndex: Math.max(0, Number(selectedLineIndex) || 0),
    };
  }

  function getEditorPageByNumber(pageNumber: number) {
    const pages = Array.isArray(editorDoc?.pages) ? editorDoc.pages : editorPages;
    return pages.find((item: any) => Number(item?.page) === Number(pageNumber));
  }

  function getLineRawEditorId(line: any) {
    return line && typeof line === 'object' ? String(line[OCR_LINE_ID_KEY] ?? '') : '';
  }

  function findLineIndexByEditorId(page: any, lineId: string, fallbackIndex = -1, fallbackLine: any = null) {
    const lines = Array.isArray(page?.lines) ? page.lines : [];
    const exactIndex = lines.findIndex((line: any) => getLineRawEditorId(line) === lineId);
    if (exactIndex >= 0) return exactIndex;

    if (fallbackIndex >= 0 && fallbackIndex < lines.length) {
      return fallbackIndex;
    }

    const fallbackBox = getLineBBox(fallbackLine);
    if (!fallbackBox) return -1;
    return lines.findIndex((line: any) => {
      const lineBox = getLineBBox(line);
      return lineBox
        && String(line?.text ?? '') === String(fallbackLine?.text ?? '')
        && areOcrBBoxesEqual(lineBox, fallbackBox);
    });
  }

  function areOcrBBoxesEqual(a: OcrBBox | null, b: OcrBBox | null) {
    return Boolean(a && b && a.every((value, index) => Number(value) === Number(b[index])));
  }

  function setOcrSelectionState(selection: OcrSelectionState) {
    selectedPageNumber = selection.pageNumber;
    const page = getEditorPageByNumber(selection.pageNumber);
    const lines = Array.isArray(page?.lines) ? page.lines : [];
    selectedLineIndex = lines.length
      ? Math.max(0, Math.min(lines.length - 1, selection.lineIndex))
      : 0;
  }

  function syncSelectionMutation() {
    editorDoc = { ...editorDoc };
    syncJsonFromEditor();
  }

  function clearOcrSelectionHistory() {
    ocrUndoStack = [];
    ocrRedoStack = [];
  }

  function commitOcrSelectionHistory(entry: OcrSelectionHistoryEntry) {
    ocrUndoStack = [...ocrUndoStack, entry].slice(-OCR_SELECTION_HISTORY_LIMIT);
    ocrRedoStack = [];
  }

  function insertHistoryLine(pageNumber: number, line: any, lineIndex: number, lineId: string) {
    const page = ensureEditorPage(pageNumber);
    const existingIndex = findLineIndexByEditorId(page, lineId);
    if (existingIndex >= 0) return existingIndex;

    const nextLine = cloneOcrHistoryLine(line, lineId);
    const safeIndex = Math.max(0, Math.min(page.lines.length, lineIndex));
    page.lines.splice(safeIndex, 0, nextLine);
    return safeIndex;
  }

  function removeHistoryLine(pageNumber: number, lineId: string, fallbackIndex: number, fallbackLine: any = null) {
    const page = getEditorPageByNumber(pageNumber);
    if (!page || !Array.isArray(page.lines)) return -1;

    const lineIndex = findLineIndexByEditorId(page, lineId, fallbackIndex, fallbackLine);
    if (lineIndex < 0) return -1;
    page.lines.splice(lineIndex, 1);
    return lineIndex;
  }

  function applyOcrSelectionHistory(entry: OcrSelectionHistoryEntry, direction: 'undo' | 'redo') {
    cancelPreviewTextEdit();

    if (entry.type === 'bbox') {
      const page = getEditorPageByNumber(entry.pageNumber);
      const lineIndex = findLineIndexByEditorId(page, entry.lineId, entry.fallbackIndex);
      const line = Array.isArray(page?.lines) && lineIndex >= 0 ? page.lines[lineIndex] : null;
      if (line) {
        setOcrLineEditorId(line, entry.lineId);
        line.bbox = [...(direction === 'undo' ? entry.beforeBBox : entry.afterBBox)];
        markLineUserEdited(line);
        setOcrSelectionState({
          ...(direction === 'undo' ? entry.selectionBefore : entry.selectionAfter),
          lineIndex,
        });
      }
    } else if (entry.type === 'create') {
      if (direction === 'undo') {
        removeHistoryLine(entry.pageNumber, entry.lineId, entry.lineIndex, entry.line);
        setOcrSelectionState(entry.selectionBefore);
      } else {
        const lineIndex = insertHistoryLine(entry.pageNumber, entry.line, entry.lineIndex, entry.lineId);
        setOcrSelectionState({ pageNumber: entry.pageNumber, lineIndex });
      }
    } else if (entry.type === 'delete') {
      if (direction === 'undo') {
        const lineIndex = insertHistoryLine(entry.pageNumber, entry.line, entry.lineIndex, entry.lineId);
        setOcrSelectionState({ pageNumber: entry.pageNumber, lineIndex });
      } else {
        removeHistoryLine(entry.pageNumber, entry.lineId, entry.lineIndex, entry.line);
        setOcrSelectionState(entry.selectionAfter);
      }
    }

    syncSelectionMutation();
    schedulePreviewBoxLocate();
  }

  function undoOcrSelectionHistory() {
    const entry = ocrUndoStack[ocrUndoStack.length - 1];
    if (!entry || dragState || newSelectionState) return false;

    ocrUndoStack = ocrUndoStack.slice(0, -1);
    ocrRedoStack = [...ocrRedoStack, entry];
    applyOcrSelectionHistory(entry, 'undo');
    return true;
  }

  function redoOcrSelectionHistory() {
    const entry = ocrRedoStack[ocrRedoStack.length - 1];
    if (!entry || dragState || newSelectionState) return false;

    ocrRedoStack = ocrRedoStack.slice(0, -1);
    ocrUndoStack = [...ocrUndoStack, entry].slice(-OCR_SELECTION_HISTORY_LIMIT);
    applyOcrSelectionHistory(entry, 'redo');
    return true;
  }

  function isEditableKeyboardTarget(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(element?.closest('input, textarea, select, [contenteditable]'));
  }

  function deleteSelectedOcrLine() {
    if (dragState || newSelectionState || !selectedLine) return false;

    const pageNumber = Number(selectedPageNumber);
    const lineIndex = Number(selectedLineIndex);
    const page = getEditorPageByNumber(pageNumber);
    if (!Array.isArray(page?.lines) || !page.lines[lineIndex]) return false;

    deleteLine(pageNumber, lineIndex);
    return true;
  }

  function handleOcrKeyboardShortcut(event: KeyboardEvent) {
    if (event.isComposing || isEditableKeyboardTarget(event.target)) return;

    let handled = false;

    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handled = deleteSelectedOcrLine();
    } else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) {
      handled = event.shiftKey
        ? redoOcrSelectionHistory()
        : undoOcrSelectionHistory();
    }

    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
  }

  function updateLineBBox(line: any, bbox: [number, number, number, number]) {
    if (!line) return;
    line.bbox = normalizeEditorBBox(bbox);
    markLineUserEdited(line);
    syncSelectionMutation();
  }

  function selectLine(pageNumber: number, lineIndex: number, options: { locatePreview?: boolean } = {}) {
    const shouldLocatePreview = options.locatePreview ?? true;
    selectedPageNumber = pageNumber;
    selectedLineIndex = lineIndex;

    if (shouldLocatePreview) {
      schedulePreviewBoxLocate();
    }
  }

  function schedulePreviewBoxLocate() {
    previewLocateSequence += 1;
    void locateSelectedPreviewBox(previewLocateSequence);
  }

  async function waitForPreviewRender(sequence: number) {
    for (let frame = 0; frame < 90; frame += 1) {
      if (sequence !== previewLocateSequence) return false;
      await tick();
      if (previewRenderedKey === previewRenderKey && !isPreviewRendering) return true;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    return previewRenderedKey === previewRenderKey && !isPreviewRendering;
  }

  async function locateSelectedPreviewBox(sequence: number) {
    await tick();
    if (sequence !== previewLocateSequence) return;
    if (!previewCanvas || !previewScrollContainer || !selectedLine?.bbox) return;

    await waitForPreviewRender(sequence);
    if (sequence !== previewLocateSequence) return;

    let overlayRect = getOverlayRect(selectedLine);
    if (!overlayRect) return;

    if (overlayRect.height > 0 && overlayRect.height < PREVIEW_MIN_LOCATED_BOX_HEIGHT && previewScale < PREVIEW_MAX_SCALE) {
      const maxAutoScale = getMaxPreviewScaleForLocatedBox(overlayRect);
      const requiredScale = clamp(
        previewScale * (PREVIEW_MIN_LOCATED_BOX_HEIGHT / overlayRect.height),
        previewScale,
        maxAutoScale,
      );

      if (requiredScale > previewScale + 0.01) {
        previewScale = requiredScale;
        await waitForPreviewRender(sequence);
        if (sequence !== previewLocateSequence) return;
        overlayRect = getOverlayRect(selectedLine);
        if (!overlayRect) return;
      }
    }

    await tick();
    centerPreviewOnOverlayRect(overlayRect);
  }

  function getMaxPreviewScaleForLocatedBox(overlayRect: { width: number }) {
    if (!previewScrollContainer || overlayRect.width <= 0) return PREVIEW_MAX_SCALE;

    const availableWidth = Math.max(
      1,
      previewScrollContainer.clientWidth - PREVIEW_LOCATED_BOX_HORIZONTAL_PADDING,
    );
    const maxScaleByWidth = previewScale * (availableWidth / overlayRect.width);
    if (!Number.isFinite(maxScaleByWidth) || maxScaleByWidth <= 0) return PREVIEW_MAX_SCALE;

    return Math.max(previewScale, Math.min(PREVIEW_MAX_SCALE, maxScaleByWidth));
  }

  function centerPreviewOnOverlayRect(overlayRect: { left: number; top: number; width: number; height: number }) {
    if (!previewCanvas || !previewScrollContainer) return;

    const scrollerRect = previewScrollContainer.getBoundingClientRect();
    const canvasRect = previewCanvas.getBoundingClientRect();
    const targetCenterX = previewScrollContainer.scrollLeft + canvasRect.left - scrollerRect.left + overlayRect.left + overlayRect.width / 2;
    const targetCenterY = previewScrollContainer.scrollTop + canvasRect.top - scrollerRect.top + overlayRect.top + overlayRect.height / 2;

    previewScrollContainer.scrollTo({
      left: Math.max(0, targetCenterX - previewScrollContainer.clientWidth / 2),
      top: Math.max(0, targetCenterY - previewScrollContainer.clientHeight / 2),
      behavior: 'auto',
    });
  }

  async function scrollSelectedOcrTreeItem() {
    const container = ocrTreeScrollContainer;
    if (!container) return;

    const pageNumber = Number(selectedPageNumber);
    const lineIndex = Number(selectedLineIndex);
    await tick();

    const itemNode = container.querySelector<HTMLElement>(
      `[data-ocr-page="${pageNumber}"][data-ocr-line-index="${lineIndex}"]`,
    );
    if (!itemNode) return;

    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    const itemRect = itemNode.getBoundingClientRect();
    const isAbove = itemRect.top < OCR_TREE_STICKY_PAGE_TOP + OCR_TREE_STICKY_PAGE_HEIGHT + 8;
    const isBelow = viewportHeight > 0 && itemRect.bottom > viewportHeight - 24;

    if (!isAbove && !isBelow) return;

    window.scrollTo({
      top: Math.max(0, window.scrollY + itemRect.top - viewportHeight / 2 + itemRect.height / 2),
      behavior: 'auto',
    });
  }

  function ensureEditorPage(pageNumber: number) {
    if (!editorDoc) {
      editorDoc = { pages: [] };
    }
    if (!Array.isArray(editorDoc.pages)) {
      editorDoc.pages = [];
    }

    let page = editorDoc.pages.find((item: any) => Number(item?.page) === Number(pageNumber));
    const imageSize = getCurrentImageSize();
    if (!page) {
      page = {
        page: pageNumber,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        lines: [],
      };
      editorDoc.pages.push(page);
      editorDoc.pages.sort((a: any, b: any) => Number(a?.page) - Number(b?.page));
    }
    if (!Array.isArray(page.lines)) {
      page.lines = [];
    }
    page.imageWidth = Number(page.imageWidth || imageSize.width);
    page.imageHeight = Number(page.imageHeight || imageSize.height);
    return page;
  }

  function insertLineFromSelection(bbox: [number, number, number, number]) {
    const normalized = normalizeEditorBBox(bbox);
    const [x1, y1, x2, y2] = normalized;
    if (x2 - x1 < 8 || y2 - y1 < 8) return;

    const selectionBefore = getCurrentOcrSelectionState();
    const pageNumber = Number(selectedPageNumber);
    const page = ensureEditorPage(pageNumber);
    const nextLine = {
      text: '',
      bbox: normalized,
      score: 1,
      manual: true,
      userEdited: true,
    };
    const lineId = getOcrLineEditorId(nextLine);
    page.lines.push(nextLine);
    sortLinesForReadingOrder(page.lines);
    selectedLineIndex = page.lines.indexOf(nextLine);
    selectedPageNumber = pageNumber;
    editorDoc = { ...editorDoc };
    syncJsonFromEditor(true);
    commitOcrSelectionHistory({
      type: 'create',
      pageNumber,
      lineId,
      lineIndex: selectedLineIndex,
      line: cloneOcrHistoryLine(nextLine, lineId),
      selectionBefore,
      selectionAfter: getCurrentOcrSelectionState(),
    });
  }

  function updateLineText(
    pageNumber: number,
    lineIndex: number,
    text: string,
    options: { refreshList?: boolean } = {},
  ) {
    const page = editorPages.find((item: any) => Number(item?.page) === Number(pageNumber));
    const line = page?.lines?.[lineIndex];
    if (!line) return;
    line.text = text;
    markLineUserEdited(line);
    selectLine(pageNumber, lineIndex, { locatePreview: false });
    if (ocrTreeSearchTerm || options.refreshList) {
      editorDoc = { ...editorDoc };
    }
    syncJsonFromEditor();
  }

  async function startPreviewTextEdit(lineIndex: number) {
    const line = selectedLines[lineIndex];
    if (!line) return;

    selectLine(Number(selectedPageNumber), lineIndex);
    previewEditingLineIndex = lineIndex;
    previewEditingPageNumber = Number(selectedPageNumber);
    previewEditingLineKey = getLineMergeKey(line);
    previewEditingText = String(line.text ?? '');
    markLineUserEdited(line);
    editorDoc = { ...editorDoc };
    syncJsonFromEditor();

    await tick();
    previewEditingTextarea?.focus();
    previewEditingTextarea?.select();
  }

  function getPreviewEditingLineIndex() {
    const pageNumber = previewEditingPageNumber ?? Number(selectedPageNumber);
    const page = editorPages.find((item: any) => Number(item?.page) === Number(pageNumber));
    const lines = Array.isArray(page?.lines) ? page.lines : [];
    const keyedIndex = lines.findIndex((line: any) => getLineMergeKey(line) === previewEditingLineKey);
    if (keyedIndex >= 0) return { pageNumber, lineIndex: keyedIndex };

    const fallbackIndex = previewEditingLineIndex ?? -1;
    return fallbackIndex >= 0 && fallbackIndex < lines.length
      ? { pageNumber, lineIndex: fallbackIndex }
      : null;
  }

  function cancelPreviewTextEdit() {
    previewEditingLineIndex = null;
    previewEditingPageNumber = null;
    previewEditingLineKey = '';
    previewEditingText = '';
  }

  function commitPreviewTextEdit() {
    const target = getPreviewEditingLineIndex();
    const text = previewEditingText;
    cancelPreviewTextEdit();
    if (target) {
      updateLineText(target.pageNumber, target.lineIndex, text, { refreshList: true });
    }
  }

  function deleteLine(pageNumber: number, lineIndex: number) {
    const page = getEditorPageByNumber(pageNumber);
    if (!page || !Array.isArray(page.lines)) return;
    const line = page.lines[lineIndex];
    if (!line) return;
    const selectionBefore = getCurrentOcrSelectionState();
    const lineId = getOcrLineEditorId(line);
    const historyLine = cloneOcrHistoryLine(line, lineId);
    page.lines.splice(lineIndex, 1);
    if (Number(selectedPageNumber) === Number(pageNumber)) {
      selectedLineIndex = Math.max(0, Math.min(selectedLineIndex, page.lines.length - 1));
    }
    editorDoc = { ...editorDoc };
    syncJsonFromEditor(true);
    commitOcrSelectionHistory({
      type: 'delete',
      pageNumber,
      lineId,
      lineIndex,
      line: historyLine,
      selectionBefore,
      selectionAfter: getCurrentOcrSelectionState(),
    });
  }

  function startBBoxDrag(event: PointerEvent, mode: DragMode, line: any = selectedLine, lineIndex = selectedLineIndex) {
    if (!line?.bbox || !previewCanvas) return;
    event.preventDefault();
    newSelectionState = null;
    const start = pointerToImagePoint(event);
    const lineId = getOcrLineEditorId(line);
    dragState = {
      pointerId: event.pointerId,
      mode,
      startX: start.x,
      startY: start.y,
      original: [...line.bbox] as OcrBBox,
      targetLine: line,
      pageNumber: Number(selectedPageNumber),
      lineIndex,
      lineId,
      selectionBefore: getCurrentOcrSelectionState(),
    };
    try {
      previewCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Window-level pointer handlers continue the drag when capture is unavailable.
    }
  }

  function startNewSelection(event: PointerEvent) {
    if (!previewCanvas || previewRenderedKey !== previewRenderKey) return;
    event.preventDefault();
    dragState = null;
    const start = pointerToImagePoint(event);
    newSelectionState = {
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      currentX: start.x,
      currentY: start.y,
    };
    try {
      previewCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Window-level pointer handlers continue the drag when capture is unavailable.
    }
  }

  function handlePreviewPointerMove(event: PointerEvent) {
    if (newSelectionState) {
      const point = pointerToImagePoint(event);
      newSelectionState = {
        ...newSelectionState,
        currentX: point.x,
        currentY: point.y,
      };
      return;
    }

    if (!dragState || !dragState.targetLine) return;
    const point = pointerToImagePoint(event);
    const dx = point.x - dragState.startX;
    const dy = point.y - dragState.startY;
    const [x1, y1, x2, y2] = dragState.original;
    let next: [number, number, number, number] = [x1, y1, x2, y2];

    if (dragState.mode === 'move') next = [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
    if (dragState.mode.includes('left')) next[0] = x1 + dx;
    if (dragState.mode.includes('right')) next[2] = x2 + dx;
    if (dragState.mode.includes('top')) next[1] = y1 + dy;
    if (dragState.mode.includes('bottom')) next[3] = y2 + dy;

    updateLineBBox(dragState.targetLine, next);
  }

  function finishBBoxDrag(event: PointerEvent) {
    if (newSelectionState) {
      const bbox = getNewSelectionBBox();
      if (previewCanvas?.hasPointerCapture(event.pointerId)) {
        previewCanvas.releasePointerCapture(event.pointerId);
      }
      newSelectionState = null;
      if (bbox) {
        insertLineFromSelection(bbox);
      }
      return;
    }

    if (!dragState || !previewCanvas) return;
    if (previewCanvas.hasPointerCapture(event.pointerId)) {
      previewCanvas.releasePointerCapture(event.pointerId);
    }
    const completedDrag = dragState;
    const afterBBox = getLineBBox(completedDrag.targetLine);
    if (afterBBox && !areOcrBBoxesEqual(completedDrag.original, afterBBox)) {
      commitOcrSelectionHistory({
        type: 'bbox',
        pageNumber: completedDrag.pageNumber,
        lineId: completedDrag.lineId,
        fallbackIndex: completedDrag.lineIndex,
        beforeBBox: [...completedDrag.original],
        afterBBox: [...(afterBBox as OcrBBox)],
        selectionBefore: completedDrag.selectionBefore,
        selectionAfter: getCurrentOcrSelectionState(),
      });
    }
    dragState = null;
  }

  function goToPreviousPreviewPage() {
    selectedPageNumber = Math.max(1, Number(selectedPageNumber) - 1);
    selectedLineIndex = 0;
  }

  function goToNextPreviewPage() {
    selectedPageNumber = Math.min(pdfInstance?.numPages || Number(selectedPageNumber), Number(selectedPageNumber) + 1);
    selectedLineIndex = 0;
  }

  function zoomPreviewIn() {
    previewScale = Math.min(PREVIEW_MAX_SCALE, previewScale + 0.15);
  }

  function zoomPreviewOut() {
    previewScale = Math.max(PREVIEW_MIN_SCALE, previewScale - 0.15);
  }

  function resetPreviewZoom() {
    previewScale = PREVIEW_DEFAULT_SCALE;
  }

  function resetPreviewViewForDocument() {
    resetPreviewZoom();
    previewLocateSequence += 1;
    previewEditingLineIndex = null;
    previewEditingPageNumber = null;
    previewEditingLineKey = '';
    previewEditingText = '';
    dragState = null;
    newSelectionState = null;

    if (previewScrollContainer) {
      previewScrollContainer.scrollLeft = 0;
      previewScrollContainer.scrollTop = 0;
    }
  }

  async function renderPreviewPage() {
    if (!pdfInstance || !previewCanvas) return;
    const requestedPage = selectedPageNumber;
    const requestedRenderKey = previewRenderKey;
    isPreviewRendering = true;

    try {
      await tick();
      const page = await pdfInstance.getPage(requestedPage);
      const baseViewport = page.getViewport({ scale: 1 });
      const baseFitScale = Math.min(
        Math.max(0.1, (previewWrapWidth - 40) / baseViewport.width),
        Math.max(0.1, (previewWrapHeight - 40) / baseViewport.height),
      );
      const viewport = page.getViewport({ scale: previewScale * baseFitScale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = Math.floor(viewport.width * dpr);
      offscreenCanvas.height = Math.floor(viewport.height * dpr);

      const context = offscreenCanvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Could not create canvas context for OCR preview.');

      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await renderTask.promise.then(() => page.cleanup()).catch(() => page.cleanup());

      if (requestedRenderKey !== previewRenderKey || requestedPage !== selectedPageNumber || !previewCanvas) return;

      const visibleContext = previewCanvas.getContext('2d', { alpha: false });
      if (!visibleContext) throw new Error('Could not create canvas context for OCR preview.');

      previewCanvas.width = offscreenCanvas.width;
      previewCanvas.height = offscreenCanvas.height;
      previewDisplayWidth = Math.floor(viewport.width);
      previewDisplayHeight = Math.floor(viewport.height);
      previewCanvas.style.width = `${previewDisplayWidth}px`;
      previewCanvas.style.height = `${previewDisplayHeight}px`;
      visibleContext.drawImage(offscreenCanvas, 0, 0);
      previewRenderedKey = requestedRenderKey;
    } finally {
      if (requestedRenderKey === previewRenderKey) {
        isPreviewRendering = false;
      }
    }
  }

  async function disposeLocalOcrPool() {
    const pool = localOcrPool;
    localOcrPool = [];
    localOcrRuntimeKey = '';
    await Promise.all(pool.map((ocr) => ocr.dispose().catch(() => undefined)));
  }

  async function ensureLocalOcrPool(control: { runId: number; cancelled: boolean } | null = null) {
    assertOcrRunActive(control);
    const runtimeKey = getLocalOcrRuntimeKey();
    if (localOcrPool.length && localOcrRuntimeKey === runtimeKey) return localOcrPool;
    if (localOcrPool.length) {
      await disposeLocalOcrPool();
    }

    const loadingProgress = {
      phase: 'initializing',
      current: 0,
      total: getEffectiveOcrWorkerPoolSize(),
    };
    applyOcrRunPatch({
      isInitializingOcr: true,
      ocrProgress: loadingProgress,
    });

    try {
      const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
      assertOcrRunActive(control);
      const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
      const workerPoolSize = getEffectiveOcrWorkerPoolSize();
      const ortRuntime = getOcrOrtRuntimeConfig();
      const canUseWorkerOcr = shouldUseOcrWorker() && await supportsWorkerFetch();
      assertOcrRunActive(control);
      const modelConfig = OCR_MODEL_CONFIGS[ocrModelSize];

      const wasmThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.max(1, Math.min(2, Math.floor((hardwareConcurrency - 1) / workerPoolSize) || 1))
        : 1;

      const baseOptions = {
        ...modelConfig,
        pipelineBatchSize: INTERNAL_PAGE_BATCH_SIZE,
        textDetectionBatchSize: INTERNAL_TEXT_DETECTION_BATCH_SIZE,
        textRecognitionBatchSize: INTERNAL_TEXT_RECOGNITION_BATCH_SIZE,
        ortOptions: {
          backend: ortRuntime.backend,
          wasmPaths: ortRuntime.wasmPaths,
          numThreads: wasmThreads,
          simd: true,
        } as any,
      };

      const createOcr = async (worker: boolean, backend: OcrBackend) => withTimeout(
        PaddleOCR.create({
          ...baseOptions,
          worker,
          ortOptions: {
            ...baseOptions.ortOptions,
            backend,
          },
        }) as Promise<LocalOcrEngine>,
        OCR_ENGINE_CREATE_TIMEOUT_MS,
        $t('ocr_lab.errors.engine_timeout'),
        disposeLateOcrEngine,
      );

      const createMainThreadOcr = async (prefixError = '') => {
        try {
          assertOcrRunActive(control);
          localOcrPool = [await createOcr(false, ortRuntime.backend)];
          assertOcrRunActive(control);
        } catch (primaryError: any) {
          if (isOcrRunCancelledError(primaryError)) throw primaryError;
          const primaryLabel = ortRuntime.backend === 'wasm' ? 'WASM backend error' : 'Auto backend error';
          lastLocalOcrError = `${prefixError}${prefixError ? '\n\n' : ''}${primaryLabel}:\n${formatError(primaryError)}`;
          applyOcrRunPatch({ lastLocalOcrError });
          if (ortRuntime.backend === 'wasm') {
            throw primaryError;
          }
          assertOcrRunActive(control);
          localOcrPool = [await createOcr(false, 'wasm')];
          assertOcrRunActive(control);
        }
      };

      if (!canUseWorkerOcr) {
        applyOcrRunPatch({
          ocrProgress: {
            phase: 'initializing',
            current: 0,
            total: 1,
          },
        });
        await createMainThreadOcr($t('ocr_lab.errors.worker_fetch_unsupported'));
      } else {
        const pool: LocalOcrEngine[] = [];
        try {
          for (let i = 0; i < workerPoolSize; i += 1) {
            assertOcrRunActive(control);
            pool.push(await createOcr(true, ortRuntime.backend));
            assertOcrRunActive(control);
            applyOcrRunPatch({
              ocrProgress: {
                phase: 'initializing',
                current: pool.length,
                total: workerPoolSize,
              },
            });
          }
          localOcrPool = pool;
        } catch (workerError: any) {
          await Promise.all(pool.map((ocr) => ocr.dispose().catch(() => undefined)));
          if (isOcrRunCancelledError(workerError)) throw workerError;
          lastLocalOcrError = formatError(workerError);
          applyOcrRunPatch({ lastLocalOcrError });
          await createMainThreadOcr(lastLocalOcrError);
        }
      }

      const initializedProgress = {
        phase: 'initializing',
        current: localOcrPool.length,
        total: localOcrPool.length,
      };
      applyOcrRunPatch({
        ocrProgress: initializedProgress,
      });
      localOcrRuntimeKey = runtimeKey;
      return localOcrPool;
    } finally {
      applyOcrRunPatch({ isInitializingOcr: false });
    }
  }

  function formatError(error: unknown): string {
    if (error instanceof Error) {
      return [error.message, error.stack].filter(Boolean).join('\n');
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  function isOrtWasmInitError(detail: string) {
    return /initWasm|no available backend found|wasm/i.test(detail);
  }

  function formatLocalOcrError(error: unknown) {
    const detail = formatError(error);
    const fallbackDetail = lastLocalOcrError
      ? `\n\nWorker error:\n${lastLocalOcrError}`
      : '';
    const fullDetail = `${detail}${fallbackDetail}`;

    if (isOrtWasmInitError(fullDetail)) {
      return `${$t('ocr_lab.errors.local_wasm_failed')}\n\n${fullDetail}`;
    }

    return `${$t('ocr_lab.errors.local_failed')}\n\n${fullDetail}`;
  }

  function buildPageNumbers(start: number, end: number) {
    const pages: number[] = [];
    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  }

  async function runLocalOcr() {
    if (activeOcrRunPromise) {
      syncOcrRunStateFromModule();
      return;
    }

    if (!pdfFile || !pdfInstance) {
      errorMessage = $t('ocr_lab.errors.no_pdf');
      return;
    }

    const runId = nextOcrRunId++;
    const currentPdfInstance = pdfInstance;
    const currentPdfBytes = pdfBytes;
    const requestedPageRange = normalizeOcrPageRange(pageStart, pageEnd, currentPdfInstance.numPages);
    const requestedBoxExtension = clampOcrBoxExtension(ocrBoxExtension);
    const requestedWatermarkCleanup = Boolean(ocrWatermarkCleanup);
    const runControl = { runId, cancelled: false };
    clearOcrSelectionHistory();
    ocrTreeSortMode = 'reading';
    activeOcrRunControl = runControl;
    lastLocalOcrError = '';

    activeOcrRunState = {
      runId,
      pdfFile,
      pdfBytes: currentPdfBytes,
      isInitializingOcr: false,
      isRunningOcr: true,
      isCancellingOcr: false,
      ocrProgress: null,
      errorMessage: '',
      timingSummary: '',
      ocrJson: '',
      editorDoc: null,
      pageStart: requestedPageRange.start,
      pageEnd: requestedPageRange.end,
      ocrModelSize,
      ocrWatermarkCleanup: requestedWatermarkCleanup,
      ocrBoxExtension: requestedBoxExtension,
      selectedPageNumber,
      selectedLineIndex,
      lastLocalOcrError: '',
    };
    lastOcrRunSnapshot = { ...activeOcrRunState };

    applyOcrRunPatch({
      isRunningOcr: true,
      isCancellingOcr: false,
      errorMessage: '',
      timingSummary: '',
      ocrJson: '',
      editorDoc: null,
      ocrProgress: null,
      pageStart: requestedPageRange.start,
      pageEnd: requestedPageRange.end,
      ocrModelSize,
      ocrWatermarkCleanup: requestedWatermarkCleanup,
      ocrBoxExtension: requestedBoxExtension,
      lastLocalOcrError: '',
    });

    const runPromise = (async () => {
      try {
      const pageNumbers = buildPageNumbers(requestedPageRange.start, requestedPageRange.end);
      const pages: any[] = [];
      const startedAt = performance.now();
      const ocrPool = await ensureLocalOcrPool(runControl);
      const pagesByNumber = new Map<number, any>();
      const workerTimings: {
        worker: number;
        page: number;
        startMs: number;
        endMs: number;
        durationMs: number;
      }[] = [];
      let nextPageIndex = 0;
      let renderedCount = 0;
      let recognizedCount = 0;

      const claimNextPage = () => {
        if (isOcrRunCancelled(runControl)) return undefined;
        const pageNumber = pageNumbers[nextPageIndex];
        nextPageIndex += 1;
        return pageNumber;
      };

      const runOcrWorker = async (ocr: LocalOcrEngine, workerIndex: number) => {
        while (true) {
          if (isOcrRunCancelled(runControl)) return;
          const pageNumber = claimNextPage();
          if (pageNumber === undefined) return;
          const taskStartedAt = performance.now();

          applyOcrRunPatch({
            ocrProgress: {
              phase: 'rendering',
              current: recognizedCount,
              total: pageNumbers.length,
            },
          });

          const canvas = await renderPdfPageAsCanvas(
            currentPdfInstance,
            pageNumber,
            getOcrQualitySize(),
            { watermarkCleanup: requestedWatermarkCleanup },
          );
          if (isOcrRunCancelled(runControl)) return;
          renderedCount += 1;
          applyOcrRunPatch({
            ocrProgress: {
              phase: 'rendering',
              current: recognizedCount,
              total: pageNumbers.length,
            },
          });

          applyOcrRunPatch({
            ocrProgress: {
              phase: 'recognizing',
              current: recognizedCount,
              total: pageNumbers.length,
            },
          });

          const [result] = await withTimeout(
            ocr.predict(canvas, {
              textDetLimitSideLen: getOcrQualitySize(),
              textDetUnclipRatio: requestedBoxExtension,
              textRecScoreThresh: 0.35,
            }),
            OCR_PAGE_PREDICT_TIMEOUT_MS,
            $t('ocr_lab.errors.page_timeout', { values: { page: pageNumber } }),
          );
          if (isOcrRunCancelled(runControl)) return;

          if (result) {
	            const pageResult = convertLocalResult(pageNumber, result, canvas);
	            pagesByNumber.set(pageNumber, pageResult);
	            recognizedCount += 1;
	            upsertIncrementalOcrPage(pageResult);
	            applyOcrRunPatch({
	              ocrProgress: {
                phase: 'postprocessing',
                current: recognizedCount,
                total: pageNumbers.length,
              },
            });
          }

          applyOcrRunPatch({
            ocrProgress: {
              phase: 'recognizing',
              current: recognizedCount,
              total: pageNumbers.length,
            },
          });

          const taskEndedAt = performance.now();
          workerTimings.push({
            worker: workerIndex + 1,
            page: pageNumber,
            startMs: Math.round(taskStartedAt - startedAt),
            endMs: Math.round(taskEndedAt - startedAt),
            durationMs: Math.round(taskEndedAt - taskStartedAt),
          });
        }
      };

      await Promise.all(ocrPool.map((ocr, workerIndex) => runOcrWorker(ocr, workerIndex)));
      if (isOcrRunCancelled(runControl)) {
        applyOcrRunPatch({
          ocrProgress: null,
          timingSummary: '',
        });
        return;
      }

      if (import.meta.env.DEV && workerTimings.length) {
        console.info(`[Tocify OCR] ${ocrPool.length} worker(s), Rec Batch ${INTERNAL_TEXT_RECOGNITION_BATCH_SIZE}`);
        console.table(workerTimings.sort((a, b) => a.startMs - b.startMs));
      }

	      pages.push(...(Array.isArray(editorDoc?.pages)
	        ? [...editorDoc.pages].sort((a: any, b: any) => Number(a?.page) - Number(b?.page))
	        : pageNumbers
	          .map((pageNumber) => pagesByNumber.get(pageNumber))
	          .filter(Boolean)));

	      const elapsedMs = Math.round(performance.now() - startedAt);
	      editorDoc = { pages };
	      flushOcrJsonFromEditor();
      parseJson({ syncSelection: false });
      timingSummary = $t('ocr_lab.local_timing', {
        values: {
          seconds: (elapsedMs / 1000).toFixed(1),
          pages: pages.length,
        },
      });
      applyOcrRunPatch({
        ocrJson,
        editorDoc,
        timingSummary,
        ocrProgress: null,
      });
      window.setTimeout(() => {
        const snapshot = activeOcrRunState || lastOcrRunSnapshot;
        if (snapshot?.runId !== runId) return;
        applyOcrRunPatch({
          timingSummary: '',
        });
      }, 4000);
    } catch (error: any) {
      if (isOcrRunCancelledError(error)) {
        applyOcrRunPatch({
          ocrProgress: null,
          timingSummary: '',
        });
        return;
      }

      await disposeLocalOcrPool();
      applyOcrRunPatch({
        errorMessage: formatLocalOcrError(error),
      });
    } finally {
      applyOcrRunPatch({
        isRunningOcr: false,
        isInitializingOcr: false,
        isCancellingOcr: false,
      });
    }
    })();

    activeOcrRunPromise = runPromise;

    try {
      await runPromise;
    } finally {
      if (activeOcrRunPromise === runPromise) {
        activeOcrRunPromise = null;
      }
      if (activeOcrRunControl === runControl) {
        activeOcrRunControl = null;
      }
    }
  }

  async function savePdfBytes(bytes: Uint8Array, suggestedName: string) {
    const supportsPicker = 'showSaveFilePicker' in window;

    if (supportsPicker) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }

    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function generateSearchablePdf() {
    if (!pdfBytes || !pdfFile || !pdfInstance) {
      errorMessage = $t('ocr_lab.errors.no_pdf');
      return;
    }

    isBuilding = true;
    errorMessage = '';

    try {
	      flushOcrJsonFromEditor();
	      const parsed = parseJson();
	      const result = await buildSearchablePdf({
	        pdfBytes,
	        ocr: parsed,
	        pageStart: 1,
	        pageEnd: pdfInstance.numPages,
	      });

      const nextName = pdfFile.name.toLowerCase().endsWith('.pdf')
        ? `${pdfFile.name.slice(0, -4)}_searchable.pdf`
        : `${pdfFile.name}_searchable.pdf`;

      await savePdfBytes(result, nextName);
    } catch (error: any) {
      errorMessage = error?.message || $t('ocr_lab.errors.build_failed');
    } finally {
      isBuilding = false;
    }
  }
</script>

<svelte:window
  on:keydown={handleOcrKeyboardShortcut}
  on:pointermove={handlePreviewPointerMove}
  on:pointerup={finishBBoxDrag}
  on:pointercancel={finishBBoxDrag}
/>

<SeoJsonLd
  title={$t('ocr_lab.meta_title')}
  description={$t('ocr_lab.meta_description')}
  url="https://tocify.aeriszhu.com/ocr"
/>

<div class="min-h-screen flex text-neutral-800 flex-col">
  <h1 class="sr-only">{$t('ocr_lab.title')}</h1>

  <div
    class="flex flex-col mt-5 lg:flex-row lg:items-start lg:mt-8 p-2 md:p-4 md:pr-3 gap-4 lg:gap-8 mx-auto w-[95%] md:w-[90%] xl:w-[80%] 3xl:w-[75%] max-w-6xl justify-between"
  >
    <aside class="w-full lg:w-[35%] lg:min-h-[85vh] flex-shrink-0 flex flex-col gap-4">
      <Header activePage="ocr" on:openhelp={() => (showHelpModal = true)} />

      <OcrControls
        pdfPageCount={pdfInstance?.numPages || 1}
        hasPdf={Boolean(pdfFile)}
        {pageStart}
        {pageEnd}
        modelSize={ocrModelSize}
        watermarkCleanup={ocrWatermarkCleanup}
        workerPoolSize={ocrWorkerPoolSize}
        resolutionQuality={ocrResolutionQuality}
        boxExtension={ocrBoxExtension}
        minWorkerPoolSize={OCR_MIN_WORKER_POOL_SIZE}
        maxWorkerPoolSize={OCR_MAX_WORKER_POOL_SIZE}
        minBoxExtension={OCR_BOX_EXTENSION_MIN}
        maxBoxExtension={OCR_BOX_EXTENSION_MAX}
        boxExtensionStep={OCR_BOX_EXTENSION_STEP}
        {isFileLoading}
        {isBuilding}
        isInitializing={isInitializingOcr}
        isRunning={isRunningOcr}
        isCancelling={isCancellingOcr}
        {ocrProgress}
        {ocrProgressPercent}
        onPageRangeChange={handleOcrPageRangeChange}
        onRuntimeSettingChange={handleOcrRuntimeSettingChange}
        onRun={runLocalOcr}
        onCancel={cancelLocalOcr}
      />

      <OcrResultTree
        {flatOcrLines}
        {filteredOcrLines}
        bind:ocrTreeSearch
        {ocrTreeSearchTerm}
        {ocrTreeSortMode}
        bind:ocrTreeScrollContainer
        isOcrBusy={isInitializingOcr || isRunningOcr || isCancellingOcr}
        stickySearchTop={OCR_TREE_STICKY_SEARCH_TOP}
        stickyPageTop={OCR_TREE_STICKY_PAGE_TOP}
        {selectedPageNumber}
        {selectedLineIndex}
        {autosizeTextarea}
        {getHighlightedTextSegments}
        {doesOcrPageMatchSearch}
        {selectLine}
        {deleteLine}
        {updateLineText}
        {setOcrTreeSortMode}
      />

      {#if timingSummary}
        <p class="text-sm text-sky-700 bg-sky-50 border border-sky-300 rounded-lg px-4 py-3">{timingSummary}</p>
      {/if}

      {#if errorMessage}
        <p class="text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-4 py-3 whitespace-pre-line">{errorMessage}</p>
      {/if}
    </aside>

    <OcrPdfPreview
      {pdfFile}
      pdfPageCount={pdfInstance?.numPages || 0}
      bind:selectedPageNumber
      bind:selectedLineIndex
      {selectedLines}
      {previewScale}
      {previewRenderKey}
      {previewRenderedKey}
      bind:previewCanvas
      bind:previewWrapWidth
      bind:previewWrapHeight
      bind:previewScrollContainer
      {previewEditingLineIndex}
      {previewEditingPageNumber}
      bind:previewEditingText
      bind:previewEditingTextarea
      {newSelectionState}
      {resizeHandles}
      {isPreviewDragging}
      {isFileLoading}
      {isBuilding}
      {handleFileChange}
      {handlePreviewDragEnter}
      {handlePreviewDragOver}
      {handlePreviewDragLeave}
      {handleDrop}
      {goToPreviousPreviewPage}
      {goToNextPreviewPage}
      {zoomPreviewOut}
      {zoomPreviewIn}
      {resetPreviewZoom}
      {startNewSelection}
      {handlePreviewPointerMove}
      {finishBBoxDrag}
      {selectLine}
      {startBBoxDrag}
      {startPreviewTextEdit}
      {commitPreviewTextEdit}
      {cancelPreviewTextEdit}
      {getOverlayRect}
      {getNewSelectionBBox}
      {imageBBoxToOverlayRect}
      {generateSearchablePdf}
    />
  </div>

  <HelpModal bind:showHelpModal />
  <Footer />
</div>
