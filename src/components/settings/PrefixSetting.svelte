<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {t} from 'svelte-i18n';
  import {slide} from 'svelte/transition';
  import {type LevelConfig, type CounterStyle, convertNum} from '$lib/utils/prefix';

  export let settings: {
    enabled: boolean;
    configs: LevelConfig[];
  };

  const dispatch = createEventDispatcher();

  let expandedStates: boolean[] = settings.configs.map((_, i) => i === 0);

  const styles: {value: CounterStyle; label: string}[] = [
    {value: 'decimal', label: '1, 2, 3'},
    {value: 'chinese_simple', label: '一, 二, 三'},
    {value: 'roman_upper', label: 'I, II, III'},
    {value: 'alpha_upper', label: 'A, B, C'},
  ];

  function handleChange() {
    dispatch('change', settings);
  }

  function toggleExpand(index: number) {
    expandedStates[index] = !expandedStates[index];
  }

  function getPreview(config: LevelConfig, index: number): string {
    const num = convertNum(1, config.style);
    if (index === 0) {
      return `${config.prefix}${num}${config.suffix}`;
    } else {
      let core = num;
      if (config.inheritParent) {
        const parentNum = convertNum(1, config.style);
        const sep = config.separator || '.';
        core = `${parentNum}${sep}${num}`;
      }
      return `${config.prefix}${core}${config.suffix}`;
    }
  }
</script>

<div class="space-y-3">
  <div class="flex justify-between items-center">
    <h3>{$t('settings.add_numbering')}</h3>

    <label class="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        class="sr-only peer"
        bind:checked={settings.enabled}
        on:change={handleChange}
      />
      <div
        class="w-11 h-6 bg-gray-200 peer-focus:outline-none border-2 border-black rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-black after:border-2 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-800"
      ></div>
    </label>
  </div>

  {#if settings.enabled}
    <div
      transition:slide={{duration: 200}}
      class="space-y-3"
    >
      {#each settings.configs as config, i}
        <div
          class="border-2 border-black rounded-md bg-white overflow-hidden transition-all duration-200 shadow-[2px_2px_0px_rgba(0,0,0,0.1)]"
        >
          <button
            class="w-full flex justify-between items-center px-3 py-2 border-b-2 border-transparent hover:bg-gray-50 transition-colors text-left"
            class:border-gray-100={expandedStates[i]}
            on:click={() => toggleExpand(i)}
          >
            <div class="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="transition-transform duration-200"
                class:rotate-180={expandedStates[i]}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>

              <span class="font-bold text-sm select-none">
                {i === 0 ? $t('settings.first_level') : $t('settings.other_levels')}
              </span>
            </div>

            <div
              class="text-xs font-mono bg-yellow-300 text-black px-2 py-0.5 rounded border border-yellow-200 truncate max-w-[150px] sm:max-w-[240px]"
              title={$t('settings.preview')}
            >
              {getPreview(config, i)} Title
            </div>
          </button>

          {#if expandedStates[i]}
            <div
              transition:slide={{duration: 200}}
              class="p-3 pt-0"
            >
              <div class="space-y-3 pt-3">
                <div class="flex gap-2 items-end">
                  <div class="flex-grow">
                    <label class="text-sm text-gray-500 mb-1 block">{$t('settings.style')}</label>
                    <select
                      class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 bg-transparent focus:outline-none focus:ring-2 focus:ring-black/20"
                      bind:value={config.style}
                      on:change={handleChange}
                    >
                      {#each styles as s}
                        <option value={s.value}>{s.label}</option>
                      {/each}
                    </select>
                  </div>

                  {#if i > 0}
                    <div class="flex flex-col items-center">
                      <label class="text-sm text-gray-500 mb-1 block">{$t('settings.inherit_parent')}</label>
                      <input
                        type="checkbox"
                        class="checkbox h-8 w-8 checkbox-xs outline-2 outline-gray-300 rounded-sm checkbox-primary"
                        bind:checked={config.inheritParent}
                        on:change={handleChange}
                      />
                    </div>

                    {#if config.inheritParent}
                      <div
                        class="w-16"
                        transition:slide={{axis: 'x', duration: 200}}
                      >
                        <label class="text-sm text-gray-500 mb-1 block max-h-5">{$t('settings.separator')}</label>
                        <input
                          type="text"
                          class="w-full h-8 text-xs border-2 border-gray-300 rounded text-center focus:outline-none focus:bg-gray-50"
                          bind:value={config.separator}
                          on:input={handleChange}
                        />
                      </div>
                    {/if}
                  {/if}
                </div>

                <div class="flex gap-2 items-center">
                  <div class="flex-1">
                    <label class="text-sm text-gray-500 mb-1 block">{$t('settings.prefix')}</label>
                    <input
                      type="text"
                      class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 focus:outline-none focus:bg-gray-50"
                      placeholder="e.g. Chapter"
                      bind:value={config.prefix}
                      on:input={handleChange}
                    />
                  </div>

                  <div class="pt-5 text-gray-300">➜</div>

                  <div class="flex-1">
                    <label class="text-sm text-gray-500 mb-1 block">{$t('settings.suffix')}</label>
                    <input
                      type="text"
                      class="w-full h-8 text-xs border-2 border-gray-300 rounded px-2 focus:outline-none focus:bg-gray-50"
                      placeholder="e.g. ."
                      bind:value={config.suffix}
                      on:input={handleChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
