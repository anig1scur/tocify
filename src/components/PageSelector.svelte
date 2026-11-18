<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {Trash2, Plus} from 'lucide-svelte';
  import {t} from 'svelte-i18n';

  export let tocRanges: {start: number; end: number; id: string}[] = [];
  export let activeRangeIndex: number = 0;
  export let totalPages: number;

  const dispatch = createEventDispatcher();

  function addRange() {
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
</script>

<div class="border-black border-2 rounded-lg p-3 my-4 bg-blue-100 shadow-[2px_2px_0px_var(--hard-shadow-color)]">
  <div class="flex justify-between items-center mb-2">
    <h3 class="font-bold">{$t('label.toc_pages_selection')}</h3>
    <button
      type="button"
      on:click={addRange}
      class="p-1 rounded-md hover:bg-black/10 transition-colors"
      title="Add another range"
      aria-label="Add another range"
    >
      <Plus size={18} />
    </button>
  </div>

  <div class="flex flex-col gap-1.5">
    {#each tocRanges as range, i (range.id)}
      <div
        class="flex items-center gap-2 rounded border-2 px-2 py-1.5 transition-all {i === activeRangeIndex
          ? 'border-blue-500 bg-white/50'
          : 'cursor-pointer border-transparent hover:bg-black/[0.03]'}"
        on:click={() => setActiveRange(i)}
        role="presentation"
      >
        <span class="w-14 shrink-0 truncate text-xs font-bold text-gray-500">
          {$t('label.range_n', {values: {n: i + 1}})}
        </span>
        <input
          type="number"
          id={`start-${range.id}`}
          bind:value={range.start}
          on:input={handleRangeChange}
          min={1}
          max={totalPages}
          aria-label={$t('label.start')}
          title={$t('label.start')}
          class="h-8 w-full min-w-0 rounded px-2 text-sm"
        />
        <span class="shrink-0 text-gray-500" aria-hidden="true">–</span>
        <input
          type="number"
          id={`end-${range.id}`}
          bind:value={range.end}
          on:input={handleRangeChange}
          min={range.start}
          max={totalPages}
          aria-label={$t('label.end')}
          title={$t('label.end')}
          class="h-8 w-full min-w-0 rounded px-2 text-sm"
        />
        {#if tocRanges.length > 1}
          <button
            type="button"
            on:click|stopPropagation={() => removeRange(i)}
            class="text-blue-600 p-1 hover:bg-blue-100 rounded"
            aria-label="Remove range"
            title="Remove range"
          >
            <Trash2 size={14} />
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>
