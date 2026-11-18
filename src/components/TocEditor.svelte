<script lang="ts">
  import {onDestroy, tick, createEventDispatcher} from 'svelte';
  import ShortUniqueId from 'short-unique-id';
  import {createEmptyApiConfig, requiresUserApiKey} from '$lib/llm/core';
  import {
    Sparkles,
    Loader2,
    ChevronsDownUp,
    ChevronsUpDown,
    ArrowUp,
    ArrowDown,
    Hash,
    X,
    Search,
    Plus,
  } from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import {processTocWithDiagnosticsDirect} from '$lib/llm/client';
  import TocItem from './TocItem.svelte';
  import Tooltip from './Tooltip.svelte';
  import {tocItems, maxPage, autoSaveEnabled, dragDisabled, curFileFingerprint} from '../stores';
  import type {TocItem as TocEntry} from '$lib/pdf/service';

  import {dndzone, SHADOW_ITEM_MARKER_PROPERTY_NAME} from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';
  import {fly} from 'svelte/transition';
  import {settle} from '$lib/utils/motion';
  import {hasMod, isDialogOpen, isEditableTarget, modKey} from '$lib/utils/shortcuts';

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }

  export let currentPage = 1;
  export let isPreview = false;
  export let pageOffset = 0;
  export let insertAtPage = 2;
  export let tocPageCount = 0;

  export let apiConfig = createEmptyApiConfig();
  const dispatch = createEventDispatcher();

  type FlatTocItem = Omit<TocEntry, 'children'> & {
    level: number;
    parentId: string | null;
  };

  let flipDurationMs = 200;

  let text = ``;
  let isUpdatingFromEditor = false;
  let isProcessing = false;
  let aiFormatController: AbortController | null = null;
  let aiFormatError = '';
  let debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let batchOffsetInput = '';
  let showBatchOffsetEditor = false;
  let selectedIds = new Set<string>();
  let selectionAnchorId: string | null = null;
  // The moving end of a keyboard selection (↑/↓, ⇧↑/⇧↓).
  let selectionCursorId: string | null = null;
  let searchInput: HTMLInputElement | undefined;
  let isSelectionDragging = false;
  let selectionDragAnchorId: string | null = null;
  let selectionDragMode: 'add' | 'remove' = 'add';
  let selectionDragOrigin: {x: number; y: number} | null = null;
  let hasSelectionDragMoved = false;
  let selectionBeforeDrag = new Set<string>();
  let tocSearchQuery = '';
  // The outline text and the tree are two views of the same ToC.
  let view: 'tree' | 'text' = 'tree';

  let historyStack: TocEntry[][] = [];
  let futureStack: TocEntry[][] = [];
  const maxHistory = 20;

  export function saveHistory() {
    const clone = JSON.parse(JSON.stringify($tocItems));
    historyStack.push(clone);
    if (historyStack.length > maxHistory) {
      historyStack.shift();
    }
    futureStack = [];
  }

  function undo() {
    if (historyStack.length === 0) return;
    const current = JSON.parse(JSON.stringify($tocItems));
    futureStack.push(current);
    const prev = historyStack.pop();
    if (!prev) return;
    $tocItems = prev;
  }

  function redo() {
    if (futureStack.length === 0) return;
    const current = JSON.parse(JSON.stringify($tocItems));
    historyStack.push(current);
    const next = futureStack.pop();
    if (!next) return;
    $tocItems = next;
  }

  function clearSelection() {
    handleMouseUp();
    selectedIds = new Set();
    selectionAnchorId = null;
    selectionCursorId = null;
    showBatchOffsetEditor = false;
    batchOffsetInput = '';
  }

  /** Selecting rows ends any title/page edit, so Delete, Esc and arrows act on the selection. */
  function releaseTreeFieldFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.toc-tree-body') && isEditableTarget(active)) {
      active.blur();
    }
  }

  type VisibleRow = {id: string; parentId: string | null; hasChildren: boolean; open: boolean};

  /** Rows as they appear on screen: collapsed subtrees and search misses are skipped. */
  function getVisibleRows(items: TocEntry[], parentId: string | null = null): VisibleRow[] {
    return items.flatMap((item) => {
      const hasChildren = (item.children?.length ?? 0) > 0;
      const row = {id: item.id, parentId, hasChildren, open: Boolean(item.open)};
      return hasChildren && item.open ? [row, ...getVisibleRows(item.children, item.id)] : [row];
    });
  }

  function getRowElement(id: string) {
    // A row that just moved can briefly exist twice: the old copy fades out inside an inert container.
    return [...document.querySelectorAll<HTMLElement>(`.toc-tree-body [data-toc-item-id="${CSS.escape(id)}"]`)]
      .find((element) => !element.closest('[inert]')) ?? null;
  }

  function revealRow(id: string) {
    tick().then(() => getRowElement(id)?.scrollIntoView({block: 'nearest'}));
  }

  function getCursorIndex(rows: VisibleRow[]) {
    const byCursor = selectionCursorId ? rows.findIndex((row) => row.id === selectionCursorId) : -1;
    if (byCursor !== -1) return byCursor;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (selectedIds.has(rows[index].id)) return index;
    }
    return -1;
  }

  function moveSelectionCursor(delta: 1 | -1, extend: boolean) {
    const rows = getVisibleRows(displayedTocItems);
    if (rows.length === 0) return;

    const cursorIndex = getCursorIndex(rows);
    const nextIndex =
      cursorIndex === -1
        ? delta > 0 ? 0 : rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, cursorIndex + delta));
    const nextId = rows[nextIndex].id;

    if (extend) {
      const anchorId =
        selectionAnchorId && rows.some((row) => row.id === selectionAnchorId)
          ? selectionAnchorId
          : rows[Math.max(cursorIndex, 0)].id;
      selectRange(anchorId, nextId, 'add', new Set());
    } else {
      selectedIds = new Set([nextId]);
      selectionAnchorId = nextId;
    }

    selectionCursorId = nextId;
    revealRow(nextId);
  }

  function selectOnly(id: string) {
    selectedIds = new Set([id]);
    selectionAnchorId = id;
    selectionCursorId = id;
    revealRow(id);
  }

  function setItemOpen(id: string, open: boolean) {
    const updateRecursive = (items: TocEntry[]): TocEntry[] =>
      items.map((item) => {
        if (item.id === id) return {...item, open};
        return item.children?.length ? {...item, children: updateRecursive(item.children)} : item;
      });
    $tocItems = updateRecursive($tocItems);
  }

  /** ← collapses, or steps out to the parent; → expands, or steps into the first child. */
  function stepTree(direction: 'in' | 'out') {
    const rows = getVisibleRows(displayedTocItems);
    const cursorIndex = getCursorIndex(rows);
    if (cursorIndex === -1) return;
    const row = rows[cursorIndex];

    if (direction === 'out') {
      if (row.hasChildren && row.open && !normalizedTocSearch) setItemOpen(row.id, false);
      else if (row.parentId) selectOnly(row.parentId);
      return;
    }

    if (!row.hasChildren) return;
    if (!row.open && !normalizedTocSearch) setItemOpen(row.id, true);
    else if (rows[cursorIndex + 1]) selectOnly(rows[cursorIndex + 1].id);
  }

  function editRowTitle(id: string) {
    const input = getRowElement(id)?.querySelector<HTMLInputElement>('.toc-item-title');
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  function selectAllVisibleItems() {
    const ids = normalizedTocSearch
      ? [...searchMatchedIds]
      : flattenTocItems($tocItems).map((item) => item.id);
    if (ids.length === 0) return;
    selectedIds = new Set(ids);
    selectionAnchorId = ids[0];
    selectionCursorId = ids[ids.length - 1];
  }

  function focusSearch() {
    if (!searchInput) return false;
    searchInput.focus();
    searchInput.select();
    return true;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.defaultPrevented) return;
    // Dialogs own the keyboard while open (e.g. Backspace deletes an erase area there).
    if (isDialogOpen()) return;

    const target = e.target instanceof Element ? e.target : null;
    const inField = isEditableTarget(target);
    const inTree = Boolean(target?.closest('.toc-tree'));
    // Enter and Tab keep their native meaning on a focused button or link.
    const onControl = Boolean(target?.closest('button, a, select, summary, [role="tab"]'));
    const mod = hasMod(e);
    const key = e.key;
    let handled = false;

    if (key === 'Escape') {
      // Esc steps back one layer at a time: the field being edited (or the search text), then the selection.
      if (inField && inTree) {
        if (target === searchInput && tocSearchQuery) {
          tocSearchQuery = '';
        } else {
          (target as HTMLElement).blur();
        }
        handled = true;
      } else if (!inField && selectedIds.size > 0) {
        clearSelection();
        handled = true;
      } else if (!inField && tocSearchQuery) {
        tocSearchQuery = '';
        handled = true;
      }
    } else if (inField) {
      // Typing keeps native behaviour; the title/page fields add their own keys in TocItem.
      if (inTree && mod && key === 'Enter' && target instanceof HTMLTextAreaElement && hasInvalidLines) {
        handleAiFormat();
        handled = true;
      }
    } else if (mod && !e.altKey && key.toLowerCase() === 'z') {
      handled = true;
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && !e.altKey && key.toLowerCase() === 'y') {
      handled = true;
      redo();
    } else if (view === 'tree' && $tocItems.length > 0) {
      const hasSelection = selectedIds.size > 0;

      if ((key === 'Delete' || key === 'Backspace') && !mod && !e.altKey) {
        handled = deleteSelectedTocItems();
      } else if (mod && !e.altKey && !e.shiftKey && key.toLowerCase() === 'a') {
        selectAllVisibleItems();
        handled = true;
      } else if (mod && !e.shiftKey && !e.altKey && key.toLowerCase() === 'f') {
        handled = focusSearch();
      } else if (!mod && !e.altKey && (key === 'ArrowDown' || key === 'ArrowUp') && hasSelection) {
        moveSelectionCursor(key === 'ArrowDown' ? 1 : -1, e.shiftKey);
        handled = true;
      } else if (!mod && !e.altKey && !e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight') && hasSelection) {
        stepTree(key === 'ArrowRight' ? 'in' : 'out');
        handled = true;
      } else if (key === 'Enter' && !mod && !e.altKey && hasSelection && !onControl) {
        const rows = getVisibleRows(displayedTocItems);
        const cursorIndex = getCursorIndex(rows);
        if (cursorIndex !== -1) {
          editRowTitle(rows[cursorIndex].id);
          handled = true;
        }
      } else if (key === 'Tab' && !mod && !e.altKey && hasSelection && !onControl) {
        adjustSelectedLevels(e.shiftKey ? -1 : 1);
        handled = true;
      }
    }

    if (!handled) return;

    e.preventDefault();
    e.stopPropagation();
  }

  let isDragging = false;
  let textGenTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  let showNavHint = false;
  let navHintTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  function handleShowNavHint() {
    if (navHintTimer) clearTimeout(navHintTimer);
    showNavHint = true;
    navHintTimer = setTimeout(() => {
      showNavHint = false;
    }, 4000);
  }

  const unsubscribe = tocItems.subscribe((value) => {
    if (isUpdatingFromEditor) return;
    if (isDragging) return;

    clearTimeout(textGenTimer);
    textGenTimer = setTimeout(() => {
      const newText = generateText(value);
      if (newText !== text) {
        text = newText;
      }
    }, 300);
  });

  onDestroy(() => {
    aiFormatController?.abort();
    unsubscribe();
    clearTimeout(textGenTimer);
    clearTimeout(debounceTimer);
    clearTimeout(navHintTimer);
  });

  $: if ($curFileFingerprint) {
    historyStack = [];
    futureStack = [];
    clearSelection();
  }

  const flattenTocItems = (
    items: TocEntry[],
    level = 1,
    parentId: string | null = null,
  ): FlatTocItem[] =>
    items.flatMap((item) => [
      {
        id: item.id,
        title: item.title,
        to: item.to,
        open: item.open,
        level,
        parentId,
      },
      ...flattenTocItems(item.children || [], level + 1, item.id),
    ]);

  function normalizeFlatLevels(items: FlatTocItem[]): FlatTocItem[] {
    return items.map((item, index) => {
      let level = Math.max(1, Math.floor(item.level) || 1);
      if (index === 0) {
        level = 1;
      } else {
        level = Math.min(level, items[index - 1].level + 1);
      }
      return {...item, level};
    });
  }

  function assignParentIdsFromLevels(items: FlatTocItem[]): FlatTocItem[] {
    const stack: {id: string; level: number}[] = [];

    return normalizeFlatLevels(items).map((item) => {
      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
      const nextItem = {...item, parentId};
      stack.push({id: item.id, level: item.level});
      return nextItem;
    });
  }

  function buildTree(items: {title: string; level: number; page: number}[]) {
    const root: TocEntry[] = [];
    const stack: {node: TocEntry; level: number}[] = [];
    const uid = new ShortUniqueId({length: 10});

    items.forEach((item) => {
      const newItem: TocEntry = {
        id: uid.randomUUID(),
        title: item.title,
        to: Number(item.page) || 1,
        children: [],
        open: true,
      };

      if (item.page > $maxPage) $maxPage = item.page;

      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(newItem);
      } else {
        stack[stack.length - 1].node.children.push(newItem);
      }

      stack.push({node: newItem, level: item.level});
    });

    return root;
  }

  function buildTreeFromFlat(items: FlatTocItem[], forceOpenIds: Set<string> = new Set()): TocEntry[] {
    const root: TocEntry[] = [];
    const stack: {level: number; node: TocEntry}[] = [];

    for (const item of assignParentIdsFromLevels(items)) {
      const node: TocEntry = {
        id: item.id,
        title: item.title,
        to: item.to,
        open: forceOpenIds.has(item.id) ? true : (item.open ?? true),
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({level: item.level, node});
    }

    return root;
  }

  function getFlatIndexMap(items: FlatTocItem[]) {
    return new Map(items.map((item, index) => [item.id, index]));
  }

  function getParentMap(items: FlatTocItem[]) {
    return new Map(items.map((item) => [item.id, item.parentId]));
  }

  function hasSelectedAncestor(
    id: string,
    selected: Set<string>,
    parentMap: Map<string, string | null>,
  ) {
    let currentId = parentMap.get(id) ?? null;

    while (currentId) {
      if (selected.has(currentId)) {
        return true;
      }
      currentId = parentMap.get(currentId) ?? null;
    }

    return false;
  }

  function getSelectedRootIds(items: FlatTocItem[], selected: Set<string>) {
    const parentMap = getParentMap(items);
    return items
      .filter((item) => selected.has(item.id) && !hasSelectedAncestor(item.id, selected, parentMap))
      .map((item) => item.id);
  }

  function getSubtreeEndIndex(items: FlatTocItem[], startIndex: number) {
    const startLevel = items[startIndex].level;
    let endIndex = startIndex + 1;

    while (endIndex < items.length && items[endIndex].level > startLevel) {
      endIndex += 1;
    }

    return endIndex;
  }

  function getPreviousSiblingIndex(items: FlatTocItem[], startIndex: number) {
    const currentLevel = items[startIndex].level;

    for (let index = startIndex - 1; index >= 0; index -= 1) {
      if (items[index].level === currentLevel) {
        return index;
      }
      if (items[index].level < currentLevel) {
        return null;
      }
    }

    return null;
  }

  function canDemoteSelectedRoot(
    items: FlatTocItem[],
    startIndex: number,
    selectedRootIds: Set<string>,
  ) {
    let currentIndex = startIndex;
    let previousSiblingIndex = getPreviousSiblingIndex(items, currentIndex);

    while (
      previousSiblingIndex !== null &&
      selectedRootIds.has(items[previousSiblingIndex].id)
    ) {
      currentIndex = previousSiblingIndex;
      previousSiblingIndex = getPreviousSiblingIndex(items, currentIndex);
    }

    return previousSiblingIndex !== null;
  }

  function getAncestorIds(items: FlatTocItem[], ids: Iterable<string>) {
    const parentMap = getParentMap(items);
    const ancestorIds = new Set<string>();

    for (const id of ids) {
      let currentId = parentMap.get(id) ?? null;
      while (currentId) {
        ancestorIds.add(currentId);
        currentId = parentMap.get(currentId) ?? null;
      }
    }

    return ancestorIds;
  }

  function selectRange(
    anchorId: string,
    targetId: string,
    mode: 'add' | 'remove' = 'add',
    baseSelection = selectedIds,
  ) {
    const flatItems = flattenTocItems($tocItems);
    const indexMap = getFlatIndexMap(flatItems);
    const anchorIndex = indexMap.get(anchorId);
    const targetIndex = indexMap.get(targetId);

    if (anchorIndex === undefined || targetIndex === undefined) return;

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const nextSelection = new Set(baseSelection);
    flatItems.slice(start, end + 1).forEach((flatItem) => {
      if (mode === 'remove') {
        nextSelection.delete(flatItem.id);
      } else {
        nextSelection.add(flatItem.id);
      }
    });
    selectedIds = nextSelection;
    selectionAnchorId = anchorId;
  }

  function handleSelectItem(item: TocEntry, event: MouseEvent) {
    window.getSelection()?.removeAllRanges();
    releaseTreeFieldFocus();
    selectionCursorId = item.id;

    const flatItems = flattenTocItems($tocItems);
    const indexMap = getFlatIndexMap(flatItems);
    const clickedIndex = indexMap.get(item.id);

    if (clickedIndex === undefined) return;

    if (event.shiftKey) {
      const anchorId =
        selectionAnchorId && indexMap.has(selectionAnchorId) ? selectionAnchorId : item.id;
      selectRange(anchorId, item.id, selectedIds.has(item.id) ? 'remove' : 'add');
      return;
    }

    const nextSelection = new Set(selectedIds);
    if (nextSelection.has(item.id)) {
      nextSelection.delete(item.id);
    } else {
      nextSelection.add(item.id);
    }
    selectedIds = nextSelection;
    selectionAnchorId = item.id;
  }

  function handleSelectionDragStart(item: TocEntry, event: MouseEvent) {
    if (event.button !== 0) return;
    releaseTreeFieldFocus();
    selectionCursorId = item.id;
    isSelectionDragging = true;
    selectionDragAnchorId = item.id;
    selectionAnchorId = item.id;
    selectionDragMode = selectedIds.has(item.id) ? 'remove' : 'add';
    selectionDragOrigin = {x: event.clientX, y: event.clientY};
    hasSelectionDragMoved = false;
    selectionBeforeDrag = new Set(selectedIds);

    selectRange(item.id, item.id, selectionDragMode);

    window.getSelection()?.removeAllRanges();
  }

  function handleSelectionDragMove(event: MouseEvent) {
    if (!isSelectionDragging || !selectionDragAnchorId || !selectionDragOrigin) return;
    if (!(event.buttons & 1)) {
      handleMouseUp();
      return;
    }
    if (!hasSelectionDragMoved) {
      const distance = Math.hypot(event.clientX - selectionDragOrigin.x, event.clientY - selectionDragOrigin.y);
      if (distance < 6) return;
      hasSelectionDragMoved = true;
    }

    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-toc-item-id]');
    const itemId = element?.dataset.tocItemId;

    if (!itemId) return;
    selectRange(selectionDragAnchorId, itemId, selectionDragMode, selectionBeforeDrag);
    selectionCursorId = itemId;
  }

  function adjustSelectedPageOffset(delta: number) {
    if (!delta || selectedIds.size === 0) return;

    saveHistory();
    const flatItems = flattenTocItems($tocItems);
    const selectedRootIds = new Set(getSelectedRootIds(flatItems, selectedIds));

    const updateRecursive = (items: TocEntry[], inSelectedSubtree = false): TocEntry[] =>
      items.map((item) => {
        const shouldApply = inSelectedSubtree || selectedRootIds.has(item.id);
        return {
          ...item,
          to: shouldApply ? Math.max(1, item.to + delta) : item.to,
          children: item.children?.length ? updateRecursive(item.children, shouldApply) : [],
        };
      });

    $tocItems = updateRecursive($tocItems);
  }

  function applyBatchOffset() {
    const delta = parseInt(batchOffsetInput, 10);
    if (Number.isNaN(delta) || delta === 0) return;

    adjustSelectedPageOffset(delta);
    batchOffsetInput = '';
    showBatchOffsetEditor = false;
  }

  function adjustSelectedLevels(delta: -1 | 1) {
    adjustLevels(selectedIds, delta);
  }

  /** Tab / ⇧Tab inside a title: move that one entry (with its children) down or up a level. */
  async function indentItem(item: TocEntry, delta: -1 | 1) {
    const changed = adjustLevels(new Set([item.id]), delta);
    if (!changed) return;
    await tick();
    editRowTitle(item.id);
  }

  function adjustLevels(ids: Set<string>, delta: -1 | 1) {
    if (ids.size === 0) return false;

    const originalFlatItems = normalizeFlatLevels(flattenTocItems($tocItems));
    const flatItems = [...originalFlatItems];
    const selectedRootIds = getSelectedRootIds(originalFlatItems, ids);
    const selectedRootIdSet = new Set(selectedRootIds);
    const indexMap = getFlatIndexMap(originalFlatItems);
    let hasChanges = false;

    for (const id of selectedRootIds) {
      const startIndex = indexMap.get(id);
      if (startIndex === undefined) continue;

      if (delta === -1 && originalFlatItems[startIndex].level <= 1) continue;
      if (
        delta === 1 &&
        !canDemoteSelectedRoot(originalFlatItems, startIndex, selectedRootIdSet)
      ) {
        continue;
      }

      const endIndex = getSubtreeEndIndex(originalFlatItems, startIndex);
      for (let index = startIndex; index < endIndex; index += 1) {
        flatItems[index] = {
          ...flatItems[index],
          level: flatItems[index].level + delta,
        };
      }
      hasChanges = true;
    }

    if (!hasChanges) return false;

    const nextFlatItems = assignParentIdsFromLevels(flatItems);
    const forceOpenIds = getAncestorIds(nextFlatItems, selectedRootIds);

    saveHistory();
    $tocItems = buildTreeFromFlat(nextFlatItems, forceOpenIds);
    return true;
  }

  async function handleAiFormat() {
    if (!text.trim() || isProcessing) return;
    const controller = new AbortController();
    aiFormatController = controller;
    const fingerprint = $curFileFingerprint;
    const isCurrent = () => !controller.signal.aborted && fingerprint === $curFileFingerprint;
    aiFormatError = '';

    try {
      if (requiresUserApiKey(apiConfig.apiKey)) {
        throw new Error($t('error.needs_api_key'));
      }

      const MAX_TEXT_SIZE = 128 * 1024;
      if (new TextEncoder().encode(text).length > MAX_TEXT_SIZE) {
        throw new Error('Text content is too large. Limit is 128KB.');
      }

      isProcessing = true;
      const aiResult = await processTocWithDiagnosticsDirect({
        signal: controller.signal,
        text,
        apiKey: apiConfig.apiKey,
        provider: apiConfig.provider,
        customBaseUrl: apiConfig.customBaseUrl,
        doubaoEndpointIdText: apiConfig.doubaoEndpointIdText,
        doubaoEndpointIdVision: apiConfig.doubaoEndpointIdVision,
        modelOverrides: apiConfig.modelOverrides,
      });

      if (!isCurrent()) return;
      if (aiResult.items.length === 0) {
        throw new Error('AI could not parse any ToC structure.');
      }
      dispatch('aiFormatResponse', { items: buildTree(aiResult.items), incomplete: aiResult.incomplete });
    } catch (error) {
      if (!isCurrent()) return;
      aiFormatError = error instanceof Error ? error.message : $t('error.ai_failed');
    } finally {
      if (aiFormatController === controller) {
        aiFormatController = null;
        isProcessing = false;
      }
    }
  }

  function parseText(text: string) {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const items: TocEntry[] = [];
    const stack = [{level: 0, item: {children: items}}];
    const uid = new ShortUniqueId({length: 10});

    lines.forEach((line) => {
      const match = line.match(/^(\d+(?:\.\d+)*)\s+(.*?)\s+(-?\d+)$/);
      if (match) {
        const [, number, title, pageStr] = match;
        const level = number.split('.').length;
        const page = parseInt(pageStr, 10);

        const newItem: TocEntry = {
          id: uid.randomUUID(),
          title,
          to: page,
          children: [],
          open: true,
        };

        if (page > $maxPage) $maxPage = page;

        while (stack[stack.length - 1].level >= level) stack.pop();
        stack[stack.length - 1].item.children.push(newItem);
        stack.push({level, item: newItem});
      }
    });
    return items;
  }

  function generateText(items: TocEntry[], prefix = '') {
    return items
      .map((item, index) => {
        const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
        let txt = `${number} ${item.title} ${item.to}`;
        if (item.children?.length) txt += '\n' + generateText(item.children, number);
        return txt;
      })
      .join('\n');
  }

  function handleInput(e: Event) {
    clearTimeout(textGenTimer);
    isUpdatingFromEditor = true;
    text = (e.target as HTMLTextAreaElement).value;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const parsed = parseText(text);
      if (parsed.length > 0) {
        $tocItems = parsed;
      }
      tick().then(() => {
        isUpdatingFromEditor = false;
      });
    }, 300);
  }

  const handleDragStart = () => {
    if (!isDragging) {
      saveHistory();
      $autoSaveEnabled = false;
      isDragging = true;
    }
  };

  const handleDragEnd = () => {
    tick().then(() => {
      isDragging = false;
      const newText = generateText($tocItems);
      if (newText !== text) text = newText;
      $autoSaveEnabled = true;
    });
  };

  function handleMouseUp() {
    $dragDisabled = true;
    isSelectionDragging = false;
    selectionDragAnchorId = null;
    selectionDragOrigin = null;
    hasSelectionDragMoved = false;
    selectionBeforeDrag = new Set();
  }

  function handleDndConsider(e: CustomEvent<{items: TocEntry[]}>) {
    handleDragStart();
    $tocItems = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent<{items: TocEntry[]}>) {
    $tocItems = e.detail.items;
    handleDragEnd();
  }

  $: if (!isDragging) {
    const allIds = new Set(flattenTocItems($tocItems).map((item) => item.id));
    const nextSelection = new Set([...selectedIds].filter((id) => allIds.has(id)));
    const selectionChanged =
      nextSelection.size !== selectedIds.size ||
      [...nextSelection].some((id) => !selectedIds.has(id));

    if (selectionChanged) {
      selectedIds = nextSelection;
    }

    if (selectionAnchorId && !allIds.has(selectionAnchorId)) {
      selectionAnchorId = null;
    }
  }

  $: firstItemWithChildrenId = (() => {
    const findFirst = (items: TocEntry[]): string | null => {
      for (const item of items) {
        if (item.children?.length > 0) return item.id;
        if (item.children) {
          const childResult = findFirst(item.children);
          if (childResult) return childResult;
        }
      }
      return null;
    };
    return findFirst($tocItems);
  })();

  const addMultipleTocItems = (count: number) => {
    saveHistory();
    const currentItems = $tocItems;
    let startPage;

    if (currentItems.length > 0) {
      startPage = Math.max(...currentItems.map((item) => item.to)) + 1;
    } else {
      startPage = ($maxPage || 0) + 1;
    }

    const uid = new ShortUniqueId({length: 10});
    const newItems = Array.from({length: count}, (_, index) => ({
      id: uid.randomUUID(),
      title: '',
      to: startPage + index,
      children: [],
      open: true,
    }));

    $tocItems = [...currentItems, ...newItems];
  };

  const toggleAll = (open: boolean) => {
    flipDurationMs = 0;
    const updateRecursive = (items: TocEntry[]): TocEntry[] =>
      items.map((item) => ({
        ...item,
        open,
        children: item.children?.length ? updateRecursive(item.children) : [],
      }));
    $tocItems = updateRecursive($tocItems);
    tick().then(() => {
      setTimeout(() => {
        flipDurationMs = 200;
      }, 50);
    });
  };

  const expandAll = () => toggleAll(true);
  const collapseAll = () => toggleAll(false);

  $: flatTocItems = flattenTocItems($tocItems);
  $: tocMaxLevel = flatTocItems.reduce((max, item) => Math.max(max, item.level), 0);
  $: showTocSearch = flatTocItems.length > 10 && tocMaxLevel >= 2;
  $: normalizedTocSearch = tocSearchQuery.trim().toLowerCase();
  $: searchMatchedIds = new Set(
    normalizedTocSearch
      ? flatTocItems
          .filter((item) => `${item.title} ${item.to}`.toLowerCase().includes(normalizedTocSearch))
          .map((item) => item.id)
      : [],
  );
  $: searchOpenIds = normalizedTocSearch ? getAncestorIds(flatTocItems, searchMatchedIds) : new Set<string>();
  $: displayedTocItems = normalizedTocSearch
    ? filterTocItemsForSearch($tocItems, searchMatchedIds, searchOpenIds)
    : $tocItems;

  function filterTocItemsForSearch(
    items: TocEntry[],
    matchedIds: Set<string>,
    ancestorIds: Set<string>,
  ): TocEntry[] {
    return items.flatMap((item) => {
      if (!matchedIds.has(item.id) && !ancestorIds.has(item.id)) {
        return [];
      }

      return [{
        ...item,
        open: ancestorIds.has(item.id) ? true : item.open,
        children: item.children?.length
          ? filterTocItemsForSearch(item.children, matchedIds, ancestorIds)
          : [],
      }];
    });
  }

  $: hasAnyExpanded = $tocItems.some((item: TocEntry) => item.open);
  $: selectedCount = selectedIds.size;
  $: if (selectedCount === 0) {
    showBatchOffsetEditor = false;
    batchOffsetInput = '';
  }

  const addTocItem = () => {
    addMultipleTocItems(1);
  };

  const updateTocItem = (item: TocEntry, updates: Partial<TocEntry>, skipHistory = false) => {
    if (!skipHistory) {
      saveHistory();
    }
    const updateItemRecursive = (items: TocEntry[]): TocEntry[] =>
      items.map((currentItem) => {
        if (currentItem.id === item.id) return {...currentItem, ...updates};
        if (currentItem.children?.length) {
          return {...currentItem, children: updateItemRecursive(currentItem.children)};
        }
        return currentItem;
      });
    $tocItems = updateItemRecursive($tocItems);
  };

  const deleteTocItem = (itemToDelete: TocEntry) => {
    saveHistory();
    const deleteItemRecursive = (items: TocEntry[]): TocEntry[] =>
      items
        .filter((item) => item.id !== itemToDelete.id)
        .map((item) => ({
          ...item,
          children: item.children?.length ? deleteItemRecursive(item.children) : [],
        }));

    $tocItems = deleteItemRecursive($tocItems);
  };

  function deleteSelectedTocItems() {
    if (selectedIds.size === 0) return false;

    const flatItems = flattenTocItems($tocItems);
    const selectedRootIds = new Set(getSelectedRootIds(flatItems, selectedIds));
    if (selectedRootIds.size === 0) return false;

    saveHistory();
    const deleteItemsRecursive = (items: TocEntry[]): TocEntry[] =>
      items
        .filter((item) => !selectedRootIds.has(item.id))
        .map((item) => ({
          ...item,
          children: item.children?.length ? deleteItemsRecursive(item.children) : [],
        }));

    $tocItems = deleteItemsRecursive($tocItems);
    clearSelection();
    return true;
  }

  const TOC_REGEX = /^(\d+(?:\.\d+)*)\s+(.*?)\s+(-?\d+)$/;

  $: hasInvalidLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => !TOC_REGEX.test(line));

  $: promptTooltipText = $t('toc.prompt_intro');
  let innerWidth: number;
