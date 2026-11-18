<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {Minus, Plus, Check} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import type {TocItem} from '$lib/pdf/service';
  import Tooltip from '../Tooltip.svelte';
  import Modal from './Modal.svelte';
  import {isBareKey, isEditableTarget} from '$lib/utils/shortcuts';

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

  $: open = Boolean(showOffsetModal && firstTocItem);

  /** ←/→ step the candidate page; Enter accepts it. */
  function handleKeydown(e: KeyboardEvent) {
    if (!open || e.defaultPrevented || e.isComposing || !isBareKey(e)) return;
    const target = e.target instanceof Element ? e.target : null;

    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isEditableTarget(target)) {
      e.preventDefault();
      updatePage(offsetPreviewPageNum + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Enter' && !e.shiftKey && !target?.closest('button, a')) {
      e.preventDefault();
      dispatch('confirm');
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<Modal
  {open}
  on:submit={() => dispatch('confirm')}
  title={$t('offset.title')}
  closeLabel="Close"
  backdrop="lime"
  size="xl"
  on:close={() => (showOffsetModal = false)}
>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 md:flex-row md:gap-8">
    <div class="flex w-full flex-col text-base md:w-[42%] md:text-lg">
      <div class="text-gray-700">
        {$t('offset.found_prefix')}
        <strong class="my-2 block text-2xl text-black md:text-3xl">{firstTocItem?.title}</strong>
        {$t('offset.found_on_prefix')}
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <strong class="text-2xl text-black md:text-3xl">
            {$t('offset.page_n', {values: {n: firstTocItem?.to}})}
          </strong>
          <Tooltip text={$t('offset.skip_tooltip')} position="right" width="w-64">
            <button type="button" class="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-500 transition-colors hover:text-gray-700" on:click={() => dispatch('skip')}>
              {$t('btn.skip_this_item')}
            </button>
          </Tooltip>
        </div>
      </div>

      <p class="mb-3 mt-6 text-sm text-gray-700">{$t('offset.instruction')}</p>

      <div class="mb-6 flex items-center gap-4">
        <label for="physical_page_select" class="text-sm font-semibold">{$t('offset.physical_page_label')}</label>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="nb-btn w-10 bg-white px-0"
            on:click={() => updatePage(offsetPreviewPageNum - 1)}
            disabled={offsetPreviewPageNum <= 1}
            title="-1 (←)"
            aria-label="-1"
          >
            <Minus size={16} strokeWidth={2.25} />
          </button>
          <input
            type="number"
            id="physical_page_select"
            bind:value={offsetPreviewPageNum}
            on:input={(e) => updatePage(parseInt(e.currentTarget.value, 10))}
            min={1}
            max={totalPages}
            class="h-10 w-20 rounded border-2 border-black px-2 py-1 text-center text-2xl font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            class="nb-btn w-10 bg-white px-0"
            on:click={() => updatePage(offsetPreviewPageNum + 1)}
            disabled={offsetPreviewPageNum >= totalPages}
            title="+1 (→)"
            aria-label="+1"
          >
            <Plus size={16} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <button
        type="button"
        on:click={() => dispatch('confirm')}
        title="{$t('btn.yes_this_page')} (↩)"
        class="nb-btn mt-auto h-11 w-full bg-blue-400 text-base"
      >
        <Check size={18} strokeWidth={2.5} />
        {$t('btn.yes_this_page')}
      </button>
    </div>

    <div class="w-full md:w-[58%]">
      <div class="flex h-[60vh] items-center justify-center overflow-hidden rounded-lg border-2 border-black bg-gray-50 md:h-[68vh]">
        <canvas
          id="offset-preview-canvas"
          class="block max-h-full max-w-full object-contain"
        ></canvas>
      </div>
    </div>
  </div>
</Modal>
