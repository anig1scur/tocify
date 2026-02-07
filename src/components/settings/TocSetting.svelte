<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {slide} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import type {TocConfig} from '../../stores';
  import PageLabelSetting from './PageLabelSetting.svelte';
  import { isDefaultPageLabelSegments, suggestPageLabelSegmentsFromTocRanges } from '$lib/page-labels';
  import { HelpCircle } from 'lucide-svelte';

  import PrefixSettings from './PrefixSetting.svelte';

  export let isTocConfigExpanded: boolean;
  export let addPhysicalTocPage: boolean;
  export let config: TocConfig;
  export let previewPdfInstance: any;
  export let tocRanges: {start: number; end: number; id: string}[] = [];
  export let totalPages: number = 0;

  const dispatch = createEventDispatcher();

  let pageLabelsDisabled = false;
  $: pageLabelsDisabled = (tocRanges?.length ?? 0) > 1;

  function updateField(path: string, value: any) {
    dispatch('updateField', {path, value});
  }

  function handlePrefixChange(e: CustomEvent) {
    updateField('prefixSettings', e.detail);
  }

  $: if (pageLabelsDisabled && config?.pageLabelSettings?.enabled) {
    updateField('pageLabelSettings', { ...config.pageLabelSettings, enabled: false });
  }

  function handlePageLabelChange(e: CustomEvent) {
    updateField('pageLabelSettings', e.detail);
  }

  let lastSuggestedSegmentsJson = '';
  $: {
    const segments = suggestPageLabelSegmentsFromTocRanges(tocRanges, totalPages);
    const segmentsJson = JSON.stringify(segments);
    const currentSegments = config.pageLabelSettings?.segments;
    const currentSegmentsJson = JSON.stringify(currentSegments);

    const isDefault = isDefaultPageLabelSegments(currentSegments);
    const isMatchingLastAuto = currentSegmentsJson === lastSuggestedSegmentsJson;

    if (config?.pageLabelSettings?.enabled && (isDefault || isMatchingLastAuto)) {
      if (segmentsJson !== currentSegmentsJson) {
        updateField('pageLabelSettings', { ...config.pageLabelSettings, segments });
        lastSuggestedSegmentsJson = segmentsJson;
      }
    }
  }

  function handlePageLabelsToggle(e: Event) {
    if (pageLabelsDisabled) return;

    const enabled = (e.target as HTMLInputElement).checked;
    const current = config.pageLabelSettings;

    if (enabled) {
      const segments = isDefaultPageLabelSegments(current?.segments)
        ? suggestPageLabelSegmentsFromTocRanges(tocRanges, totalPages)
        : (current?.segments || []);

      if (isDefaultPageLabelSegments(current?.segments)) {
        lastSuggestedSegmentsJson = JSON.stringify(segments);
      }

      updateField('pageLabelSettings', { ...current, enabled: true, segments });
    } else {
      updateField('pageLabelSettings', { ...current, enabled: false });
    }
  }
</script>

