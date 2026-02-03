<script lang="ts">
  import {createEventDispatcher, onMount} from 'svelte';
  import {slide} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {KeyRound, Sparkles} from 'lucide-svelte';

  export let isExpanded = false;

  const dispatch = createEventDispatcher();

  let config = {
    provider: '',
    apiKey: '',
    doubaoEndpointIdText: '',
    doubaoEndpointIdVision: '',
  };

  let isSaved = false;

  onMount(() => {
    const savedConfig = localStorage.getItem('tocify_api_config');
    if (savedConfig) {
      try {
        config = JSON.parse(savedConfig);
        dispatch('change', config);
      } catch (e) {
        console.error('Failed to parse api config', e);
      }
    }
  });

  function save() {
    localStorage.setItem('tocify_api_config', JSON.stringify(config));
    isSaved = true;
    dispatch('save', config);
    dispatch('change', config);

    setTimeout(() => {
      isSaved = false;
    }, 1000);

    setTimeout(() => {
      isExpanded = false;
    }, 400);
  }
</script>

<div class="border-black border-2 rounded-lg p-2 my-4 shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-white">
  <div class="flex justify-between items-center">
    <div class="flex items-center gap-2">
      <h2>
        {$t('settings.api_settings_title') || 'API Settings'}
      </h2>
    </div>
    <button
      class="w-6 h-6 flex items-center justify-center transition-transform duration-200"
      class:rotate-180={isExpanded}
      on:click={() => (isExpanded = !isExpanded)}
      aria-label="Toggle API Settings"
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

  {#if isExpanded}
    <div
      class="mt-3"
      transition:slide={{duration: 200}}
    >
      <div class="flex flex-col gap-3">
        <div class="border-black border-2 rounded-md p-2 w-full">
          <label
            class="font-bold mb-1 text-sm flex items-center"
            for="llm_provider">
            <Sparkles size={14} strokeWidth={3} class="inline-block mr-1"/>LLM Provider</label
          >
          <select
            id="llm_provider"
            class="w-full bg-white outline-none text-sm"
            bind:value={config.provider}
            on:change={() => (isSaved = false)}
          >
            <option value="">Auto</option>
            <option value="gemini">Gemini</option>
            <option value="qwen">Qwen</option>
            <option value="doubao">Doubao</option>
            <option value="zhipu">Zhipu</option>
          </select>
        </div>

        {#if config.provider === 'doubao'}
          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="doubao_ep_text">Endpoint ID (Text/Lite)</label
            >
            <input
              id="doubao_ep_text"
              type="text"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder="ep-..."
              bind:value={config.doubaoEndpointIdText}
              on:input={() => (isSaved = false)}
            />
          </div>

          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="doubao_ep_vision">Endpoint ID (Vision/Pro)</label
            >
            <input
              id="doubao_ep_vision"
              type="text"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder="ep-..."
              bind:value={config.doubaoEndpointIdVision}
              on:input={() => (isSaved = false)}
            />
          </div>
        {/if}

        <div class="border-black border-2 rounded-md p-2 w-full">
          <label
            class="flex items-center gap-1.5 font-bold mb-1 text-sm"
            for="api_key"
            title="Your LLM provider key (stored locally only)"
          >
            <KeyRound size={14} strokeWidth={3} />
           Key
            <span class="font-normal text-gray-400 text-[11px] ml-2">{$t('settings.api_key_hint')}</span>
          </label>
          <input
            id="api_key"
            type="password"
            class="w-full outline-none text-sm placeholder-gray-400 placeholder:text-sm "
            placeholder={$t('settings.api_key_placeholder')}
            bind:value={config.apiKey}
            on:input={() => (isSaved = false)}
          />
        </div>

        <button
          class="w-full font-bold transition-all duration-200 text-black border-2 border-black rounded px-3 py-2
          {isSaved ? 'bg-lime-400' : 'bg-yellow-400 hover:bg-yellow-300'}"
          on:click={save}
        >
          {isSaved ? $t('btn.saved') : $t('btn.save')}
        </button>
      </div>
    </div>
  {/if}
</div>
