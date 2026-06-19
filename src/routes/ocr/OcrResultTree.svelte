<script lang="ts">
  import { t } from 'svelte-i18n';
  import { Search, Trash2, X } from 'lucide-svelte';

  import '../../lib/i18n';

  type OcrTreeSortMode = 'reading' | 'confidence';

  export let flatOcrLines: any[] = [];
  export let filteredOcrLines: any[] = [];
  export let ocrTreeSearch = '';
  export let ocrTreeSearchTerm = '';
  export let ocrTreeSortMode: OcrTreeSortMode = 'reading';
  export let ocrTreeScrollContainer: HTMLDivElement | null = null;
  export let isOcrBusy = false;
  export let stickySearchTop = 48;
  export let stickyPageTop = 92;
  export let selectedPageNumber = 1;
  export let selectedLineIndex = 0;
  export let autosizeTextarea: any = () => ({ destroy: () => undefined });
  export let getHighlightedTextSegments: (text: unknown, searchTerm: string) => { text: string; hit: boolean }[] = () => [];
  export let doesOcrPageMatchSearch: (item: any, searchTerm: string) => boolean = () => false;
  export let selectLine: (pageNumber: number, lineIndex: number) => void = () => undefined;
  export let deleteLine: (pageNumber: number, lineIndex: number) => void = () => undefined;
  export let updateLineText: (pageNumber: number, lineIndex: number, text: string) => void = () => undefined;
  export let setOcrTreeSortMode: (mode: OcrTreeSortMode) => void = () => undefined;

  $: groupedOcrLines = groupAdjacentOcrLinesByPage(filteredOcrLines);

  function groupAdjacentOcrLinesByPage(items: any[]) {
    const groups: { key: string; pageNumber: number; startIndex: number; items: any[] }[] = [];
    let currentGroup: { key: string; pageNumber: number; startIndex: number; items: any[] } | null = null;

    items.forEach((item, filteredIndex) => {
      const pageNumber = Number(item?.pageNumber);
      if (!Number.isFinite(pageNumber)) return;

      if (!currentGroup || currentGroup.pageNumber !== pageNumber) {
        currentGroup = {
          key: `${groups.length}:${pageNumber}`,
          pageNumber,
          startIndex: filteredIndex,
          items: [],
        };
        groups.push(currentGroup);
      }

      currentGroup.items.push(item);
    });

    return groups;
  }
</script>

