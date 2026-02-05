<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageLabelSettings, PageLabelStyle } from '$lib/page-labels';
  import {Trash2} from 'lucide-svelte';

  export let settings: PageLabelSettings;

  const dispatch = createEventDispatcher();

  const styles: { value: PageLabelStyle; label: string }[] = [
    { value: 'decimal', label: '1, 2, 3' },
    { value: 'roman_lower', label: 'i, ii, iii' },
    { value: 'roman_upper', label: 'I, II, III' },
    { value: 'alpha_lower', label: 'a, b, c' },
    { value: 'alpha_upper', label: 'A, B, C' },
    { value: 'none', label: '(prefix only)' },
  ];

  function emitSegments(segments: PageLabelSettings['segments']) {
    dispatch('change', { ...settings, segments });
  }

  function addSegment() {
    const next = [
      ...(settings.segments || []),
      { startPage: 1, style: 'decimal', prefix: '', startAt: 1 },
    ];
    emitSegments(next);
  }

  function removeSegment(index: number) {
    const next = (settings.segments || []).filter((_, i) => i !== index);
    emitSegments(next);
  }

  function updateSegment(index: number, patch: Partial<PageLabelSettings['segments'][number]>) {
    const next = (settings.segments || []).map((seg, i) => (i === index ? { ...seg, ...patch } : seg));
    emitSegments(next);
  }
</script>

<div class="space-y-3">
  <div class="text-xs text-gray-500">
    {$t('settings.page_labels_hint')}
  </div>

  {#each settings.segments || [] as seg, i (i)}
    <div class="border-2 border-black rounded-md p-2 bg-white shadow-[2px_2px_0px_rgba(0,0,0,0.08)]">
      <div class="flex justify-between items-center">
        <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">{$t('label.segment_range_n', {values: {n: i + 1}})}</span>
        <button class="text-red-500 p-1 hover:bg-blue-100 rounded"
          on:click={() => removeSegment(i)}
          title={$t('settings.remove')}
          disabled={(settings.segments || []).length <= 1}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-20">
          <label class="text-[11px] text-gray-500 block">{$t('settings.start_page')}</label>
          <input
            type="number"
            min="1"
            class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 focus:outline-none focus:bg-gray-50"
            value={seg.startPage}
            on:input={(e) =>
              updateSegment(i, { startPage: parseInt((e.target as HTMLInputElement).value, 10) || 1 })}
          />
        </div>

        <div class="flex-1 min-w-[120px]">
          <label class="text-[11px] text-gray-500 block">{$t('settings.style')}</label>
          <select
            class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 bg-transparent focus:outline-none focus:ring-2 focus:ring-black/20"
            value={seg.style}
            on:change={(e) =>
              updateSegment(i, { style: (e.target as HTMLSelectElement).value as PageLabelStyle })}
          >
            {#each styles as s}
              <option value={s.value}>{s.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex items-center gap-2 mt-2">
        <div class="flex-1 min-w-[120px]">
          <label class="text-[11px] text-gray-500 block">{$t('settings.prefix')}</label>
          <input
            type="text"
            class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 focus:outline-none focus:bg-gray-50"
            placeholder="e.g. A-"
            value={seg.prefix}
            on:input={(e) => updateSegment(i, { prefix: (e.target as HTMLInputElement).value })}
          />
        </div>

        <div class="w-20">
          <label class="text-[11px] text-gray-500 block">{$t('settings.start_at')}</label>
          <input
            type="number"
            min="1"
            class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 focus:outline-none focus:bg-gray-50"
            value={seg.startAt}
            on:input={(e) =>
              updateSegment(i, { startAt: parseInt((e.target as HTMLInputElement).value, 10) || 1 })}
            disabled={seg.style === 'none'}
          />
        </div>
      </div>

    </div>
  {/each}

  <button
    class="w-full h-9 border-2 border-black rounded-md bg-white hover:bg-gray-50 text-base font-bold leading-none"
    on:click={addSegment}
    title={$t('settings.add_segment')}
    aria-label={$t('settings.add_segment')}
  >
    +
  </button>
</div>
