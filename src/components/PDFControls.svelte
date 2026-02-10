<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {Upload, PencilIcon, EyeIcon, Download} from 'lucide-svelte';
  import {fly, fade} from 'svelte/transition';
  import { t } from 'svelte-i18n';

  export let isPreviewLoading: boolean;
  export let isPreviewMode: boolean;
  export let originalPdfInstance: any;
  export let doc: any;

  const dispatch = createEventDispatcher();
</script>

<div class="flex flex-col md:flex-row md:justify-end gap-3 md:gap-2 pt-4 relative z-10 mx-3 md:mr-3 md:mx-0">
  <button
    class="btn flex gap-2 items-center justify-center font-bold bg-white text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 w-full md:w-auto"
    on:click={() => dispatch('triggerUpload')}
    title={$t('tooltip.upload_new')}
    in:fly={{y: 10, duration: 250, delay: 0}}
  >
    <Upload size={16} />
    {$t('btn.upload_new')}
  </button>
  <button
    class="btn flex gap-2 items-center justify-center font-bold bg-yellow-400 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 w-full md:w-auto"
    on:click={() => dispatch('togglePreview')}
    disabled={!originalPdfInstance || isPreviewLoading}
    title={isPreviewMode
      ? $t('tooltip.switch_edit')
      : $t('tooltip.switch_preview')}
    in:fly={{y: 10, duration: 250, delay: 100}}
  >
    {#key isPreviewLoading.toString() + isPreviewMode.toString()}
      <div
        class="flex gap-2 items-center justify-center"
        in:fade={{duration: 150}}
      >
        {#if isPreviewLoading}
          <div class="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
          {$t('btn.loading')}
        {:else if isPreviewMode}
          <PencilIcon size={16} />
          {$t('btn.select_grid')}
        {:else}
          <EyeIcon size={16} />
          {$t('btn.preview')}
        {/if}
      </div>
    {/key}
  </button>
  <button
    class="btn flex gap-2 items-center justify-center font-bold bg-green-500 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 w-full md:w-auto"
    on:click={() => dispatch('export')}
    disabled={!doc}
    in:fly={{y: 10, duration: 250, delay: 200}}
  >
    <Download size={16} />
    {$t('btn.generate_pdf')}
  </button>
</div>
