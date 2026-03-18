<script lang="ts">
  import {Upload} from 'lucide-svelte';
  import {t} from 'svelte-i18n';

  export let isDragging: boolean;
  export let hasInstance: boolean;
</script>

<div
  class="w-full h-full rounded-lg select-none text-center cursor-pointer transition-colors duration-200
  {hasInstance ? 'pointer-events-none' : ''} "
  class:pointer-events-auto={isDragging}
  class:bg-blue-200={isDragging}
  class:bg-opacity-80={isDragging}
>
  {#if !hasInstance || isDragging}
    <div class="absolute text-stone-500 inset-0 flex flex-col items-center justify-center p-4">
      {#if isDragging}
        <p class="text-2xl font-bold">{$t('dropzone.drop_here')}</p>
      {:else}
        <Upload
          size={64}
          class="mb-4 text-blue-500"
        />
        <h3 class="text-2xl font-bold text-black mb-5">{$t('dropzone.title')}</h3>
        <p class="text-lg">{$t('dropzone.subtitle')}</p>
        <button
          class="btn mt-4 font-bold bg-blue-400 text-black border-2 border-black rounded-lg px-6 py-3 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
        >
          {$t('dropzone.btn_select')}
        </button>
      {/if}
    </div>
  {/if}
</div>