</script>

<svelte:window
  on:keydown={handleKeydown}
  on:mousemove={handleSelectionDragMove}
  on:mouseup={handleMouseUp}
  on:touchend={handleMouseUp}
  on:touchcancel={handleMouseUp}
  on:blur={handleMouseUp}
  bind:innerWidth
/>

<div class="mt-3 flex flex-col gap-3">
  {#if aiFormatError}
    <p role="alert" class="text-xs text-red-700 break-words">{aiFormatError}</p>
  {/if}

  <div class="toc-tree ui-card relative">
    <div class="toc-tree-header sticky top-0 z-30 flex min-h-[46px] items-center gap-2 rounded-t-[6px] border-b border-[color:var(--divider)] bg-white px-2.5 py-2">
      {#if selectedCount >= 1 && view === 'tree'}
        <!-- One row when it fits; otherwise count + close on top and the actions share the second row evenly. -->
        <div class="selection-bar" in:settle>
          <span class="selection-count" title={$t('toc.batch_operations')}>
            {$t('toc.selected_count', {values: {count: selectedCount}})}
          </span>
          <div class="selection-actions">
            <button
              type="button"
              on:click={() => adjustSelectedLevels(-1)}
              title="{$t('toc.promote_selected_hint')} (⇧Tab)"
              class="nb-btn nb-btn-sm bg-blue-300"
            >
              <ArrowUp size={13} strokeWidth={2.25} />
              {$t('toc.promote_selected')}
            </button>
            <button
              type="button"
              on:click={() => adjustSelectedLevels(1)}
              title="{$t('toc.demote_selected_hint')} (Tab)"
              class="nb-btn nb-btn-sm bg-lime-300"
            >
              <ArrowDown size={13} strokeWidth={2.25} />
              {$t('toc.demote_selected')}
            </button>
            {#if showBatchOffsetEditor}
              <div class="offset-editor" in:settle={{y: 0}}>
                <input
                  type="number"
                  bind:value={batchOffsetInput}
                  placeholder={$t('toc.offset_placeholder')}
                  on:keydown={(e) => {
                    if (e.key === 'Enter') applyBatchOffset();
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      showBatchOffsetEditor = false;
                    }
                  }}
                  use:focusOnMount
                  aria-label={$t('toc.offset_selected_hint')}
                  class="nb-field h-8 min-w-0 flex-1 px-2 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  on:click={applyBatchOffset}
                  title={$t('toc.apply_offset_hint')}
                  class="nb-btn nb-btn-sm bg-yellow-400"
                >
                  {$t('toc.apply_offset')}
                </button>
              </div>
            {:else}
              <button
                type="button"
                on:click={() => {
                  showBatchOffsetEditor = true;
                  batchOffsetInput = '';
                }}
                title={$t('toc.offset_selected_hint')}
                class="nb-btn nb-btn-sm bg-yellow-400"
              >
                <Hash size={13} strokeWidth={2.25} />
                {$t('toc.offset_selected')}
              </button>
            {/if}
          </div>
          <button
            type="button"
            on:click={clearSelection}
            class="selection-close nb-icon-btn"
            aria-label={$t('toc.clear_selection')}
            title="{$t('toc.clear_selection')} (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      {:else}
        <div class="flex min-w-0 flex-1 items-center gap-2" in:settle>
          <div class="ui-segmented shrink-0" role="tablist" aria-label={$t('header.toc')}>
            <button type="button" role="tab" aria-selected={view === 'tree'} aria-pressed={view === 'tree'} on:click={() => (view = 'tree')}>
              {$t('header.toc')}
              {#if flatTocItems.length > 0}
                <span class="tabular-nums opacity-60">{flatTocItems.length}</span>
              {/if}
            </button>
            <button type="button" role="tab" aria-selected={view === 'text'} aria-pressed={view === 'text'} on:click={() => (view = 'text')}>
              {$t('toc.view_text')}
            </button>
          </div>
          {#if showTocSearch && view === 'tree'}
            <div class="relative ml-auto min-w-0 max-w-[240px] flex-1">
              <Search size={14} aria-hidden="true" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                bind:this={searchInput}
                bind:value={tocSearchQuery}
                title="{$t('toc.search_placeholder') || 'Search ToC...'} ({modKey} F)"
                aria-label={$t('toc.search_placeholder') || 'Search ToC...'}
                placeholder={$t('toc.search_placeholder') || 'Search ToC...'}
                class="nb-field h-8 pl-8 pr-7 text-xs"
              />
              {#if tocSearchQuery}
                <button
                  type="button"
                  on:click={() => (tocSearchQuery = '')}
                  class="absolute right-0.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-gray-500 hover:text-black"
                  aria-label={$t('toc.clear_search') || 'Clear search'}
                  title={$t('toc.clear_search') || 'Clear search'}
                >
                  <X size={13} />
                </button>
              {/if}
            </div>
          {/if}
        </div>
        {#if firstItemWithChildrenId && view === 'tree'}
          <button
            type="button"
            on:click={() => (hasAnyExpanded ? collapseAll() : expandAll())}
            class="nb-icon-btn"
            title={hasAnyExpanded ? $t('toc.collapse_all') : $t('toc.expand_all')}
            aria-label={hasAnyExpanded ? $t('toc.collapse_all') : $t('toc.expand_all')}
          >
            {#if hasAnyExpanded}
              <ChevronsDownUp size={16} />
            {:else}
              <ChevronsUpDown size={16} />
            {/if}
          </button>
        {/if}
      {/if}
    </div>

    {#if showNavHint}
      <div class="pointer-events-none absolute right-2 top-14 z-40">
        <div
          transition:fly={{y: -6, duration: 200}}
          class="rounded-lg bg-black/50 px-2 py-1 text-xs text-white backdrop-blur-sm"
        >
          {$t('toc.nav_hint')}
        </div>
      </div>
    {/if}

    {#if view === 'text'}
      <div class="relative">
        <textarea
          placeholder={$t('toc.outline_placeholder')}
          bind:value={text}
          on:input={handleInput}
          spellcheck="false"
          aria-label={$t('toc.view_text')}
          class="toc-text block h-80 w-full resize-y bg-transparent px-4 py-3 pb-12 text-sm leading-6 text-black placeholder:text-gray-400"
        ></textarea>
        {#if hasInvalidLines}
          <div class="absolute bottom-3 right-3">
            <Tooltip
              isTextCopiable
              width="md:w-[350px] w-[250px]"
              text={promptTooltipText}
              position={innerWidth < 1024 ? '-200 -500' : '100 -600'}
            >
              <button
                type="button"
                on:click={handleAiFormat}
                disabled={isProcessing || !text.trim()}
                class="flex items-center gap-1.5 bg-gradient-to-br from-blue-300 to-pink-600 text-white px-3 py-1.5 rounded-md shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
              >
                {#if isProcessing}
                  <Loader2 size={16} class="animate-spin" />
                  <span class="text-xs font-bold">Processing...</span>
                {:else}
                  <Sparkles size={16} />
                  <span class="text-xs font-bold">AI Format</span>
                {/if}
              </button>
            </Tooltip>
          </div>
        {/if}
      </div>
    {:else if $tocItems.length > 0}
      <div class="toc-tree-body py-2 pr-1.5" style="--toc-indent: 20px; --toc-gutter: 56px; padding-left: var(--toc-gutter);">
        <section
          use:dndzone={{
            items: displayedTocItems,
            flipDurationMs,
            dragDisabled: $dragDisabled || Boolean(normalizedTocSearch),
            dropTargetStyle: {outline: '2px dashed #000', outlineOffset: '2px', borderRadius: '8px'},
          }}
          on:consider={handleDndConsider}
          on:finalize={handleDndFinalize}
          class="min-h-[20px]"
        >
          {#each displayedTocItems as item, i (`${item.id}${item[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? `_${item[SHADOW_ITEM_MARKER_PROPERTY_NAME]}` : ''}`)}
            <div animate:flip={{duration: flipDurationMs}}>
              <TocItem
                {item}
                {flipDurationMs}
                onUpdate={updateTocItem}
                onDelete={deleteTocItem}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onSelect={handleSelectItem}
                onSelectionDragStart={handleSelectionDragStart}
                onIndent={indentItem}
                {currentPage}
                {isPreview}
                {pageOffset}
                {insertAtPage}
                {tocPageCount}
                {selectedIds}
                searchQuery={tocSearchQuery}
                on:showNavHint={handleShowNavHint}
                on:hoveritem
                on:jumpToPage={(e: CustomEvent<{to: number}>) => {
                  dispatch('jumpToPage', e.detail);
                }}
                index={i + 1}
              />
            </div>
          {/each}
        </section>
        {#if normalizedTocSearch && displayedTocItems.length === 0}
          <p class="py-6 pr-6 text-center text-xs text-gray-500">{$t('chapter_export.no_results')}</p>
        {/if}
      </div>
    {:else}
      <!-- Empty: the original three steps, then one real action. -->
      <div class="flex flex-col items-center px-6 pb-9 pt-9" in:settle>
        <p class="whitespace-pre-line text-sm leading-7 text-gray-500">{$t('toc.outline_placeholder')}</p>
        <button
          type="button"
          on:click={addTocItem}
          class="nb-btn mt-6 bg-yellow-400"
        >
          <Plus size={16} strokeWidth={2.25} />
          {$t('btn.add_chapter')}
        </button>
      </div>
    {/if}

    {#if view === 'tree' && $tocItems.length > 0}
    <div class="flex items-center gap-2 rounded-b-[6px] border-t border-[color:var(--divider)] px-2.5 py-2.5">
      <button
        type="button"
        on:click={addTocItem}
        class="nb-btn bg-yellow-400"
      >
        <Plus size={16} strokeWidth={2.25} />
        {$t('btn.add_chapter')}
      </button>
      <button
        type="button"
        on:click={() => addMultipleTocItems(5)}
        class="nb-btn bg-white px-3"
      >
        +5
      </button>
      <button
        type="button"
        on:click={() => addMultipleTocItems(10)}
        class="nb-btn bg-white px-3"
      >
        +10
      </button>
    </div>
    {/if}
  </div>
</div>

<style>
  .toc-tree-header {
    container-type: inline-size;
  }

  /* Narrow sidebar: count and close share the top row, the three actions split the second row evenly. */
  .selection-bar {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'count close'
      'actions actions';
    align-items: center;
    gap: 8px 6px;
  }

  .selection-count {
    grid-area: count;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: #fef9c3;
    color: #000;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .selection-actions {
    grid-area: actions;
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  .selection-actions > button {
    flex: 1 1 0;
    min-width: 0;
  }

  .offset-editor {
    display: flex;
    flex: 1.5 1 0;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .selection-close {
    grid-area: close;
  }

  /* Wide enough for everything: a single row. */
  @container (min-width: 430px) {
    .selection-bar {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: 'count actions close';
      column-gap: 8px;
    }

    .selection-actions > button {
      flex: 0 0 auto;
    }

    .offset-editor {
      flex: 0 1 11rem;
    }
  }

  textarea.toc-text,
  textarea.toc-text:focus {
    border: 0;
    border-radius: 0 0 6px 6px;
    outline: none;
    box-shadow: none;
  }
</style>
