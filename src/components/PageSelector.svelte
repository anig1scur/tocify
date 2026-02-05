<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {Trash2, Plus} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import { createDefaultPageLabelSettings, type PageLabelSegment, type PageLabelSettings } from '$lib/page-labels';
  import PageLabelSetting from './settings/PageLabelSetting.svelte';

  export let tocRanges: {start: number; end: number; id: string}[] = [];
  export let activeRangeIndex: number = 0;
  export let totalPages: number;
  export let pageLabelSettings: PageLabelSettings = createDefaultPageLabelSettings();

  const dispatch = createEventDispatcher();
  let isPageLabelSettingExpanded = false;
  let pageLabelsDisabled = false;
  $: pageLabelsDisabled = tocRanges.length > 1;
  $: isPageLabelSettingExpanded = !!pageLabelSettings?.enabled && !pageLabelsDisabled;

  function addRange() {
    if (tocRanges.length >= 1 && pageLabelSettings?.enabled) {
      dispatch('updateField', {
        path: 'pageLabelSettings',
        value: { ...pageLabelSettings, enabled: false },
      });
    }
    dispatch('addRange');
  }

  function removeRange(index: number) {
    dispatch('removeRange', {index});
  }

  function setActiveRange(index: number) {
    dispatch('setActiveRange', {index});
  }

  function handleRangeChange() {
    dispatch('rangeChange');
  }

  function handlePageLabelChange(e: CustomEvent) {
    dispatch('updateField', { path: 'pageLabelSettings', value: e.detail });
  }

  function handlePageLabelsToggle(e: Event) {
    if (pageLabelsDisabled) return;
    const enabled = (e.target as HTMLInputElement).checked;
    if (enabled) {
      const segments = isDefaultPageLabelSegments(pageLabelSettings?.segments)
        ? buildPageLabelSegmentsFromTocRanges(tocRanges, totalPages)
        : (pageLabelSettings?.segments || []);
      dispatch('updateField', {
        path: 'pageLabelSettings',
        value: { ...pageLabelSettings, enabled: true, segments },
      });
    } else {
      dispatch('updateField', { path: 'pageLabelSettings', value: { ...pageLabelSettings, enabled: false } });
    }
  }

  function isDefaultPageLabelSegments(segments: PageLabelSegment[] | undefined): boolean {
    if (!segments || segments.length === 0) return true;
    if (segments.length !== 1) return false;
    const s = segments[0];
    return (
      s.startPage === 1 &&
      s.style === 'decimal' &&
      (s.prefix ?? '') === '' &&
      (s.startAt ?? 1) === 1
    );
  }

  function buildPageLabelSegmentsFromTocRanges(
    ranges: { start: number; end: number }[],
    total: number
  ): PageLabelSegment[] {
    if (!Array.isArray(ranges) || ranges.length === 0 || !Number.isFinite(total) || total <= 0) {
      return [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }];
    }

    let minSel = Infinity;
    let maxSel = -Infinity;
    for (const r of ranges) {
      const a = Number(r.start);
      const b = Number(r.end);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      minSel = Math.min(minSel, start);
      maxSel = Math.max(maxSel, end);
    }

    if (!Number.isFinite(minSel) || !Number.isFinite(maxSel)) {
      return [{ startPage: 1, style: 'decimal', prefix: '', startAt: 1 }];
    }

    const tocStart = Math.max(1, Math.min(total, Math.trunc(minSel)));
    const tocEnd = Math.max(tocStart, Math.min(total, Math.trunc(maxSel)));

    const segments: PageLabelSegment[] = [];

    if (tocStart > 1) {
      segments.push({ startPage: 1, style: 'alpha_upper', prefix: '', startAt: 1 });
    }

    segments.push({ startPage: tocStart, style: 'roman_lower', prefix: '', startAt: 1 });

    if (tocEnd < total) {
      segments.push({ startPage: tocEnd + 1, style: 'decimal', prefix: '', startAt: 1 });
    }

    return segments;
  }
</script>

<div class="border-black border-2 rounded-lg p-3 my-4 bg-blue-100 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
  <div class="flex justify-between items-center mb-2">
    <h3 class="font-bold">{$t('label.toc_pages_selection')}</h3>
    <button
      on:click={addRange}
      class="p-1 rounded-md hover:bg-black/10 transition-colors"
      title="Add another range"
    >
      <Plus size={18} />
    </button>
  </div>

  <div class="flex flex-col gap-3">
    {#each tocRanges as range, i (range.id)}
      <div
        class="flex flex-col gap-2 p-2 rounded border-2 transition-all cursor-pointer {i ===
        activeRangeIndex
          ? 'border-blue-500 bg-white/50'
          : 'border-transparent hover:bg-black/[0.03]'}"
        on:click={() => setActiveRange(i)}
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-gray-500 uppercase tracking-wider"
            >{$t('label.range_n', {values: {n: i + 1}})}</span
          >
          {#if tocRanges.length > 1}
            <button
              on:click|stopPropagation={() => removeRange(i)}
              class="text-blue-600 p-1 hover:bg-blue-100 rounded"
            >
              <Trash2 size={14} />
            </button>
          {/if}
        </div>

        <div class="flex gap-2 items-center">
          <div class="flex flex-col gap-1 flex-1">
            <label
              for={`start-${range.id}`}
              class="text-xs font-bold text-gray-600">{$t('label.start')}</label
            >
            <input
              type="number"
              id={`start-${range.id}`}
              bind:value={range.start}
              on:input={handleRangeChange}
              min={1}
              max={totalPages}
              class="border-2 border-black rounded px-2 py-1 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div class="flex flex-col gap-1 flex-1">
            <label
              for={`end-${range.id}`}
              class="text-xs font-bold text-gray-600">{$t('label.end')}</label
            >
            <input
              type="number"
              id={`end-${range.id}`}
              bind:value={range.end}
              on:input={handleRangeChange}
              min={range.start}
              max={totalPages}
              class="border-2 border-black rounded px-2 py-1 w-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
    {/each}
  </div>

  <div class="mt-3 pt-3 border-t-2 border-black/20">
    <div class="flex justify-between items-center">
      <h3 class="font-bold text-sm">{$t('settings.page_labels')}</h3>
      <label
        class="relative inline-flex items-center cursor-pointer"
        class:opacity-50={pageLabelsDisabled}
      >
        <input
          type="checkbox"
          class="sr-only peer"
          checked={isPageLabelSettingExpanded}
          on:change={handlePageLabelsToggle}
          aria-label={$t('settings.toggle_expand')}
          title={pageLabelsDisabled ? $t('settings.page_labels_disabled_multi_range') : $t('settings.toggle_expand')}
          disabled={pageLabelsDisabled}
        />
        <div
          class="w-11 h-6 bg-gray-200 peer-focus:outline-none border-2 border-black rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-black after:border-2 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-800"
        ></div>
      </label>
    </div>

    {#if isPageLabelSettingExpanded}
      <div class="mt-2 border-2 border-black rounded-md p-2 bg-white/60">
        <PageLabelSetting
          settings={pageLabelSettings}
          on:change={handlePageLabelChange}
        />
      </div>
    {/if}
  </div>
</div>
