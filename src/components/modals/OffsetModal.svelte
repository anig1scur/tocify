<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {fade, fly} from 'svelte/transition';
  import {X} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import type {TocItem} from '$lib/pdf/service';

  export let showOffsetModal: boolean;
  export let firstTocItem: TocItem | null;
  export let offsetPreviewPageNum: number;
  export let totalPages: number;

  const dispatch = createEventDispatcher();

  function updatePage(newPage: number) {
    if (newPage > 0 && newPage <= totalPages) {
      offsetPreviewPageNum = newPage;
      dispatch('update:offsetPreviewPageNum', offsetPreviewPageNum);
    }
  }
</script>

{#if showOffsetModal && firstTocItem}
  <div
    class="fixed inset-0 bg-lime-400 flex items-center justify-center z-50 p-4"
    transition:fade={{duration: 150}}
    on:click={() => (showOffsetModal = false)}
  >
    <div
      class="bg-white rounded-lg p-6 w-[95%] md:w-[85%] max-w-5xl max-h-[90vh] overflow-y-auto border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)]"
      transition:fly={{y: 20, duration: 200}}
      on:click|stopPropagation
    >
      <div class="flex justify-between items-start mb-4">
        <h2 class="text-xl md:text-2xl font-bold">{$t('offset.title')}</h2>
        <button
          on:click={() => (showOffsetModal = false)}
          class="p-1 rounded-full text-black hover:bg-black hover:text-white transition-colors"
          aria-label="Close modal"
        >
          <X size={24} />
        </button>
      </div>
      <div class="flex flex-col md:flex-row gap-2 md:gap-6 justify-between">
        <div class="w-full md:w-[40%] flex flex-col text-base md:text-xl">
          <p class="my-4 text-gray-700">
            {$t('offset.found_prefix')}
            <strong class="text-black text-2xl md:text-3xl block my-2">{firstTocItem?.title}</strong>
            {$t('offset.found_on_prefix')}
            <strong class="text-black text-2xl md:text-3xl block my-2">
              {$t('offset.page_n', {
                values: {n: firstTocItem?.to},
              })}
            </strong>
          </p>
          <p class="mt-4 text-gray-700 text-sm">{$t('offset.instruction')}</p>
          <div class="flex gap-4 items-center my-4">
            <label
              for="physical_page_select"
              class="font-semibold">{$t('offset.physical_page_label')}</label
            >
            <div class="flex items-center gap-2">
              <button
                class="btn p-2 h-10 w-10 font-bold bg-white text-black border-2 border-black rounded-lg shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] transition-all disabled:bg-gray-200 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
                on:click={() => updatePage(offsetPreviewPageNum - 1)}
                disabled={offsetPreviewPageNum <= 1}
              >
                -
              </button>
              <input
                type="number"
                id="physical_page_select"
                bind:value={offsetPreviewPageNum}
                on:input={(e) => updatePage(parseInt(e.currentTarget.value, 10))}
                min={1}
                max={totalPages}
                class="border-2 border-black rounded px-2 py-1 w-20 h-10 text-center font-bold text-2xl [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                class="btn p-2 h-10 w-10 font-bold bg-white text-black border-2 border-black rounded-lg shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[3px] hover:translate-y-[3px] transition-all disabled:bg-gray-200 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
                on:click={() => updatePage(offsetPreviewPageNum + 1)}
                disabled={offsetPreviewPageNum >= totalPages}
              >
                +
              </button>
            </div>
          </div>
          <button
            on:click={() => dispatch('confirm')}
            class="btn mt-auto mb-1 font-bold bg-blue-400 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all w-full"
          >
            {$t('btn.yes_this_page')}
          </button>
        </div>
        <div class="w-full md:w-[50%]">
          <div class="border-2 border-black rounded-lg overflow-hidden bg-gray-50 h-[70vh]">
            <canvas
              id="offset-preview-canvas"
              class="w-96 h-full mx-auto"
            ></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
