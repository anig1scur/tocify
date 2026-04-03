<script lang="ts">
  import {fade} from 'svelte/transition';
  import {t} from 'svelte-i18n';

  export let isAiLoading: boolean;
  export let tocRanges: {start: number; end: number}[];
  export let aiProgress: {current: number; total: number} | null = null;
</script>

{#if isAiLoading}
  <div
    class="fixed inset-0 flex flex-col items-center justify-center z-50 bg-yellow-400"
    transition:fade={{duration: 200}}
  >
    <div
      class="bg-white p-8 sm:p-12 border-4 border-black rounded-lg shadow-[8px_8px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-6 w-11/12 max-w-md"
    >
      <div class="text-xl text-center font-bold text-black">
        <span>
          {$t('loading.extracting_pages', {
            values: {
              ranges: tocRanges
                .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
                .join(', '),
            }
          })}
        </span>
        <br />
        <br />
        <span>{$t('loading.take_minutes')}</span>
      </div>
      <div class="animate-spin rounded-full h-12 w-12 border-4 border-black border-t-transparent"></div>

      {#if aiProgress && aiProgress.total > 1}
        <div class="flex flex-col items-center gap-1 w-full">
          <div class="text-sm font-mono font-bold text-gray-700">
            {$t('loading.progress', { values: { current: aiProgress.current, total: aiProgress.total } })}
          </div>
          <div class="w-full h-2 bg-gray-200 rounded-full overflow-hidden border border-gray-300">
            <div
              class="h-full bg-black rounded-full transition-all duration-300"
              style="width: {Math.round((aiProgress.current / aiProgress.total) * 100)}%"
            ></div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
