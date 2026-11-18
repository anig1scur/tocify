<script lang="ts">
  import {slide} from 'svelte/transition';
  import {cubicOut} from 'svelte/easing';
  import {ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Search, X, FileStack} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import {createEventDispatcher} from 'svelte';
  import type {ExportableChapter} from '$lib/pdf/chapter-export';
  import {MOTION} from '$lib/utils/motion';
  import Modal from './Modal.svelte';
  import {hasMod, isEditableTarget, modKey} from '$lib/utils/shortcuts';

  export let showChapterExportModal = false;
  export let chapters: ExportableChapter[] = [];
  export let selectedChapterIds: string[] = [];
  export let exportMode: 'merge' | 'separate' = 'separate';

  const dispatch = createEventDispatcher();
  let expandedIds = new Set<string>();
  let searchQuery = '';
  let showSelectedOnly = false;
  let visibleChapters: ExportableChapter[] = [];
  let lastExpandInitKey = '';
  let wasOpen = false;
  let searchInput: HTMLInputElement;

  function confirmExport() {
    if (selectedCount > 0) dispatch('confirm');
  }

  /** ⌘A selects every chapter, / jumps to the search box. */
  function handleKeydown(e: KeyboardEvent) {
    if (!showChapterExportModal || e.defaultPrevented || e.isComposing || isEditableTarget(e.target)) return;
    if (hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else if (e.key === '/' && !hasMod(e) && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      searchInput?.focus();
    }
  }

  $: selectedCount = selectedChapterIds.length;
  $: selectedIdSet = new Set(selectedChapterIds);
  $: hasExpandableChapters = chapters.some((chapter) => chapter.hasChildren);
  $: hasLevel2 = chapters.some((chapter) => chapter.level === 2);
  $: allExpanded = hasExpandableChapters && chapters
    .filter((chapter) => chapter.hasChildren)
    .every((chapter) => expandedIds.has(chapter.id));
  $: {
    const chapterExpandKey = chapters
      .map((chapter) => `${chapter.id}:${chapter.parentId ?? 'root'}:${chapter.hasChildren ? 1 : 0}`)
      .join('|');
    const shouldInitExpandedIds =
      (showChapterExportModal && !wasOpen) || chapterExpandKey !== lastExpandInitKey;

    if (shouldInitExpandedIds) {
      expandedIds = new Set<string>();
      searchQuery = '';
      showSelectedOnly = false;
      lastExpandInitKey = chapterExpandKey;
    }
    wasOpen = showChapterExportModal;
  }
  $: normalizedQuery = searchQuery.trim().toLowerCase();
  $: matchingIds = new Set(
    chapters
      .filter((c) => c.title.toLowerCase().includes(normalizedQuery))
      .map((c) => c.id),
  );
  $: idsToShow = new Set<string>();
  $: {
    if (normalizedQuery) {
      const newIdsToShow = new Set<string>();
      matchingIds.forEach((id) => {
        newIdsToShow.add(id);
        let current = chapters.find((c) => c.id === id);
        while (current?.parentId) {
          newIdsToShow.add(current.parentId);
          current = chapters.find((c) => c.id === current?.parentId);
        }
      });
      idsToShow = newIdsToShow;
    }
  }

  $: {
    expandedIds;
    showSelectedOnly;
    visibleChapters = chapters.filter((chapter) => {
      if (showSelectedOnly && !selectedIdSet.has(chapter.id)) {
        return false;
      }
      if (normalizedQuery) {
        return idsToShow.has(chapter.id);
      }
      return showSelectedOnly ? true : isChapterVisible(chapter);
    });
  }

  // Presets light up when the current selection is exactly that preset.
  $: level1Ids = chapters.filter((chapter) => chapter.level === 1).map((chapter) => chapter.id);
  $: level2Ids = chapters.filter((chapter) => chapter.level === 2).map((chapter) => chapter.id);
  $: isAllSelected = chapters.length > 0 && selectedCount === chapters.length;
  $: isLevel1Selected = level1Ids.length > 0 && !isAllSelected && sameIds(selectedIdSet, level1Ids);
  $: isLevel2Selected = level2Ids.length > 0 && sameIds(selectedIdSet, level2Ids);

  // Pages covered by the selection, counting overlapping parent/child ranges once.
  $: selectedPageCount = (() => {
    const pages = new Set<number>();
    for (const chapter of chapters) {
      if (!selectedIdSet.has(chapter.id)) continue;
      for (let page = chapter.startPage; page <= chapter.endPage; page++) pages.add(page);
    }
    return pages.size;
  })();

  function sameIds(selection: Set<string>, ids: string[]) {
    return selection.size === ids.length && ids.every((id) => selection.has(id));
  }

  function toggleSelection(chapterId: string) {
    if (selectedIdSet.has(chapterId)) {
      selectedChapterIds = selectedChapterIds.filter((id) => id !== chapterId);
    } else {
      selectedChapterIds = [...selectedChapterIds, chapterId];
    }
  }

  function selectAll() {
    selectedChapterIds = chapters.map((chapter) => chapter.id);
  }

  function clearSelection() {
    selectedChapterIds = [];
  }

  function selectLevel1Only() {
    selectedChapterIds = [...level1Ids];
  }

  function selectLevel2Only() {
    selectedChapterIds = [...level2Ids];
  }

  function toggleExpanded(chapterId: string) {
    const nextExpandedIds = new Set(expandedIds);
    if (nextExpandedIds.has(chapterId)) {
      nextExpandedIds.delete(chapterId);
    } else {
      nextExpandedIds.add(chapterId);
    }
    expandedIds = nextExpandedIds;
  }

  function expandAll() {
    expandedIds = new Set(chapters.filter((chapter) => chapter.hasChildren).map((chapter) => chapter.id));
  }

  function collapseAll() {
    expandedIds = new Set<string>();
  }

  function isChapterVisible(chapter: ExportableChapter) {
    let currentParentId = chapter.parentId;

    while (currentParentId) {
      if (!expandedIds.has(currentParentId)) {
        return false;
      }
      currentParentId = chapters.find((item) => item.id === currentParentId)?.parentId ?? null;
    }

    return true;
  }

  function isExpanded(chapter: ExportableChapter) {
    return Boolean(normalizedQuery) || expandedIds.has(chapter.id);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<Modal
  bind:open={showChapterExportModal}
  on:submit={confirmExport}
  title={$t('chapter_export.title')}
  closeLabel={$t('chapter_export.close')}
  accent="green"
  size="md"
  heightClass="h-[min(84dvh,700px)]"
>
  <svelte:fragment slot="icon"><FileStack size={18} strokeWidth={2.25} /></svelte:fragment>

  <div class="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
    <div class="relative">
      <Search size={16} aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        bind:this={searchInput}
        bind:value={searchQuery}
        on:keydown={(e) => {
          // First Esc clears the search; the next one closes the dialog.
          if (e.key === 'Escape' && searchQuery) {
            e.preventDefault();
            searchQuery = '';
          }
        }}
        aria-label={$t('chapter_export.search_placeholder')}
        placeholder={$t('chapter_export.search_placeholder')}
        class="nb-field pl-9 pr-9"
      />
      {#if searchQuery}
        <button
          type="button"
          class="nb-icon-btn absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
          on:click={() => (searchQuery = '')}
          aria-label={$t('toc.clear_search')}
          title={$t('toc.clear_search')}
        >
          <X size={14} />
        </button>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={$t('chapter_export.selection_actions')}>
      <button type="button" class="nb-chip" aria-pressed={isAllSelected} on:click={selectAll} disabled={chapters.length === 0} title="{$t('chapter_export.select_all')} ({modKey} A)">
        {$t('chapter_export.select_all')}
      </button>
      {#if hasExpandableChapters}
        <button type="button" class="nb-chip" aria-pressed={isLevel1Selected} on:click={selectLevel1Only}>
          {$t('chapter_export.select_level_1')}
        </button>
        {#if hasLevel2}
          <button type="button" class="nb-chip" aria-pressed={isLevel2Selected} on:click={selectLevel2Only}>
            {$t('chapter_export.select_level_2')}
          </button>
        {/if}
      {/if}
      <button type="button" class="nb-chip" aria-pressed={showSelectedOnly} on:click={() => (showSelectedOnly = !showSelectedOnly)} disabled={selectedCount === 0 && !showSelectedOnly}>
        {$t('chapter_export.show_selected_only')}
      </button>

      <div class="ml-auto flex items-center gap-0.5">
        <button type="button" class="nb-ghost" on:click={clearSelection} disabled={selectedCount === 0}>
          {$t('chapter_export.clear_selection')}
        </button>
        {#if hasExpandableChapters}
          <button
            type="button"
            class="nb-icon-btn"
            on:click={() => (allExpanded ? collapseAll() : expandAll())}
            title={allExpanded ? $t('chapter_export.collapse_all') : $t('chapter_export.expand_all')}
            aria-label={allExpanded ? $t('chapter_export.collapse_all') : $t('chapter_export.expand_all')}
          >
            {#if allExpanded}
              <ChevronsDownUp size={16} />
            {:else}
              <ChevronsUpDown size={16} />
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>

  <div class="chapter-export-list min-h-0 flex-1 overflow-y-auto border-t border-[color:var(--divider)] px-2 py-2 sm:px-3">
    {#if chapters.length === 0}
      <p class="px-3 py-12 text-center text-sm text-gray-500">{$t('chapter_export.empty')}</p>
    {:else if visibleChapters.length === 0}
      <p class="px-3 py-12 text-center text-sm text-gray-500">{$t('chapter_export.no_results')}</p>
    {:else}
      {#each visibleChapters as chapter (chapter.id)}
        {@const selected = selectedIdSet.has(chapter.id)}
        <div
          class="chapter-export-row flex h-9 items-center rounded-md pr-2 transition-colors duration-100 {selected ? 'bg-yellow-100' : 'hover:bg-black/[0.04]'}"
          transition:slide={{duration: MOTION.base, easing: cubicOut}}
        >
          {#each Array(chapter.level - 1) as _}
            <span class="tree-guide" aria-hidden="true"></span>
          {/each}
          {#if hasExpandableChapters}
            <button
              type="button"
              class="grid h-7 w-6 shrink-0 place-items-center rounded text-gray-400 hover:text-gray-900 disabled:pointer-events-none"
              on:click={() => chapter.hasChildren && toggleExpanded(chapter.id)}
              aria-label={chapter.hasChildren
                ? (isExpanded(chapter) ? $t('chapter_export.collapse') : $t('chapter_export.expand'))
                : $t('chapter_export.no_children')}
              aria-expanded={chapter.hasChildren ? isExpanded(chapter) : undefined}
              disabled={!chapter.hasChildren}
              tabindex={chapter.hasChildren ? 0 : -1}
            >
              {#if chapter.hasChildren}
                <ChevronRight size={14} strokeWidth={2.25} class="transition-transform duration-150 {isExpanded(chapter) ? 'rotate-90' : ''}" />
              {/if}
            </button>
          {:else}
            <span class="w-2 shrink-0"></span>
          {/if}
          <label class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={selected}
              on:change={() => toggleSelection(chapter.id)}
              class="nb-check"
            />
            <span
              class="min-w-0 truncate text-sm {chapter.level === 1 ? 'font-medium text-black' : 'text-gray-700'}"
              title={chapter.title}
            >
              {chapter.title}
            </span>
            <span class="toc-leader" aria-hidden="true"></span>
            <span class="shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-500">
              {$t('chapter_export.page_range', {values: {start: chapter.startPage, end: chapter.endPage}})}
            </span>
          </label>
        </div>
      {/each}
    {/if}
  </div>

  <svelte:fragment slot="footer">
    <span class="mr-auto text-xs font-medium tabular-nums text-gray-600" aria-live="polite">
      {#if selectedCount > 0}
        {$t('chapter_export.selected_summary', {values: {count: selectedCount, pages: selectedPageCount}})}
      {:else}
        {$t('chapter_export.selected_count', {values: {count: 0}})}
      {/if}
    </span>

    <div class="mode-switch" role="radiogroup" aria-label={$t('chapter_export.export_mode')}>
      <span class="mode-thumb" class:is-second={exportMode === 'separate'} aria-hidden="true"></span>
      <button type="button" role="radio" aria-checked={exportMode === 'merge'} on:click={() => (exportMode = 'merge')}>
        {$t('chapter_export.mode_merge')}
      </button>
      <button type="button" role="radio" aria-checked={exportMode === 'separate'} on:click={() => (exportMode = 'separate')}>
        {$t('chapter_export.mode_separate')}
      </button>
    </div>

    <button
      type="button"
      on:click={confirmExport}
      disabled={selectedCount === 0}
      title="{$t('chapter_export.export')} ({modKey} ↩)"
      class="nb-btn bg-green-500"
    >
      <Download size={15} strokeWidth={2.25} />
      {$t('chapter_export.export')}
    </button>
  </svelte:fragment>
</Modal>

<style>
  .tree-guide {
    flex: none;
    width: 20px;
  }

  .mode-switch {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 36px;
    padding: 2px;
    border: 2px solid #000;
    border-radius: 8px;
    background: #fff;
  }

  .mode-switch button {
    position: relative;
    z-index: 1;
    padding: 0 12px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    color: #4b5563;
    transition: color 160ms ease;
  }

  .mode-switch button[aria-checked='true'] {
    color: #000;
  }

  .mode-switch button:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: -2px;
  }

  .mode-thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc(50% - 2px);
    border-radius: 5px;
    background: #facc15;
    transition: transform 220ms var(--ease-land);
  }

  .mode-thumb.is-second {
    transform: translateX(100%);
  }

  @media (max-width: 480px) {
    .mode-switch {
      width: 100%;
      order: 3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-thumb {
      transition: none;
    }
  }
</style>
