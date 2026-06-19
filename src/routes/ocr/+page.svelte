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
  import { ChevronLeft, ChevronRight, Download, RotateCw, Upload, ZoomIn, ZoomOut } from 'lucide-svelte';
  import * as pdfjsLib from 'pdfjs-dist';
  import type { OcrResult } from '@paddleocr/paddleocr-js';

  import '../../lib/i18n';
  import DropzoneView from '../../components/DropzoneView.svelte';
  import Footer from '../../components/Footer.svelte';
  import Header from '../../components/Header.svelte';
  import SeoJsonLd from '../../components/SeoJsonLd.svelte';
  import HelpModal from '../../components/modals/HelpModal.svelte';
  import { buildSearchablePdf, normalizeSearchableOcr } from '$lib/pdf/searchable';
  import { isLegacyBrowser } from '$lib/utils';
  import OcrControls from './OcrControls.svelte';
  import OcrResultTree from './OcrResultTree.svelte';
  import {
    clamp,
    getLineMergeKey,
    markLineUserEdited,
    mergeIncomingOcrPage,
    resolveSmallHorizontalOverlaps,
    sortLinesForReadingOrder,
  } from './ocrGeometry';

  type LocalOcrEngine = {
    predict(input: unknown, params?: Record<string, unknown>): Promise<OcrResult[]>;
    dispose(): Promise<void>;
  };

  type OcrResolutionQuality = 'low' | 'standard' | 'high' | 'ultra';
  type OcrTreeSortMode = 'reading' | 'confidence';
  type DragMode = 'move' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  type OcrProgressPhase = 'initializing' | 'rendering' | 'recognizing' | 'postprocessing';
  type OcrProgress = {
    phase: OcrProgressPhase;
    current: number;
    total: number;
  };

  class OcrRunCancelledError extends Error {
    constructor() {
      super('OCR run cancelled');
      this.name = 'OcrRunCancelledError';
    }
  }

  let fileInput: HTMLInputElement | null = null;
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
  let buildProgress: { current: number; total: number } | null = null;
  let ocrProgress: OcrProgress | null = null;
  let errorMessage = '';
  let lastLocalOcrError = '';

  let pageStart = 1;
  let pageEnd = 1;
  let ocrWorkerPoolSize = 4;
  let ocrResolutionQuality: OcrResolutionQuality = 'standard';
  const OCR_MIN_WORKER_POOL_SIZE = 1;
  const OCR_MAX_WORKER_POOL_SIZE = 4;
  const OCR_RUNTIME_SETTINGS_STORAGE_KEY = 'tocify.ocr.runtimeSettings';
  const INTERNAL_PAGE_BATCH_SIZE = 1;
  const INTERNAL_TEXT_DETECTION_BATCH_SIZE = 1;
  const INTERNAL_TEXT_RECOGNITION_BATCH_SIZE = 2;
  const OCR_RESOLUTION_QUALITY_SIZES: Record<OcrResolutionQuality, number> = {
    low: 1200,
    standard: 1600,
    high: 2000,
    ultra: 2400,
  };
  const OCR_TEXT_DET_UNCLIP_RATIO = 2.0;
  const OCR_TREE_STICKY_SEARCH_TOP = 48;
  const OCR_TREE_STICKY_SEARCH_HEIGHT = 36;
  const OCR_TREE_STICKY_GAP = 14;
  const OCR_TREE_STICKY_PAGE_TOP = OCR_TREE_STICKY_SEARCH_TOP + OCR_TREE_STICKY_SEARCH_HEIGHT + OCR_TREE_STICKY_GAP;
  const OCR_TREE_STICKY_PAGE_HEIGHT = 20;
  const PREVIEW_MIN_LOCATED_BOX_HEIGHT = 17;
  const PREVIEW_MIN_SCALE = 0.5;
  const PREVIEW_MAX_SCALE = 8;
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
  let previewScale = 1.0;
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
  let dragState: {
    pointerId: number;
    mode: DragMode;
    startX: number;
    startY: number;
    original: [number, number, number, number];
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
      ocrWorkerPoolSize,
      ocrResolutionQuality,
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
    ocrResolutionQuality = normalizeOcrResolutionQuality(ocrResolutionQuality);

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
    buildProgress = null;
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
      ocrWorkerPoolSize,
      ocrResolutionQuality,
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
    errorMessage = '';
    buildProgress = null;
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

  function clampOcrWorkerPoolSize(value: unknown) {
    return Math.max(
      OCR_MIN_WORKER_POOL_SIZE,
      Math.min(OCR_MAX_WORKER_POOL_SIZE, Math.floor(Number(value)) || 4),
    );
  }

  function normalizeOcrResolutionQuality(value: unknown): OcrResolutionQuality {
    return value === 'low' || value === 'high' || value === 'ultra' ? value : 'standard';
  }

  function restoreOcrRuntimeSettings() {
    if (typeof window === 'undefined') return;

    try {
      const rawSettings = window.localStorage.getItem(OCR_RUNTIME_SETTINGS_STORAGE_KEY);
      if (!rawSettings) return;

      const settings = JSON.parse(rawSettings);
      ocrWorkerPoolSize = clampOcrWorkerPoolSize(settings?.workerPoolSize);
      ocrResolutionQuality = normalizeOcrResolutionQuality(settings?.resolutionQuality);
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
          workerPoolSize: clampOcrWorkerPoolSize(ocrWorkerPoolSize),
          resolutionQuality: normalizeOcrResolutionQuality(ocrResolutionQuality),
        }),
      );
    } catch {
      // Storage may be unavailable in private browsing or restricted contexts.
    }
  }

  function getOcrQualitySize() {
    return OCR_RESOLUTION_QUALITY_SIZES[ocrResolutionQuality];
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
    return [
      `quality:${ocrResolutionQuality}`,
      `workers:${clampOcrWorkerPoolSize(ocrWorkerPoolSize)}`,
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
    options: { workerPoolSize?: unknown; resolutionQuality?: unknown } = {},
  ) {
    ocrWorkerPoolSize = clampOcrWorkerPoolSize(
      'workerPoolSize' in options ? options.workerPoolSize : ocrWorkerPoolSize,
    );
    ocrResolutionQuality = normalizeOcrResolutionQuality(
      'resolutionQuality' in options ? options.resolutionQuality : ocrResolutionQuality,
    );
    persistOcrRuntimeSettings();

    if (localOcrPool.length) {
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

  function updateSelectedLineBBox(bbox: [number, number, number, number]) {
    if (!selectedPageData || !selectedLine) return;
    selectedLine.bbox = normalizeEditorBBox(bbox);
    markLineUserEdited(selectedLine);
    editorDoc = { ...editorDoc };
    syncJsonFromEditor();
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
      const requiredScale = clamp(
        previewScale * (PREVIEW_MIN_LOCATED_BOX_HEIGHT / overlayRect.height),
        previewScale,
        PREVIEW_MAX_SCALE,
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

    const pageNumber = Number(selectedPageNumber);
    const page = ensureEditorPage(pageNumber);
    const nextLine = {
      text: '',
      bbox: normalized,
      score: 1,
      manual: true,
      userEdited: true,
    };
    page.lines.push(nextLine);
    sortLinesForReadingOrder(page.lines);
    selectedLineIndex = page.lines.indexOf(nextLine);
    selectedPageNumber = pageNumber;
    editorDoc = { ...editorDoc };
    syncJsonFromEditor(true);
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
    const page = editorPages.find((item: any) => Number(item?.page) === Number(pageNumber));
    if (!page || !Array.isArray(page.lines)) return;
    page.lines.splice(lineIndex, 1);
    if (Number(selectedPageNumber) === Number(pageNumber)) {
      selectedLineIndex = Math.max(0, Math.min(selectedLineIndex, page.lines.length - 1));
    }
    editorDoc = { ...editorDoc };
    syncJsonFromEditor(true);
  }

  function startBBoxDrag(event: PointerEvent, mode: DragMode) {
    if (!selectedLine?.bbox || !previewCanvas) return;
    event.preventDefault();
    const start = pointerToImagePoint(event);
    dragState = {
      pointerId: event.pointerId,
      mode,
      startX: start.x,
      startY: start.y,
      original: [...selectedLine.bbox] as [number, number, number, number],
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

    if (!dragState || !selectedLine) return;
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

    updateSelectedLineBBox(next);
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
    previewScale = 1.0;
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
      total: clampOcrWorkerPoolSize(ocrWorkerPoolSize),
    };
    applyOcrRunPatch({
      isInitializingOcr: true,
      ocrProgress: loadingProgress,
    });

    try {
      const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
      assertOcrRunActive(control);
      const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
      const workerPoolSize = clampOcrWorkerPoolSize(ocrWorkerPoolSize);
      const wasmThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.max(1, Math.min(2, Math.floor((hardwareConcurrency - 1) / workerPoolSize) || 1))
        : 1;

      const baseOptions = {
        textDetectionModelName: 'PP-OCRv6_tiny_det',
        textDetectionModelAsset: {
          url: '/models/paddleocr/PP-OCRv6_tiny_det_onnx_infer.tar',
        },
        textRecognitionModelName: 'PP-OCRv6_tiny_rec',
        textRecognitionModelAsset: {
          url: '/models/paddleocr/PP-OCRv6_tiny_rec_onnx_infer.tar',
        },
        pipelineBatchSize: INTERNAL_PAGE_BATCH_SIZE,
        textDetectionBatchSize: INTERNAL_TEXT_DETECTION_BATCH_SIZE,
        textRecognitionBatchSize: INTERNAL_TEXT_RECOGNITION_BATCH_SIZE,
        ortOptions: {
          backend: 'auto',
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/',
          numThreads: wasmThreads,
          simd: true,
        },
      };

      const createOcr = async (worker: boolean, backend: 'auto' | 'wasm') => PaddleOCR.create({
        ...baseOptions,
        worker,
        ortOptions: {
          ...baseOptions.ortOptions,
          backend,
        },
      });

      try {
        const pool: LocalOcrEngine[] = [];
        try {
          for (let i = 0; i < workerPoolSize; i += 1) {
            assertOcrRunActive(control);
            pool.push(await PaddleOCR.create({
              ...baseOptions,
              worker: true,
            }));
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
        } catch (workerError) {
          await Promise.all(pool.map((ocr) => ocr.dispose().catch(() => undefined)));
          throw workerError;
        }
      } catch (workerError: any) {
        if (isOcrRunCancelledError(workerError)) throw workerError;
        lastLocalOcrError = formatError(workerError);
        applyOcrRunPatch({
          lastLocalOcrError,
        });

        try {
          assertOcrRunActive(control);
          localOcrPool = [await createOcr(false, 'auto')];
          assertOcrRunActive(control);
        } catch (autoError: any) {
          if (isOcrRunCancelledError(autoError)) throw autoError;
          lastLocalOcrError = `${lastLocalOcrError}\n\nAuto backend error:\n${formatError(autoError)}`;
          applyOcrRunPatch({ lastLocalOcrError });
          assertOcrRunActive(control);
          localOcrPool = [await createOcr(false, 'wasm')];
          assertOcrRunActive(control);
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

  async function renderPdfPageAsCanvas(
    instance: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
  ) {
    const page = await instance.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const baseMaxSide = Math.max(baseViewport.width, baseViewport.height);
      const qualitySize = getOcrQualitySize();
      const scale = qualitySize / Math.max(1, baseMaxSide);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Could not create canvas context for OCR image rendering.');
    }

    const renderTask = page.render({
      canvasContext: context,
      viewport,
    });

    await renderTask.promise.then(() => page.cleanup()).catch(() => page.cleanup());
    return canvas;
  }

  function polyToBBox(poly: Array<[number, number]>): [number, number, number, number] {
    const xs = poly.map(([x]) => x);
    const ys = poly.map(([, y]) => y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function luminance(data: Uint8ClampedArray, offset: number) {
    return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }

  function refineHorizontalBBoxByInk(
    context: CanvasRenderingContext2D | null,
    canvasWidth: number,
    canvasHeight: number,
    bbox: [number, number, number, number],
  ): [number, number, number, number] {
    if (!context) return bbox;

    const [x1, y1, x2, y2] = bbox;
    const cropX = clamp(Math.floor(x1), 0, canvasWidth - 1);
    const cropY = clamp(Math.floor(y1), 0, canvasHeight - 1);
    const cropRight = clamp(Math.ceil(x2), cropX + 1, canvasWidth);
    const cropBottom = clamp(Math.ceil(y2), cropY + 1, canvasHeight);
    const cropWidth = cropRight - cropX;
    const cropHeight = cropBottom - cropY;

    if (cropWidth < 4 || cropHeight < 4) return bbox;

    const image = context.getImageData(cropX, cropY, cropWidth, cropHeight);
    const sampleLuminance: number[] = [];
    const step = Math.max(1, Math.floor(Math.sqrt((cropWidth * cropHeight) / 1200)));

    for (let y = 0; y < cropHeight; y += step) {
      for (let x = 0; x < cropWidth; x += step) {
        sampleLuminance.push(luminance(image.data, (y * cropWidth + x) * 4));
      }
    }

    sampleLuminance.sort((a, b) => a - b);
    const background = sampleLuminance[Math.floor(sampleLuminance.length * 0.9)] ?? 255;
    const inkThreshold = Math.max(70, background - 55);
    const columnInk = new Array(cropWidth).fill(0);

    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        if (luminance(image.data, (y * cropWidth + x) * 4) < inkThreshold) {
          columnInk[x] += 1;
        }
      }
    }

    const minColumnInk = Math.max(3, Math.floor(cropHeight * 0.1));
    const columnWindow = (x: number) =>
      (columnInk[x - 2] ?? 0) +
      (columnInk[x - 1] ?? 0) +
      columnInk[x] +
      (columnInk[x + 1] ?? 0) +
      (columnInk[x + 2] ?? 0);

    let left = 0;
    let right = cropWidth - 1;

    while (left < right && columnWindow(left) < minColumnInk) left += 1;
    while (right > left && columnWindow(right) < minColumnInk) right -= 1;

    const refinedWidth = right - left + 1;
    if (refinedWidth < cropWidth * 0.35) return bbox;

    const pad = Math.max(1, Math.round(Math.min(cropWidth, cropHeight) * 0.04));
    const rightPad = Math.max(pad, Math.round(cropHeight * 0.06));
    return [
      clamp(cropX + left - pad, x1, x2),
      y1,
      clamp(cropX + right + 1 + rightPad, x1, x2),
      y2,
    ];
  }

  function convertLocalResult(pageNumber: number, result: OcrResult, canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const lines = result.items
      .filter((item) => item.text.trim())
      .map((item) => ({
        text: item.text.trim(),
        bbox: refineHorizontalBBoxByInk(context, canvas.width, canvas.height, polyToBBox(item.poly)),
        score: item.score,
      }));

    return {
      page: pageNumber,
      imageWidth: result.image.width,
      imageHeight: result.image.height,
      lines: resolveSmallHorizontalOverlaps(lines),
      metrics: result.metrics,
      runtime: result.runtime,
    };
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
    const runControl = { runId, cancelled: false };
    ocrTreeSortMode = 'reading';
    activeOcrRunControl = runControl;

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
      selectedPageNumber,
      selectedLineIndex,
      lastLocalOcrError,
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

          const canvas = await renderPdfPageAsCanvas(currentPdfInstance, pageNumber);
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

          const [result] = await ocr.predict(canvas, {
            textDetLimitSideLen: getOcrQualitySize(),
            textDetUnclipRatio: OCR_TEXT_DET_UNCLIP_RATIO,
            textRecScoreThresh: 0.35,
          });
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

      const detail = formatError(error);
      const fallbackDetail = lastLocalOcrError
        ? `\n\nWorker error:\n${lastLocalOcrError}`
        : '';
      applyOcrRunPatch({
        errorMessage: `${$t('ocr_lab.errors.local_failed')}\n\n${detail}${fallbackDetail}`,
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
    buildProgress = null;

    try {
      flushOcrJsonFromEditor();
      const parsed = parseJson();
      const result = await buildSearchablePdf({
        pdfBytes,
        ocr: parsed,
        pageStart: 1,
        pageEnd: pdfInstance.numPages,
        onProgress: (current, total) => {
          buildProgress = { current, total };
        },
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

<svelte:window on:pointermove={handlePreviewPointerMove} on:pointerup={finishBBoxDrag} on:pointercancel={finishBBoxDrag} />

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
	      <aside class="w-full lg:w-[35%] min-h-[85vh] flex-shrink-0 flex flex-col gap-4">
	        <Header activePage="ocr" on:openhelp={() => (showHelpModal = true)} />

	        <OcrControls
	          pdfPageCount={pdfInstance?.numPages || 1}
	          hasPdf={Boolean(pdfFile)}
	          {pageStart}
	          {pageEnd}
	          workerPoolSize={ocrWorkerPoolSize}
	          resolutionQuality={ocrResolutionQuality}
	          minWorkerPoolSize={OCR_MIN_WORKER_POOL_SIZE}
	          maxWorkerPoolSize={OCR_MAX_WORKER_POOL_SIZE}
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

        {#if buildProgress}
          <p class="text-sm text-sky-700 bg-sky-50 border border-sky-300 rounded-lg px-4 py-3">
            {$t('ocr_lab.progress', { values: buildProgress })}
          </p>
        {/if}

        {#if errorMessage}
          <p class="text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-4 py-3 whitespace-pre-line">{errorMessage}</p>
        {/if}

        <div class="mt-auto"></div>
      </aside>

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
                            max={pdfInstance?.numPages || 1}
                            value={selectedPageNumber}
                            on:change={(event) => {
                              const nextPage = parseInt(event.currentTarget.value, 10);
                              if (!Number.isNaN(nextPage) && nextPage >= 1 && nextPage <= (pdfInstance?.numPages || 1)) {
                                selectedPageNumber = nextPage;
                                selectedLineIndex = 0;
                              } else {
                                event.currentTarget.value = String(selectedPageNumber);
                              }
                            }}
                            class="w-15 text-center border-b border-gray-300 focus:border-black outline-none bg-transparent p-0 text-gray-800"
                          />
                          <span class="min-w-12">/ {pdfInstance?.numPages || 0}</span>
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
                                    class="group absolute pointer-events-auto border-2 transition-colors {lineIndex === selectedLineIndex ? 'border-yellow-500 bg-yellow-300/35' : 'border-sky-400 bg-sky-200/20 hover:bg-sky-200/30'}"
                                    style:left={`${overlayRect.left}px`}
                                    style:top={`${overlayRect.top}px`}
                                    style:width={`${Math.max(4, overlayRect.width)}px`}
                                    style:height={`${Math.max(4, overlayRect.height)}px`}
                                    title={line.text}
                                    on:click={() => selectLine(Number(selectedPageNumber), lineIndex)}
                                    on:dblclick|stopPropagation|preventDefault={() => startPreviewTextEdit(lineIndex)}
                                    on:pointerdown={(event) => {
                                      selectLine(Number(selectedPageNumber), lineIndex, { locatePreview: false });
                                      startBBoxDrag(event, 'move');
                                    }}
                                  >
                                    {#if lineIndex === selectedLineIndex}
                                      {#each resizeHandles as handle}
                                        <span
                                          class="absolute w-3 h-3 bg-white border-2 border-yellow-600 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 {handle[1]}"
                                          on:pointerdown|stopPropagation={(event) => startBBoxDrag(event, handle[0])}
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

                          {#if isPreviewRendering && !previewRenderedKey}
                            <div class="absolute inset-0 bg-white/70 flex items-center justify-center text-sm font-bold">{$t('ocr_lab.preview_rendering')}</div>
                          {/if}
                        </div>
                      </div>
                    </div>

                    <button
                      on:click={goToNextPreviewPage}
                      disabled={selectedPageNumber >= (pdfInstance?.numPages || 1)}
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
                  on:click={() => fileInput?.click()}
                  title={$t('tooltip.upload_new')}
                >
                  <Upload size={16} />
                  {$t('btn.upload_new')}
                </button>
                <button
                  class="btn flex gap-2 items-center justify-center font-bold bg-green-500 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 w-full md:w-auto"
                  on:click={generateSearchablePdf}
                  disabled={!pdfFile || isFileLoading || isBuilding}
                  title={$t('tooltip.export_pdf')}
                >
                  <Download size={16} />
                  {#if isBuilding}
                    {$t('btn.loading')}
                  {:else}
                    {$t('btn.generate_pdf')}
                  {/if}
                </button>
              </div>
            </div>
            {:else}
              <div
                class="absolute inset-0"
                role="button"
                tabindex="0"
                on:click={() => fileInput?.click()}
                on:keydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInput?.click();
                  }
                }}
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
  </div>

  <HelpModal bind:showHelpModal />
  <Footer />
</div>
