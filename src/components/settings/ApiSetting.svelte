<script lang="ts">
  import {createEventDispatcher, onMount} from 'svelte';
  import {slide} from 'svelte/transition';
  import {t} from 'svelte-i18n';
  import {ChevronDown, ExternalLink, Eye, EyeOff, KeyRound, Plus, RotateCcw, Trash2, Sparkles} from 'lucide-svelte';
  import {
    DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    DEFAULT_VISION_PROMPT_TEMPLATE,
    DEFAULT_CUSTOM_BASE_URL,
    DEFAULT_CUSTOM_MODEL,
    KNOWN_PROVIDER_MODELS,
    createEmptyApiConfig,
    createDefaultVisionPromptTemplate,
    requiresUserApiKeyForModel,
    normalizeModelOverrides,
    type VisionPromptTemplate,
  } from '$lib/llm/core';

  export let isExpanded = false;

  const dispatch = createEventDispatcher();

  let config = createEmptyApiConfig();

  let isSaved = false;
  let showApiKey = false;
  let showCustomModelNotice = false;
  let customModelNoticeVersion = 0;
  let visionTemplateName = '';
  let showVisionTemplateMenu = false;
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

  function createTemplateId() {
    return `vision-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeVisionPromptTemplates(parsed: any): {
    templates: VisionPromptTemplate[];
    activeId: string;
    activePrompt: string;
  } {
    const defaultTemplate = createDefaultVisionPromptTemplate();
    const rawTemplates = Array.isArray(parsed?.visionPromptTemplates)
      ? parsed.visionPromptTemplates
      : [];
    const sanitizedTemplates = rawTemplates
      .map((template: any) => ({
        id: String(template?.id || createTemplateId()),
        name: String(template?.name || $t('settings.vision_prompt_untitled')),
        prompt: String(template?.prompt || ''),
        isDefault: template?.id === DEFAULT_VISION_PROMPT_TEMPLATE_ID || Boolean(template?.isDefault),
      }))
      .filter((template: VisionPromptTemplate) => template.prompt.trim());

    const customTemplates = sanitizedTemplates.filter(
      (template: VisionPromptTemplate) => template.id !== DEFAULT_VISION_PROMPT_TEMPLATE_ID,
    );
    const templates = [defaultTemplate, ...customTemplates];
    const parsedActiveId = String(parsed?.visionPromptTemplateId || DEFAULT_VISION_PROMPT_TEMPLATE_ID);
    const activeTemplate = templates.find((template) => template.id === parsedActiveId);

    if (activeTemplate) {
      return {
        templates,
        activeId: activeTemplate.id,
        activePrompt: parsed?.visionPrompt || activeTemplate.prompt,
      };
    }

    return {
      templates,
      activeId: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
      activePrompt: parsed?.visionPrompt || DEFAULT_VISION_PROMPT_TEMPLATE,
    };
  }

  function getEffectiveConfig() {
    const effectiveConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      customBaseUrl: config.customBaseUrl,
      doubaoEndpointIdText: config.doubaoEndpointIdText,
      doubaoEndpointIdVision: config.doubaoEndpointIdVision,
      modelOverrides: normalizeModelOverrides(config.modelOverrides),
      visionPrompt: config.visionPrompt,
    };

    if (!config.provider) {
      return {
        ...effectiveConfig,
        modelOverrides: undefined,
      };
    }

    return effectiveConfig;
  }

  function getSingleModelValue(provider: string) {
    switch (provider) {
      case 'gemini':
        return config.modelOverrides.geminiModel;
      case 'qwen':
        return config.modelOverrides.qwenVisionModel || config.modelOverrides.qwenTextModel;
      case 'zhipu':
        return config.modelOverrides.zhipuVisionModel || config.modelOverrides.zhipuTextModel;
      case 'custom':
        return config.modelOverrides.customModel;
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
      return;
    }

    if (provider === 'custom') {
      config.modelOverrides.customModel = value;
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
        const defaultConfig = createEmptyApiConfig();
        const {templates, activeId, activePrompt} = normalizeVisionPromptTemplates(parsed);
        config = {
          ...defaultConfig,
          ...parsed,
          customBaseUrl: parsed.customBaseUrl?.trim() || defaultConfig.customBaseUrl,
          modelOverrides: {
            ...defaultConfig.modelOverrides,
            ...(parsed.modelOverrides || {}),
            customModel: parsed.modelOverrides?.customModel?.trim() || defaultConfig.modelOverrides.customModel,
          },
          visionPrompt: activePrompt,
          visionPromptTemplateId: activeId,
          visionPromptTemplates: templates,
        };
        syncVisionTemplateName();
        dispatch('change', getEffectiveConfig());
      } catch (e) {
        console.error('Failed to parse api config', e);
      }
    } else {
      syncVisionTemplateName();
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

  function resetVisionPromptTemplate() {
    config = {
      ...config,
      visionPrompt: DEFAULT_VISION_PROMPT_TEMPLATE,
      visionPromptTemplateId: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
      visionPromptTemplates: [
        createDefaultVisionPromptTemplate(),
        ...config.visionPromptTemplates.filter((template) => !template.isDefault),
      ],
    };
    syncVisionTemplateName();
    markDirty();
  }

  function syncActiveCustomTemplate() {
    const activeTemplate = getActiveVisionTemplate();
    if (!activeTemplate || activeTemplate.isDefault) return;

    const name = visionTemplateName.trim() || activeTemplate.name;
    config = {
      ...config,
      visionPromptTemplates: config.visionPromptTemplates.map((template) =>
        template.id === activeTemplate.id
          ? {...template, name, prompt: config.visionPrompt.trim() || DEFAULT_VISION_PROMPT_TEMPLATE}
          : template,
      ),
    };
    visionTemplateName = name;
  }

  function getActiveVisionTemplate() {
    return config.visionPromptTemplates.find(
      (template) => template.id === config.visionPromptTemplateId,
    );
  }

  function syncVisionTemplateName() {
    const activeTemplate = getActiveVisionTemplate();
    visionTemplateName = activeTemplate ? getVisionTemplateDisplayName(activeTemplate) : '';
  }

  function getVisionTemplateDisplayName(template: VisionPromptTemplate) {
    return template.isDefault ? $t('settings.vision_prompt_default_template') : template.name;
  }

  function selectVisionTemplate(template: VisionPromptTemplate) {
    config = {
      ...config,
      visionPromptTemplateId: template.id,
      visionPrompt: template.prompt,
    };
    syncVisionTemplateName();
    showVisionTemplateMenu = false;
    markDirty();
  }

  function handleVisionTemplateNameInput(event: Event) {
    visionTemplateName = (event.currentTarget as HTMLInputElement).value;
    showVisionTemplateMenu = false;
    syncActiveCustomTemplate();
    markDirty();
  }

  function handleVisionPromptInput() {
    syncActiveCustomTemplate();
    markDirty();
  }

  function createVisionPromptTemplate() {
    const activeTemplate = getActiveVisionTemplate();
    const currentName = visionTemplateName.trim();
    const defaultName = $t('settings.vision_prompt_default_template');
    const baseName =
      !currentName || activeTemplate?.isDefault || currentName === defaultName
        ? $t('settings.vision_prompt_untitled')
        : currentName;
    const name = getUniqueVisionTemplateName(baseName);
    const template: VisionPromptTemplate = {
      id: createTemplateId(),
      name,
      prompt: config.visionPrompt.trim() || DEFAULT_VISION_PROMPT_TEMPLATE,
    };

    config = {
      ...config,
      visionPromptTemplates: [...config.visionPromptTemplates, template],
      visionPromptTemplateId: template.id,
      visionPrompt: template.prompt,
    };
    visionTemplateName = template.name;
    showVisionTemplateMenu = false;
    markDirty();
  }

  function getUniqueVisionTemplateName(baseName: string) {
    const existingNames = new Set(config.visionPromptTemplates.map((template) => template.name));
    if (!existingNames.has(baseName)) return baseName;

    let index = 2;
    let nextName = `${baseName} ${index}`;
    while (existingNames.has(nextName)) {
      index += 1;
      nextName = `${baseName} ${index}`;
    }
    return nextName;
  }

  function deleteActiveVisionPromptTemplate() {
    const activeTemplate = getActiveVisionTemplate();
    if (!activeTemplate || activeTemplate.isDefault) return;

    config = {
      ...config,
      visionPromptTemplates: config.visionPromptTemplates.filter(
        (template) => template.id !== activeTemplate.id,
      ),
      visionPromptTemplateId: DEFAULT_VISION_PROMPT_TEMPLATE_ID,
      visionPrompt: DEFAULT_VISION_PROMPT_TEMPLATE,
    };
    syncVisionTemplateName();
    showVisionTemplateMenu = false;
    markDirty();
  }

  $: activeVisionTemplate = getActiveVisionTemplate();
  $: canDeleteVisionTemplate = Boolean(activeVisionTemplate && !activeVisionTemplate.isDefault);

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
              <option value="custom">Custom / OpenAI Compatible</option>
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

        {#if config.provider === 'custom'}
          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="custom_base_url">{$t('settings.custom_base_url_label') || 'Base URL'}</label
            >
            <input
              id="custom_base_url"
              type="url"
              name="custom-base-url-input"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder={$t('settings.custom_base_url_placeholder') || DEFAULT_CUSTOM_BASE_URL}
              maxlength="512"
              bind:value={config.customBaseUrl}
              on:input={markDirty}
            />
          </div>

          <div
            class="border-black border-2 rounded-md p-2 w-full"
            transition:slide={{duration: 200}}
          >
            <label
              class="block font-bold mb-1 text-sm"
              for="custom_model">{$t('settings.custom_model_label') || 'Custom Model'}</label
            >
            <input
              id="custom_model"
              type="text"
              name="custom-model-input"
              autocomplete="new-password"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              data-1p-ignore="true"
              data-lpignore="true"
              class="w-full outline-none text-sm placeholder-gray-400"
              placeholder={DEFAULT_CUSTOM_MODEL}
              maxlength="200"
              value={getSingleModelValue('custom')}
              on:input={(e) => {
                setSingleModelValue('custom', (e.currentTarget as HTMLInputElement).value);
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

        <div class="border-black border-2 rounded-md p-2 w-full">
          <div class="mb-1 flex items-center justify-between gap-2">
            <label
              class="block font-bold text-sm"
              for="vision_prompt">{$t('settings.vision_prompt_label')}</label
            >
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black"
              on:click={resetVisionPromptTemplate}
              aria-label={$t('settings.vision_prompt_reset')}
              title={$t('settings.vision_prompt_reset')}
            >
              <RotateCcw size={13} />
            </button>
          </div>

          <div class="mb-2">
            <div class="flex items-center gap-1">
              <div class="relative min-w-0 flex-1">
                <input
                  type="text"
                  value={visionTemplateName}
                  on:input={handleVisionTemplateNameInput}
                  autocomplete="off"
                  class="w-full border border-gray-300 rounded px-2 py-1 pr-8 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400"
                  placeholder={$t('settings.vision_prompt_template_name_placeholder')}
                  aria-label={$t('settings.vision_prompt_template_select')}
                />
                <button
                  type="button"
                  class="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-black"
                  on:click={() => (showVisionTemplateMenu = !showVisionTemplateMenu)}
                  aria-label={$t('settings.vision_prompt_template_select')}
                  title={$t('settings.vision_prompt_template_select')}
                >
                  <ChevronDown size={14} />
                </button>

                {#if showVisionTemplateMenu}
                  <div class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border border-gray-300 bg-white shadow-lg">
                    {#each config.visionPromptTemplates as template}
                      <button
                        type="button"
                        class="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-gray-100 {template.id === config.visionPromptTemplateId ? 'bg-blue-50 font-semibold' : ''}"
                        on:click={() => selectVisionTemplate(template)}
                      >
                        {getVisionTemplateDisplayName(template)}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50"
                on:click={createVisionPromptTemplate}
                aria-label={$t('settings.vision_prompt_save_as_template')}
                title={$t('settings.vision_prompt_save_as_template')}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 hover:text-black {canDeleteVisionTemplate ? '' : 'opacity-40'}"
                on:click={deleteActiveVisionPromptTemplate}
                aria-label={$t('settings.vision_prompt_delete_template')}
                title={$t('settings.vision_prompt_delete_template')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <textarea
            id="vision_prompt"
            bind:value={config.visionPrompt}
            on:input={handleVisionPromptInput}
            rows="10"
            class="w-full border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder:text-gray-400"
            placeholder={$t('settings.vision_prompt_placeholder')}
          ></textarea>
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
