<script lang="ts">
  import {onDestroy, tick, createEventDispatcher} from 'svelte';
  import ShortUniqueId from 'short-unique-id';
  import {createEmptyApiConfig, requiresUserApiKeyForModel} from '$lib/llm/core';
  import {
    Sparkles,
    Loader2,
    ChevronsDownUp,
    ChevronsUpDown,
    ArrowUp,
    ArrowDown,
    Hash,
    X,
  } from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import {processTocDirect} from '$lib/llm/client';
  import TocItem from './TocItem.svelte';
  import Tooltip from './Tooltip.svelte';
  import {tocItems, maxPage, autoSaveEnabled, dragDisabled, curFileFingerprint} from '../stores';
  import type {TocItem as TocEntry} from '$lib/pdf/service';

  import {dndzone, SHADOW_ITEM_MARKER_PROPERTY_NAME} from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';
  import {fly} from 'svelte/transition';

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
  let debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let batchOffsetInput = '';
  let showBatchOffsetEditor = false;
  let selectedIds = new Set<string>();
  let selectionAnchorId: string | null = null;

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
    selectedIds = new Set();
    selectionAnchorId = null;
    showBatchOffsetEditor = false;
    batchOffsetInput = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tagName = target?.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) {
        e.preventDefault();
        redo();
      } else {
        e.preventDefault();
        undo();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'Escape' && selectedIds.size > 0) {
      e.preventDefault();
      clearSelection();
    }
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

  function handleSelectItem(item: TocEntry, event: MouseEvent) {
    const flatItems = flattenTocItems($tocItems);
    const indexMap = getFlatIndexMap(flatItems);
    const clickedIndex = indexMap.get(item.id);

    if (clickedIndex === undefined) return;

    if (event.shiftKey) {
      const anchorId =
        selectionAnchorId && indexMap.has(selectionAnchorId) ? selectionAnchorId : item.id;
      const anchorIndex = indexMap.get(anchorId) ?? clickedIndex;
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const rangeIds = flatItems.slice(start, end + 1).map((flatItem) => flatItem.id);
      const nextSelection = new Set(selectedIds);

      rangeIds.forEach((id) => nextSelection.add(id));
      selectedIds = nextSelection;
      selectionAnchorId = anchorId;
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
    if (selectedIds.size === 0) return;

    const originalFlatItems = normalizeFlatLevels(flattenTocItems($tocItems));
    const flatItems = [...originalFlatItems];
    const selectedRootIds = getSelectedRootIds(originalFlatItems, selectedIds);
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

    if (!hasChanges) return;

    const nextFlatItems = assignParentIdsFromLevels(flatItems);
    const forceOpenIds = getAncestorIds(nextFlatItems, selectedRootIds);

    saveHistory();
    $tocItems = buildTreeFromFlat(nextFlatItems, forceOpenIds);
  }

  async function handleAiFormat() {
    if (!text.trim()) return;

    if (requiresUserApiKeyForModel(apiConfig.provider, apiConfig.apiKey, apiConfig.modelOverrides)) {
      throw new Error($t('error.custom_model_needs_api_key'));
    }

    const MAX_TEXT_SIZE = 128 * 1024;
    const byteSize = new TextEncoder().encode(text).length;

    if (byteSize > MAX_TEXT_SIZE) {
      throw new Error(`Text content is too large. Limit is 128KB.`);
    }

    isProcessing = true;
    let aiResult;

    try {
      if (apiConfig.apiKey) {
        aiResult = await processTocDirect({
          text,
          apiKey: apiConfig.apiKey,
          provider: apiConfig.provider,
          doubaoEndpointIdText: apiConfig.doubaoEndpointIdText,
          doubaoEndpointIdVision: apiConfig.doubaoEndpointIdVision,
          modelOverrides: apiConfig.modelOverrides,
        });
      } else {
        const response = await fetch('/api/process-toc', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            text: text,
            apiKey: apiConfig.apiKey,
            provider: apiConfig.provider,
            modelOverrides: apiConfig.modelOverrides,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || 'AI processing failed');
        }

        aiResult = await response.json();
      }
    } finally {
      isProcessing = false;
    }

    if (Array.isArray(aiResult) && aiResult.length > 0) {
      const nestedItems = buildTree(aiResult);
      dispatch('aiFormatResponse', {
        items: nestedItems,
      });
    } else {
      throw new Error('AI could not parse any ToC structure.');
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
  on:mouseup={handleMouseUp}
  on:touchend={handleMouseUp}
  bind:innerWidth
/>

<div class="flex flex-col gap-4 mt-3">
  <div class="h-48 relative group">
    <textarea
      placeholder={$t('toc.outline_placeholder')}
      bind:value={text}
      on:input={handleInput}
      class="w-full h-full border-2 border-black rounded-lg p-2 text-sm myfocus leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none pr-10"
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
            on:click={handleAiFormat}
            disabled={isProcessing || !text.trim()}
            class="flex items-center gap-1.5 bg-gradient-to-br from-blue-300 to-pink-600 text-white px-3 py-1.5 rounded-md shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
          >
            {#if isProcessing}
              <Loader2
                size={16}
                class="animate-spin"
              />
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

  <div class="md:-ml-12 -ml-6 group/toc-list pt-2 relative">
    {#if $tocItems.length > 0}
      <div
        class="flex items-center gap-1 sticky top-12 z-20 opacity-0 group-hover/toc-list:opacity-100 transition-all duration-300 translate-y-1 group-hover/toc-list:translate-y-0 pointer-events-none"
      >
        {#if firstItemWithChildrenId}
          <div class="-ml-2.5 -mb-8 pointer-events-auto bg-white/50 backdrop-blur-sm rounded-md shadow-sm">
            {#if hasAnyExpanded}
              <button
                on:click={collapseAll}
                class="p-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                title={$t('toc.collapse_all')}
              >
                <ChevronsDownUp size={17} font-weight={600} />
              </button>
            {:else}
              <button
                on:click={expandAll}
                class="p-1 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                title={$t('toc.expand_all')}
              >
                <ChevronsUpDown size={17} font-weight={600} />
              </button>
            {/if}
          </div>
        {/if}
      </div>

      {#if selectedCount >= 1}
        <div class="sticky top-12 z-30 mb-3 ml-12 pointer-events-none">
          <div class="pointer-events-auto flex flex-wrap items-center gap-2 bg-white/35 backdrop-blur-sm border-2 border-black/95 rounded-lg px-3 py-2">
            <span class="text-xs font-semibold text-gray-700">
              {$t('toc.batch_operations')} {$t('toc.selected_count', {values: {count: selectedCount}})}
            </span>
            <button
              on:click={clearSelection}
              class="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold border-2 border-transparent rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title={$t('toc.clear_selection')}
            >
              <X size={14} />
              {$t('toc.clear_selection')}
            </button>
            <div class="flex items-center gap-2">
              <button
                on:click={() => adjustSelectedLevels(-1)}
                title={$t('toc.promote_selected_hint')}
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
              >
                <ArrowUp size={14} />
                {$t('toc.promote_selected')}
              </button>
              <button
                on:click={() => adjustSelectedLevels(1)}
                title={$t('toc.demote_selected_hint')}
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-lime-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
              >
                <ArrowDown size={14} />
                {$t('toc.demote_selected')}
              </button>

              {#if showBatchOffsetEditor}
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    bind:value={batchOffsetInput}
                    placeholder={$t('toc.offset_placeholder')}
                    on:keydown={(e) => e.key === 'Enter' && applyBatchOffset()}
                    class="w-20 border-2 border-black rounded px-2 py-1.5 text-xs myfocus focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    on:click={applyBatchOffset}
                    title={$t('toc.apply_offset_hint')}
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-yellow-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                  >
                    <Hash size={14} />
                    {$t('toc.apply_offset')}
                  </button>
                </div>
              {:else}
                <button
                  on:click={() => {
                    showBatchOffsetEditor = true;
                    batchOffsetInput = '';
                  }}
                  title={$t('toc.offset_selected_hint')}
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-yellow-400 text-black border-2 border-black rounded-lg shadow-[1px_1px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
                >
                  <Hash size={14} />
                  {$t('toc.offset_selected')}
                </button>
              {/if}

            </div>

          </div>
        </div>
      {/if}

      {#if showNavHint}
        <div class="absolute right-0 top-0 z-50 h-6 flex justify-center pointer-events-none">
          <div
            transition:fly={{y: -10, duration: 300}}
            class="bg-black/50 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-lg pointer-events-none"
          >
            {$t('toc.nav_hint')}
          </div>
        </div>
      {/if}

      <section
        use:dndzone={{
          items: $tocItems,
          flipDurationMs,
          dragDisabled: $dragDisabled,
          dropTargetStyle: {outline: '2px dashed #000', borderRadius: '8px'},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
        class="min-h-[20px]"
      >
        {#each $tocItems as item, i (`${item.id}${item[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? `_${item[SHADOW_ITEM_MARKER_PROPERTY_NAME]}` : ''}`)}
          <div animate:flip={{duration: flipDurationMs}}>
            <TocItem
              {item}
              {flipDurationMs}
              onUpdate={updateTocItem}
              onDelete={deleteTocItem}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onSelect={handleSelectItem}
              {currentPage}
              {isPreview}
              {pageOffset}
              {insertAtPage}
              {tocPageCount}
              {selectedIds}
              on:showNavHint={handleShowNavHint}
              on:hoveritem
              on:jumpToPage={(e) => {
                dispatch('jumpToPage', e.detail);
              }}
              index={i + 1}
            />
          </div>
        {/each}
      </section>
    {/if}

    <div class="flex items-center gap-2 ml-12 mt-3 mb-4">
      <button
        on:click={addTocItem}
        class="btn font-bold bg-yellow-400 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
      >
        {$t('btn.add_chapter')}
      </button>
      <button
        on:click={() => addMultipleTocItems(5)}
        class="btn font-bold bg-gray-100 text-black border-2 border-black rounded-lg px-3 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm"
      >
        +5
      </button>
      <button
        on:click={() => addMultipleTocItems(10)}
        class="btn font-bold bg-gray-100 text-black border-2 border-black rounded-lg px-3 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm"
      >
        +10
      </button>
    </div>
  </div>
</div>
