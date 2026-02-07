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
</div>
