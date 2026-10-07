<script lang="ts">
  import {fade} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {createEventDispatcher} from 'svelte';

  import Header from '../Header.svelte';
  import ApiSetting from '../settings/ApiSetting.svelte';
  import TocSettings from '../settings/TocSetting.svelte';
  import AiPageSelector from '../PageSelector.svelte';
  import TocEditor from '../TocEditor.svelte';
  import {Sparkles} from 'lucide-svelte';
  import {curFileFingerprint} from '../../stores';

  export let pdfState: any;
  export let originalPdfInstance: any;
  export let tocPdfInstance: any;
  export let isAiLoading = false;
  export let aiError: string | null = null;

  export let tocRanges: {start: number; end: number; id: string}[];
  export let activeRangeIndex: number;
  export let addPhysicalTocPage: boolean;
  export let isTocConfigExpanded: boolean;

  export let config: any;
  export let customApiConfig: any;
  export let tocPageCount: number;
  export let isPreviewMode: boolean;

  const dispatch = createEventDispatcher();
  export let tocEditor: any = undefined;
</script>

<div class="w-full lg:w-[35%] flex-shrink-0">
  <Header activePage="toc" on:openhelp={() => dispatch('openhelp')} />

  <ApiSetting
    on:change={(e) => dispatch('apiConfigChange', e.detail)}
    on:save={() => dispatch('apiConfigSave')}
  />

  <TocSettings
    {config}
    {tocPdfInstance}
    {tocRanges}
    totalPages={pdfState.totalPages}
    bind:isTocConfigExpanded
    bind:addPhysicalTocPage
    on:toggleExpand={() => (isTocConfigExpanded = !isTocConfigExpanded)}
    on:updateField={(e) => dispatch('updateField', e.detail)}
    on:jumpToTocPage={() => dispatch('jumpToTocPage')}
    on:jumpToPage={(e) => dispatch('jumpToPage', e.detail)}
  />

  {#if originalPdfInstance}
    <div transition:fade={{duration: 200}}>
      <AiPageSelector
        bind:tocRanges
        bind:activeRangeIndex
        totalPages={pdfState.totalPages}
        on:addRange
        on:removeRange
        on:setActiveRange
        on:rangeChange={() => dispatch('rangeChange')}
      />
    </div>
  {/if}

  <button
    class="btn w-full my-2 font-bold bg-blue-400 transition-all duration-300 text-black border-2 border-black rounded-lg px-3 py-2 shadow-[2px_2px_0px_var(--hard-shadow-color)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] disabled:bg-gray-300 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
    on:click={() => dispatch('generateAi')}
    title={isAiLoading
      ? $t('status.generating')
      : !originalPdfInstance
        ? $t('status.load_pdf_first')
        : $t('tooltip.generate_ai')}
    disabled={isAiLoading || !originalPdfInstance}
  >
    {#if isAiLoading}
      <span>{$t('btn.generating')}</span>
    {:else}
      <span>
        <Sparkles
          size={16}
          class="inline-block mr-1"
        />
        {$t('btn.generate_toc_ai')}</span
      >
    {/if}
  </button>

  {#if aiError}
    <div class="my-2 p-3 bg-red-100 border-2 border-red-700 text-red-700 rounded-lg whitespace-pre-line">
      {aiError}
    </div>
  {/if}

  {#key $curFileFingerprint}
    <TocEditor
      on:hoveritem
      on:jumpToPage={(e) => dispatch('jumpToPage', e.detail)}
      on:aiFormatResponse
      bind:this={tocEditor}
      currentPage={pdfState.currentPage}
      isPreview={isPreviewMode}
      pageOffset={config.pageOffset}
      insertAtPage={config.insertAtPage}
      apiConfig={customApiConfig}
      {tocPageCount}
    />
  {/key}
</div>
