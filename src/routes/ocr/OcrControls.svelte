<script lang="ts">
  import { t } from 'svelte-i18n';
  import { Loader2, X } from 'lucide-svelte';

  import '../../lib/i18n';
  import Tooltip from '../../components/Tooltip.svelte';

  type OcrResolutionQuality = 'low' | 'standard' | 'high' | 'ultra';
  type OcrProgressPhase = 'initializing' | 'rendering' | 'recognizing' | 'postprocessing';
  type OcrProgress = {
    phase: OcrProgressPhase;
    current: number;
    total: number;
  };

  export let pdfPageCount = 1;
  export let hasPdf = false;
  export let pageStart = 1;
  export let pageEnd = 1;
  export let workerPoolSize = 4;
  export let resolutionQuality: OcrResolutionQuality = 'standard';
  export let boxExtension = 2.0;
  export let minWorkerPoolSize = 1;
  export let maxWorkerPoolSize = 4;
  export let minBoxExtension = 1.0;
  export let maxBoxExtension = 3.0;
  export let boxExtensionStep = 0.1;
  export let isFileLoading = false;
  export let isBuilding = false;
  export let isInitializing = false;
  export let isRunning = false;
  export let isCancelling = false;
  export let ocrProgress: OcrProgress | null = null;
  export let ocrProgressPercent = 0;
  export let onPageRangeChange: (options: { start?: unknown; end?: unknown }) => void = () => undefined;
  export let onRuntimeSettingChange: (options: { workerPoolSize?: unknown; resolutionQuality?: unknown; boxExtension?: unknown }) => void = () => undefined;
  export let onRun: () => void = () => undefined;
  export let onCancel: () => void = () => undefined;

  $: isBusy = isInitializing || isRunning || isCancelling;
  $: isRunDisabled = !hasPdf || isFileLoading || isBusy || isBuilding;

  const fieldControlClass = 'mt-1 box-border h-11 w-full rounded-lg border-2 border-black bg-white px-3 py-0 text-base leading-none outline-none disabled:bg-gray-100 disabled:text-gray-500';
  const fieldLabelClass = 'flex items-center gap-1 text-xs uppercase tracking-wide text-gray-500';
</script>

<div class="border-black border-2 rounded-lg p-3 shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-white">
  <div class="grid gap-3">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="block min-w-0">
        <span class={fieldLabelClass}>
          {$t('ocr_lab.start_page')}
        </span>
        <input
          class={fieldControlClass}
          type="number"
          min="1"
          max={pdfPageCount}
          value={pageStart}
          on:change={(event) =>
            onPageRangeChange({
              start: (event.currentTarget as HTMLInputElement).value,
            })}
          disabled={!hasPdf || isBusy}
        />
      </label>

      <label class="block min-w-0">
        <span class={fieldLabelClass}>
          {$t('ocr_lab.end_page')}
        </span>
        <input
          class={fieldControlClass}
          type="number"
          min="1"
          max={pdfPageCount}
          value={pageEnd}
          on:change={(event) =>
            onPageRangeChange({
              end: (event.currentTarget as HTMLInputElement).value,
            })}
          disabled={!hasPdf || isBusy}
        />
      </label>

      <label class="block min-w-0">
        <span class={fieldLabelClass}>
          {$t('ocr_lab.worker_count')}
          <Tooltip text={$t('ocr_lab.worker_count_hint')} width="w-64" position="right">
            <span class="mb-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-gray-300 text-[8px] normal-case leading-none text-gray-500">i</span>
          </Tooltip>
        </span>
        <input
          class={fieldControlClass}
          type="number"
          min={minWorkerPoolSize}
          max={maxWorkerPoolSize}
          value={workerPoolSize}
          on:input={(event) =>
            onRuntimeSettingChange({
              workerPoolSize: (event.currentTarget as HTMLInputElement).value,
            })}
          disabled={isBusy}
        />
      </label>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="block min-w-0">
        <span class={fieldLabelClass}>
          {$t('ocr_lab.resolution_quality')}
          <Tooltip text={$t('ocr_lab.resolution_quality_hint')} width="w-64" position="right">
            <span class="mb-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-gray-300 text-[8px] normal-case leading-none text-gray-500">i</span>
          </Tooltip>
        </span>
        <select
          class={fieldControlClass}
          value={resolutionQuality}
          on:input={(event) =>
            onRuntimeSettingChange({
              resolutionQuality: (event.currentTarget as HTMLSelectElement).value,
            })}
          disabled={isBusy}
        >
          <option value="low">{$t('ocr_lab.resolution_low')}</option>
          <option value="standard">{$t('ocr_lab.resolution_standard')}</option>
          <option value="high">{$t('ocr_lab.resolution_high')}</option>
          <option value="ultra">{$t('ocr_lab.resolution_ultra')}</option>
        </select>
      </label>

      <label class="block min-w-0">
        <span class={fieldLabelClass}>
          {$t('ocr_lab.box_extension')}
          <Tooltip text={$t('ocr_lab.box_extension_hint')} width="w-64" position="right">
            <span class="mb-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-gray-300 text-[8px] normal-case leading-none text-gray-500">i</span>
          </Tooltip>
        </span>
        <input
          class={fieldControlClass}
          type="number"
          min={minBoxExtension}
          max={maxBoxExtension}
          step={boxExtensionStep}
          value={boxExtension}
          on:change={(event) =>
            onRuntimeSettingChange({
              boxExtension: (event.currentTarget as HTMLInputElement).value,
            })}
          disabled={isBusy}
        />
      </label>
    </div>
  </div>
  <p class="mt-6 text-center text-xs text-gray-400">{$t('ocr_lab.engine_note')}</p>
</div>

<div class="relative my-2">
  <button
    type="button"
    class="btn w-full font-bold transition-all duration-300 text-black border-2 border-black rounded-lg px-3 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 {isBusy ? 'pr-12' : ''} {(isRunning || isInitializing || isCancelling || !isRunDisabled) ? 'bg-blue-400' : 'bg-gray-300'}"
    on:click={onRun}
    disabled={isRunDisabled}
  >
    <span class="block text-center">
      {#if isCancelling}
        {$t('ocr_lab.local_canceling_button')}
      {:else if isInitializing}
        {$t('ocr_lab.local_loading_button')}
      {:else if isRunning}
        {$t('ocr_lab.local_running_button')}
      {:else}
        {$t('ocr_lab.run_local')}
      {/if}
    </span>
    {#if ocrProgress}
      <span class="mt-2 flex items-center gap-2">
        <span class="block h-2 flex-1 overflow-hidden rounded-full border border-black bg-black/10">
          <span class="block h-full bg-white transition-all duration-300" style:width={`${ocrProgressPercent}%`}></span>
        </span>
        <span class="min-w-[56px] text-right font-mono text-xs">{ocrProgress.current}/{ocrProgress.total}</span>
      </span>
    {/if}
  </button>

  {#if isInitializing || isRunning || isCancelling}
    <button
      type="button"
      class="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded text-black/75 transition-colors hover:bg-black/10 hover:text-black disabled:text-black/40"
      on:click={onCancel}
      disabled={isCancelling}
      title={isCancelling ? $t('ocr_lab.local_canceling_button') : $t('ocr_lab.cancel_ocr')}
      aria-label={isCancelling ? $t('ocr_lab.local_canceling_button') : $t('ocr_lab.cancel_ocr')}
    >
      {#if isCancelling}
        <Loader2 size={17} class="animate-spin" />
      {:else}
        <X size={16} strokeWidth={2.5} />
      {/if}
    </button>
  {/if}
</div>