{#if flatOcrLines.length}
  <div>
    <div class="sticky z-40 mb-2 pointer-events-none" style:top={`${stickySearchTop}px`}>
      <div class="pointer-events-auto bg-white/70 backdrop-blur-sm border-2 border-black rounded-lg px-2 py-1.5 flex items-center gap-2">
        <Search size={15} class="text-gray-500 shrink-0" />
        <input
          class="min-w-0 flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
          type="text"
          bind:value={ocrTreeSearch}
          placeholder={$t('ocr_lab.search_placeholder')}
          spellcheck="false"
        />
        {#if !isOcrBusy}
          <button
            type="button"
            on:click={() => setOcrTreeSortMode(ocrTreeSortMode === 'confidence' ? 'reading' : 'confidence')}
            class="shrink-0 rounded px-2 py-1 text-[11px] font-bold transition-colors {ocrTreeSortMode === 'confidence' ? 'bg-yellow-200 text-black' : 'bg-gray-100 text-gray-500 hover:text-black'}"
            title={ocrTreeSortMode === 'confidence' ? $t('ocr_lab.sort_reading_order') : $t('ocr_lab.sort_low_confidence')}
          >
            {#if ocrTreeSortMode === 'confidence'}
              {$t('ocr_lab.sort_reading_order')}
            {:else}
              {$t('ocr_lab.sort_low_confidence')}
            {/if}
          </button>
        {/if}
        {#if ocrTreeSearch}
          <button
            type="button"
            on:click={() => (ocrTreeSearch = '')}
            class="p-1 text-gray-500 hover:text-black"
            title={$t('toc.clear_search') || 'Clear search'}
          >
            <X size={14} />
          </button>
        {/if}
      </div>
    </div>

    <div bind:this={ocrTreeScrollContainer} class="relative">
      {#if groupedOcrLines.length}
        {#each groupedOcrLines as group (group.key)}
          {@const pageMatchesSearch = doesOcrPageMatchSearch({ pageNumber: group.pageNumber }, ocrTreeSearchTerm)}
          <section class="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start">
            <div class="relative self-stretch">
              <span
                class="sticky left-0 z-30 mt-1 inline-flex px-1 text-[11px] font-bold leading-none {pageMatchesSearch ? 'text-black' : 'text-gray-500'}"
                style:top={`${stickyPageTop}px`}
              >
                P{group.pageNumber}
              </span>
            </div>

            <div class="min-w-0">
              {#each group.items as item, itemIndex (Number(item.pageNumber) + ':' + Number(item.lineIndex))}
                <div
                  class="group py-1 pr-1.5"
                  data-ocr-page={item.pageNumber}
                  data-ocr-line-index={item.lineIndex}
                  role="button"
                  tabindex="0"
                  on:click={() => selectLine(item.pageNumber, item.lineIndex)}
                  on:keydown={(event: KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectLine(item.pageNumber, item.lineIndex);
                    }
                  }}
                >
                  <div class="rounded-md px-1.5 py-1 transition-colors {Number(item.pageNumber) === Number(selectedPageNumber) && item.lineIndex === selectedLineIndex ? 'bg-yellow-100/70' : 'group-hover:bg-sky-50/70'}">
                    <div class="flex items-center gap-2 text-[11px] leading-none text-gray-400">
                      <span>#{group.startIndex + itemIndex + 1}</span>
                      {#if Number.isFinite(Number(item.line.score))}
                        <span class="ml-auto font-mono">{Number(item.line.score).toFixed(3)}</span>
                      {/if}
                      <button
                        class="p-0.5 text-gray-400 hover:text-gray-700 transition-colors"
                        title={$t('ocr_lab.delete_selected_line')}
                        aria-label={$t('ocr_lab.delete_selected_line')}
                        on:click|stopPropagation={() => deleteLine(item.pageNumber, item.lineIndex)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div class="relative mt-1">
                      {#if ocrTreeSearchTerm}
                        <div class="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-0 py-0.5 text-sm leading-[1.55] text-gray-800">
                          {#each getHighlightedTextSegments(item.line.text, ocrTreeSearchTerm) as segment}
                            {#if segment.hit}
                              <mark class="rounded bg-yellow-200/90 px-0.5 text-gray-900">{segment.text}</mark>
                            {:else}
                              {segment.text}
                            {/if}
                          {/each}
                        </div>
                      {/if}
                      <textarea
                        use:autosizeTextarea={item.line.text}
                        rows="1"
                        class="relative block w-full resize-none overflow-hidden border-0 border-transparent bg-transparent px-0 py-0.5 text-sm leading-[1.55] focus:border-slate-300 focus:outline-none {ocrTreeSearchTerm ? 'text-transparent caret-gray-800 selection:bg-sky-200 focus:bg-transparent' : 'text-gray-800 focus:bg-white/40'}"
                        value={item.line.text}
                        spellcheck="false"
                        on:focus={() => selectLine(item.pageNumber, item.lineIndex)}
                        on:click|stopPropagation={() => selectLine(item.pageNumber, item.lineIndex)}
                        on:input={(event: Event) => updateLineText(item.pageNumber, item.lineIndex, (event.currentTarget as HTMLTextAreaElement).value)}
                      ></textarea>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      {:else}
        <div class="text-sm text-gray-500">{$t('ocr_lab.search_no_results')}</div>
      {/if}
    </div>
  </div>
{/if}
