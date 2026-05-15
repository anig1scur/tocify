<script lang="ts">
  import {createEventDispatcher, onMount} from 'svelte';
  import {slide} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {ExternalLink, Eye, EyeOff, KeyRound, Sparkles} from 'lucide-svelte';
  import {KNOWN_PROVIDER_MODELS, createEmptyApiConfig, requiresUserApiKeyForModel, normalizeModelOverrides} from '$lib/llm/core';

  export let isExpanded = false;

  const dispatch = createEventDispatcher();

  let config = createEmptyApiConfig();

  let isSaved = false;
  let showApiKey = false;
  let showCustomModelNotice = false;
  let customModelNoticeVersion = 0;
  const providerLinks = {
    gemini: {
      label: 'Gemini',
      href: 'https://aistudio.google.com/app/apikey',
    },
    qwen: {
      label: 'Qwen',
      href: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    },
    doubao: {
      label: 'Doubao',
      href: 'https://www.volcengine.com/docs/82379/1541594?lang=zh',
    },
    zhipu: {
      label: 'Zhipu',
      href: 'https://open.bigmodel.cn/usercenter/apikeys',
    },
  };

  function getEffectiveConfig() {
    if (!config.provider) {
      return {
        provider: '',
        apiKey: '',
        doubaoEndpointIdText: '',
        doubaoEndpointIdVision: '',
        modelOverrides: undefined,
      };
    }

    return {
      ...config,
      modelOverrides: normalizeModelOverrides(config.modelOverrides),
    };
  }

  function getSingleModelValue(provider: string) {
    switch (provider) {
      case 'gemini':
        return config.modelOverrides.geminiModel;
      case 'qwen':
        return config.modelOverrides.qwenVisionModel || config.modelOverrides.qwenTextModel;
      case 'zhipu':
        return config.modelOverrides.zhipuVisionModel || config.modelOverrides.zhipuTextModel;
      default:
        return '';
    }
  }

  function setSingleModelValue(provider: string, value: string) {
    if (provider === 'gemini') {
      config.modelOverrides.geminiModel = value;
      return;
    }

    if (provider === 'qwen') {
      config.modelOverrides.qwenTextModel = value;
      config.modelOverrides.qwenVisionModel = value;
      return;
    }

    if (provider === 'zhipu') {
      config.modelOverrides.zhipuTextModel = value;
      config.modelOverrides.zhipuVisionModel = value;
    }
  }

  function getVisibleProviderLinks() {
    if (config.provider && config.provider in providerLinks) {
      return [providerLinks[config.provider as keyof typeof providerLinks]];
    }

    return [];
  }

  onMount(() => {
    const savedConfig = localStorage.getItem('tocify_api_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        config = {
          ...createEmptyApiConfig(),
          ...parsed,
          modelOverrides: {
            ...createEmptyApiConfig().modelOverrides,
            ...(parsed.modelOverrides || {}),
          },
        };
        dispatch('change', getEffectiveConfig());
      } catch (e) {
        console.error('Failed to parse api config', e);
      }
    }
  });

  $: customModelNeedsUserApiKey = requiresUserApiKeyForModel(
    config.provider,
    config.apiKey,
    config.modelOverrides,
  );

  function markDirty() {
    isSaved = false;
    showCustomModelNotice = false;
  }

  function save() {
    showCustomModelNotice = customModelNeedsUserApiKey;
    if (customModelNeedsUserApiKey) {
      customModelNoticeVersion += 1;
    }
    localStorage.setItem('tocify_api_config', JSON.stringify(config));
    isSaved = true;
    const effectiveConfig = getEffectiveConfig();
    dispatch('save', effectiveConfig);
    dispatch('change', effectiveConfig);

    setTimeout(() => {
      isSaved = false;
    }, 1000);

    setTimeout(() => {
      if (!showCustomModelNotice) {
        isExpanded = false;
      }
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
          <div class="flex items-center gap-3">
            <select
              id="llm_provider"
              class="w-full bg-white outline-none text-sm"
              bind:value={config.provider}
              on:change={markDirty}
            >
              <option value="">Auto</option>
              <option value="gemini">Gemini</option>
              <option value="qwen">Qwen</option>
              <option value="doubao">Doubao</option>
              <option value="zhipu">Zhipu</option>
            </select>

            {#each getVisibleProviderLinks() as providerLink}
              <a
                href={providerLink.href}
                target="_blank"
                rel="noreferrer"
                class="shrink-0 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-black"
              >
                <span>Get Key</span>
                <ExternalLink size={12} strokeWidth={2.5} />
              </a>
            {/each}
          </div>
        </div>

        {#if config.provider === 'gemini'}
          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="gemini_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
            >
            <input
              id="gemini_model"
              type="text"
              name="gemini-model-input"
              autocomplete="new-password"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              data-1p-ignore="true"
              data-lpignore="true"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder={KNOWN_PROVIDER_MODELS.gemini.text[0]}
              value={getSingleModelValue('gemini')}
              on:input={(e) => {
                setSingleModelValue('gemini', (e.currentTarget as HTMLInputElement).value);
                markDirty();
              }}
            />
          </div>
        {/if}

        {#if config.provider === 'qwen'}
          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="qwen_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
            >
            <input
              id="qwen_model"
              type="text"
              name="qwen-model-input"
              autocomplete="new-password"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              data-1p-ignore="true"
              data-lpignore="true"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder={KNOWN_PROVIDER_MODELS.qwen.vision[0]}
              value={getSingleModelValue('qwen')}
              on:input={(e) => {
                setSingleModelValue('qwen', (e.currentTarget as HTMLInputElement).value);
                markDirty();
              }}
            />
          </div>
        {/if}

        {#if config.provider === 'zhipu'}
          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="zhipu_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
            >
            <input
              id="zhipu_model"
              type="text"
              name="zhipu-model-input"
              autocomplete="new-password"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              data-1p-ignore="true"
              data-lpignore="true"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder={KNOWN_PROVIDER_MODELS.zhipu.vision[0]}
              value={getSingleModelValue('zhipu')}
              on:input={(e) => {
                setSingleModelValue('zhipu', (e.currentTarget as HTMLInputElement).value);
                markDirty();
              }}
            />
          </div>
        {/if}

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
              on:input={markDirty}
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
              on:input={markDirty}
            />
          </div>
        {/if}

        {#if config.provider}
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
            <div class="flex items-center gap-2">
              <input
                id="api_key"
                type={showApiKey ? 'text' : 'password'}
                name="provider-api-key"
                autocomplete="new-password"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                data-1p-ignore="true"
                data-lpignore="true"
                class="min-w-0 flex-1 outline-none placeholder:text-gray-400 placeholder:italic [&::placeholder]:text-xs "
                placeholder={$t('settings.api_key_placeholder')}
                bind:value={config.apiKey}
                on:input={markDirty}
              />
              <button
                type="button"
                class="shrink-0 text-gray-500 hover:text-black transition-colors"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                title={showApiKey ? 'Hide API key' : 'Show API key'}
                on:click={() => (showApiKey = !showApiKey)}
              >
                {#if showApiKey}
                  <EyeOff size={16} strokeWidth={2.5} />
                {:else}
                  <Eye size={16} strokeWidth={2.5} />
                {/if}
              </button>
            </div>
            {#if showCustomModelNotice}
              {#key customModelNoticeVersion}
                <p class="mt-2 rounded-md py-1.5 text-xs text-stone-600 animate-notice-shake">
                  {$t('error.custom_model_needs_api_key')}
                </p>
              {/key}
            {/if}
          </div>
        {/if}

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

<style>
  .animate-notice-shake {
    animation: notice-shake 0.32s ease-in-out;
    transform-origin: center;
  }

  @keyframes notice-shake {
    0% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-3px);
    }
    40% {
      transform: translateX(3px);
    }
    60% {
      transform: translateX(-2px);
    }
    80% {
      transform: translateX(2px);
    }
    100% {
      transform: translateX(0);
    }
  }
</style>