<div class="border-black border-2 rounded-lg p-2 my-4 shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-white">
  <div class="flex justify-between items-center">
    <h2>{$t('settings.title')}</h2>
    <button
      class="w-6 h-6 flex items-center justify-center transition-transform duration-200"
      on:click={() => dispatch('toggleExpand')}
      aria-label={$t('settings.toggle_expand')}
      class:rotate-180={isTocConfigExpanded}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
      >
    </button>
  </div>

  {#if isTocConfigExpanded}
    <div transition:slide={{duration: 200}}>
      <div class="border-gray-600 border-2 rounded-md my-2 p-2 w-full">
        <div class="flex gap-2 items-center">
          <label
            class="whitespace-nowrap text-sm"
            for="page_offset">{$t('settings.page_offset')}</label
          >
          <input
            type="number"
            id="page_offset"
            value={config.pageOffset}
            on:input={(e) => updateField('pageOffset', parseInt(e.target.value, 10) || 0)}
            class="w-20 border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50 transition-colors"
          />
        </div>
        <div class="text-xs text-gray-500 mt-1">{$t('settings.offset_hint')}</div>
      </div>

      <div class="border-gray-600 border-2 rounded-md my-2 p-2 w-full">
        <PrefixSettings
          settings={config.prefixSettings}
          on:change={handlePrefixChange}
        />
      </div>

      <div class="border-gray-600 border-2 rounded-md my-2 p-2 w-full">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-1">
            <h3>{$t('settings.page_labels')}</h3>
            <a href="https://pdfa.org/pdf-ux-page-labels/" target="_blank" class="text-gray-400 hover:text-black transition-colors" title="Learn more about PDF Page Labels">
              <HelpCircle size={14} />
            </a>
          </div>

          <label
            class="relative inline-flex items-center cursor-pointer"
            class:opacity-50={pageLabelsDisabled}
          >
            <input
              type="checkbox"
              class="sr-only peer"
              checked={!!config.pageLabelSettings?.enabled && !pageLabelsDisabled}
              on:change={handlePageLabelsToggle}
              aria-label={$t('settings.page_labels')}
              title={pageLabelsDisabled
                ? $t('settings.page_labels_disabled_multi_range')
                : $t('settings.page_labels')}
              disabled={pageLabelsDisabled}
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none border-2 border-black rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-black after:border-2 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-800"
            ></div>
          </label>
        </div>

        {#if pageLabelsDisabled}
          <div class="text-xs text-gray-500 mt-1">
            {$t('settings.page_labels_disabled_multi_range')}
          </div>
        {/if}

        {#if !!config.pageLabelSettings?.enabled && !pageLabelsDisabled}
          <div transition:slide={{duration: 200}} class="mt-2">
            <PageLabelSetting
              settings={config.pageLabelSettings}
              on:change={handlePageLabelChange}
            />
          </div>
        {/if}
      </div>

      <div class="mt-3 border-gray-600 border-2 rounded-md my-2 p-2 w-full">
        <div class="flex justify-between items-center">
          <h3>{$t('settings.add_physical_page')}</h3>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              id="add_physical_page"
              type="checkbox"
              class="sr-only peer"
              bind:checked={addPhysicalTocPage}
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none border-2 border-black rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-black after:border-2 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-800"
            ></div>
          </label>
        </div>

        {#if addPhysicalTocPage}
          <div transition:slide={{duration: 200}}>
            <div class="border-gray-600 border-2 rounded-md my-2 p-2 w-full">
              <div class="flex gap-2 items-center">
                <label
                  class="whitespace-nowrap text-sm"
                  for="insert_at_page">{$t('settings.insert_at_page')}</label
                >
                <input
                  type="number"
                  id="insert_at_page"
                  value={config.insertAtPage || 2}
                  on:input={(e) => updateField('insertAtPage', parseInt(e.target.value, 10) || 2)}
                  class="w-20 border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  min={1}
                />
                <button
                  on:click={() => dispatch('jumpToTocPage')}
                  class="ml-auto px-2 py-0.5 bg-white text-black border-2 border-black rounded-md shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm"
                  title={$t('tooltip.jump_toc')}
                  disabled={!previewPdfInstance}
                >
                  {$t('btn.go')}
                </button>
              </div>
              <div class="flex gap-2 items-center mt-3 justify-between">
                <label
                  class="whitespace-nowrap text-sm"
                  for="font_family"
                >
                  {$t('settings.font_family')}
                </label>
                <select
                  id="font_family"
                  class="border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50 text-sm py-1"
                  value={config.fontFamily || 'huiwen'}
                  on:change={(e) => updateField('fontFamily', (e.target as HTMLSelectElement).value)}
                >
                  <option value="huiwen">{$t('settings.font_huiwen')}</option>
                  <option value="hei">{$t('settings.font_hei')}</option>
                  <option value="song">{$t('settings.font_song')}</option>
                </select>
              </div>
              <div class="flex flex-col gap-1 border-t border-gray-200 mt-2 pt-2">
                <div class="flex justify-between items-center">
                  <label
                    class="text-sm"
                    for="title_y_start"
                  >
                    {$t('settings.title_y_start')}
                  </label>
                </div>

                <div class="flex items-center gap-2 h-6">
                  <span class="text-[10px] text-gray-400">Top</span>
                  <input
                    type="range"
                    id="title_y_start"
                    min="0.1"
                    max="0.9"
                    step="0.1"
                    value={config.titleYStart ?? 0.33}
                    on:input={(e) => updateField('titleYStart', parseFloat(e.target.value))}
                    class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black border border-gray-300 hover:border-gray-400"
                  />
                  <span class="text-[10px] text-gray-400">Bottom</span>
                </div>
              </div>
            </div>

            <div class="flex flex-col sm-[400px]:flex-row gap-4 text-sm">
              <div class="w-full md:w-1/2">
                <h3 class="my-3 font-bold">{$t('settings.first_level')}</h3>

                <div class="border-gray-600 border-2  rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="first_level_font_size">{$t('settings.font_size')}</label>
                  <input
                    type="number"
                    id="first_level_font_size"
                    value={config.firstLevel.fontSize}
                    on:input={(e) => updateField('firstLevel.fontSize', parseInt(e.target.value, 10) || 0)}
                    class="w-[50%] border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  />
                </div>
                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="first_level_dot_leader">{$t('settings.dot_leader')}</label>
                  <input
                    type="text"
                    id="first_level_dot_leader"
                    value={config.firstLevel.dotLeader}
                    on:input={(e) => updateField('firstLevel.dotLeader', e.target.value)}
                    class="w-[50%] border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  />
                </div>
                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="first_level_color">{$t('settings.color')}</label>
                  <input
                    type="color"
                    id="first_level_color"
                    value={config.firstLevel.color}
                    on:input={(e) => updateField('firstLevel.color', e.target.value)}
                    class="w-[50%]"
                  />
                </div>
                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="first_level_line_spacing">{$t('settings.spacing')}</label>
                  <input
                    type="number"
                    step="0.1"
                    id="first_level_line_spacing"
                    value={config.firstLevel.lineSpacing}
                    on:input={(e) => updateField('firstLevel.lineSpacing', parseFloat(e.target.value) || 1)}
                    class="w-[50%] border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  />
                </div>
              </div>

              <div class="w-full md:w-1/2">
                <h3 class="my-3 font-bold">{$t('settings.other_levels')}</h3>

                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="other_levels_font_size">{$t('settings.font_size')}</label>
                  <input
                    type="number"
                    id="other_levels_font_size"
                    value={config.otherLevels.fontSize}
                    on:input={(e) => updateField('otherLevels.fontSize', parseInt(e.target.value, 10) || 0)}
                    class="w-[50%] border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  />
                </div>
                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="other_levels_dot_leader">{$t('settings.dot_leader')}</label>
                  <input
                    type="text"
                    id="other_levels_dot_leader"
                    value={config.otherLevels.dotLeader}
                    on:input={(e) => updateField('otherLevels.dotLeader', e.target.value)}
                    class="w-[50%] border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  />
                </div>
                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="other_levels_color">{$t('settings.color')}</label>
                  <input
                    type="color"
                    id="other_levels_color"
                    value={config.otherLevels.color}
                    on:input={(e) => updateField('otherLevels.color', e.target.value)}
                    class="w-[50%]"
                  />
                </div>
                <div class="border-gray-600 border-2 rounded-md my-3 p-2 w-full flex items-center justify-between">
                  <label for="other_levels_line_spacing">{$t('settings.spacing')}</label>
                  <input
                    type="number"
                    step="0.1"
                    id="other_levels_line_spacing"
                    value={config.otherLevels.lineSpacing}
                    on:input={(e) => updateField('otherLevels.lineSpacing', parseFloat(e.target.value) || 1)}
                    class="w-[50%] border-2 border-gray-300 rounded px-1 focus:outline-none focus:bg-gray-50"
                  />
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
