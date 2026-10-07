<script lang="ts">
  import {fade, fly} from 'svelte/transition';
  import {X, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Download, Search} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import {createEventDispatcher} from 'svelte';
  import type {ExportableChapter} from '$lib/pdf/chapter-export';

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

  $: selectedCount = selectedChapterIds.length;
  $: hasExpandableChapters = chapters.some((chapter) => chapter.hasChildren);
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
  $: matchingIds = new Set(
    chapters
      .filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .map((c) => c.id),
  );
  $: idsToShow = new Set<string>();
  $: {
    if (searchQuery) {
      const newIdsToShow = new Set<string>();
      matchingIds.forEach((id) => {
        newIdsToShow.add(id);
        let current = chapters.find((c) => c.id === id);
        while (current?.parentId) {
          newIdsToShow.add(current.parentId);
          current = chapters.find((c) => c.id === current.parentId);
        }
      });
      idsToShow = newIdsToShow;
    }
  }

  $: {
    expandedIds;
    showSelectedOnly;
    visibleChapters = chapters.filter((chapter) => {
      if (showSelectedOnly && !selectedChapterIds.includes(chapter.id)) {
        return false;
      }
      if (searchQuery) {
        return idsToShow.has(chapter.id);
      }
      return showSelectedOnly ? true : isChapterVisible(chapter);
    });
  }

  function toggleSelection(chapterId: string) {
    if (selectedChapterIds.includes(chapterId)) {
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
    selectedChapterIds = chapters.filter((chapter) => chapter.level === 1).map((chapter) => chapter.id);
  }

  function selectLevel2Only() {
    selectedChapterIds = chapters.filter((chapter) => chapter.level === 2).map((chapter) => chapter.id);
  }

  function applySelectionAction(event: Event) {
    const control = event.currentTarget as HTMLSelectElement;
    switch (control.value) {
      case 'all': selectAll(); break;
      case 'clear': clearSelection(); break;
      case 'level1': selectLevel1Only(); break;
      case 'level2': selectLevel2Only(); break;
    }
    control.value = '';
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
</script>

{#if showChapterExportModal}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-3 sm:p-4"
    transition:fade={{duration: 150}}
    on:click={() => (showChapterExportModal = false)}
  >
    <div
      class="chapter-export-dialog flex h-[70vh] w-full max-w-2xl max-h-[90dvh] flex-col rounded-lg border-2 border-gray-300 bg-white p-4 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chapter-export-title"
      tabindex="-1"
      transition:fly={{y: 20, duration: 200}}
      on:click|stopPropagation
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 id="chapter-export-title" class="text-lg sm:text-xl font-bold">{$t('chapter_export.title')}</h2>
        <button
          type="button"
          on:click={() => (showChapterExportModal = false)}
          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black"
          aria-label={$t('chapter_export.close')}
        >
          <X size={20} />
        </button>
      </div>

      <div class="relative mb-2">
        <Search size={16} aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          bind:value={searchQuery}
          aria-label={$t('chapter_export.search_placeholder')}
          placeholder={$t('chapter_export.search_placeholder')}
          class="h-9 w-full bg-white pl-9 pr-9 text-sm placeholder:text-gray-400"
        />
        {#if searchQuery}
          <button
            type="button"
            class="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:text-black"
            on:click={() => (searchQuery = '')}
            aria-label={$t('toc.clear_search')}
          >
            <X size={16} />
          </button>
        {/if}
      </div>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <select
          class="form-select max-w-full"
          aria-label={$t('chapter_export.selection_actions')}
          on:change={applySelectionAction}
          disabled={chapters.length === 0}
        >
          <option value="" selected disabled>{$t('chapter_export.selection_actions')}</option>
          <option value="all">{$t('chapter_export.select_all')}</option>
          <option value="clear">{$t('chapter_export.clear_selection')}</option>
          {#if hasExpandableChapters}
            <option value="level1">{$t('chapter_export.select_level_1')}</option>
            <option value="level2">{$t('chapter_export.select_level_2')}</option>
          {/if}
        </select>
        {#if hasExpandableChapters}
          <button
            type="button"
            on:click={() => allExpanded ? collapseAll() : expandAll()}
            class="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs text-gray-600 hover:bg-gray-100 hover:text-black"
          >
            {#if allExpanded}
              <ChevronsDownUp size={14} />
              {$t('chapter_export.collapse_all')}
            {:else}
              <ChevronsUpDown size={14} />
              {$t('chapter_export.expand_all')}
            {/if}
          </button>
        {/if}
        <label class="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" bind:checked={showSelectedOnly} class="h-3.5 w-3.5 accent-black" />
          {$t('chapter_export.show_selected_only')}
        </label>
      </div>

      <div class="chapter-export-list min-h-0 flex-1 overflow-y-auto rounded-md border border-black p-1">
        {#if chapters.length === 0}
          <div class="px-3 py-8 text-center text-sm text-gray-500">
            {$t('chapter_export.empty')}
          </div>
        {:else if visibleChapters.length === 0}
          <div class="px-3 py-8 text-center text-sm text-gray-500">
            {$t('chapter_export.no_results')}
          </div>
        {:else}
          {#each visibleChapters as chapter (chapter.id)}
            <div
              class="chapter-export-row flex items-center gap-1 rounded px-2 py-2 hover:bg-gray-50"
              style:padding-left={8 + (chapter.level - 1) * 16 + 'px'}
            >
              {#if hasExpandableChapters}
                <button
                  type="button"
                  class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                  on:click={() => chapter.hasChildren && toggleExpanded(chapter.id)}
                  aria-label={chapter.hasChildren
                    ? (expandedIds.has(chapter.id) ? $t('chapter_export.collapse') : $t('chapter_export.expand'))
                    : $t('chapter_export.no_children')}
                  disabled={!chapter.hasChildren}
                >
                  {#if chapter.hasChildren}
                    {#if expandedIds.has(chapter.id)}
                      <ChevronDown size={14} />
                    {:else}
                      <ChevronRight size={14} />
                    {/if}
                  {/if}
                </button>
              {/if}
              <label class="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedChapterIds.includes(chapter.id)}
                  on:change={() => toggleSelection(chapter.id)}
                  class="h-4 w-4 shrink-0 accent-black"
                />
                <span class="min-w-0 flex-1 truncate text-sm text-black" title={chapter.title}>
                  {chapter.title}
                </span>
                <span class="shrink-0 whitespace-nowrap text-xs text-gray-500">
                  {$t('chapter_export.page_range', {values: {start: chapter.startPage, end: chapter.endPage}})}
                </span>
              </label>
            </div>
          {/each}
        {/if}
      </div>

      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span class="text-xs text-gray-600" aria-live="polite">
          {$t('chapter_export.selected_count', {values: {count: selectedCount}})}
        </span>
        <div class="flex min-w-0 items-center gap-2">
          <select
            class="form-select h-9 min-w-0 flex-1 sm:flex-none"
            bind:value={exportMode}
            aria-label={$t('chapter_export.export_mode')}
          >
            <option value="merge">{$t('chapter_export.mode_merge')}</option>
            <option value="separate">{$t('chapter_export.mode_separate')}</option>
          </select>
          <button
            type="button"
            on:click={() => dispatch('confirm')}
            disabled={selectedCount === 0}
            class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded border-2 border-black bg-green-500 px-3 text-sm font-bold text-black shadow-[1px_1px_0px_var(--hard-shadow-color)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
          >
            <Download size={14} />
            {$t('chapter_export.export')}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
