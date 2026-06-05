<script lang="ts">
  import {onMount} from 'svelte';
  import {t} from 'svelte-i18n';
  import {X, Download, Terminal, ChevronDown, Bug, EyeOff} from 'lucide-svelte';

  let isOpen = false;
  let copied = false;

  let isVisible = false;
  let autoCloseTimer: ReturnType<typeof setTimeout>;
  let hideTimer: ReturnType<typeof setTimeout>;

  const macCommand = 'sudo xattr -r -d com.apple.quarantine /Applications/Tocify.app';

  const STORAGE_KEY = 'tocify_client_promo_hidden_until';
  const HIDE_DAYS = 30;

  onMount(() => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      return;
    }

    const hiddenUntil = localStorage.getItem(STORAGE_KEY);
    if (hiddenUntil && Date.now() < parseInt(hiddenUntil)) {
      return;
    }

    if (Math.random() > 0.5) {
      return;
    }

    isVisible = true;

    setTimeout(() => {
      isOpen = true;
    }, 500);

    autoCloseTimer = setTimeout(() => {
      if (isOpen) {
        isOpen = false;
        startHideTimer();
      }
    }, 15000);
  });

  function startHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      isVisible = false;
    }, 30000);
  }

  function closeCompletely() {
    isVisible = false;
    clearTimeout(autoCloseTimer);
    clearTimeout(hideTimer);
  }

  function dismissForWeek() {
    const expirationDate = Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, expirationDate.toString());
    closeCompletely();
  }

  function toggle() {
    clearTimeout(autoCloseTimer);

    isOpen = !isOpen;

    if (isOpen) {
      clearTimeout(hideTimer);
    } else {
      startHideTimer();
    }
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(macCommand);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  }
</script>

<div
  class="fixed top-0 right-4 z-[100] flex flex-col items-end transition-transform · ease-spring"
  class:translate-y-0={isVisible && isOpen}
  class:-translate-y-[calc(100%-28px)]={isVisible && !isOpen}
  class:md:-translate-y-[calc(100%-38px)]={isVisible && !isOpen}
  class:-translate-y-[calc(100%+5px)]={!isVisible}
>
  <div
    class="bg-white border-2 border-gray-800 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] w-[320px] p-5 flex flex-col gap-4 rounded-b-2xl"
  >
    <div class="flex items-center justify-between border-gray-800 pb-2">
      <h3 class="font-bold text-black text-lg flex items-center gap-2 uppercase tracking-tight">
        {$t('client.title', {default: 'Run in Client App'})}
      </h3>
      <button
        on:click={closeCompletely}
        class="hover:bg-black hover:text-white transition-colors border-2 border-transparent hover:border-gray-800 p-0.5 rounded-lg"
      >
        <X
          size={20}
          strokeWidth={3}
        />
      </button>
    </div>

    <div class="flex flex-col gap-3">
      <a
        href="https://github.com/anig1scur/tocify/releases"
        target="_blank"
        class="group relative flex items-center justify-center gap-3 w-full py-3 bg-amber-300 border-2 border-gray-800 text-black font-black text-sm uppercase tracking-wider shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all rounded-xl"
      >
        <Download
          size={18}
          strokeWidth={2.5}
        />
        {$t('client.download_btn', {default: 'Download Client'})}
      </a>
    </div>

    <div class="bg-gray-50 border-2 border-gray-800 border-dashed p-3 flex flex-col gap-2 rounded-xl">
      <div class="flex justify-between items-center">
        <span class="text-xs font-bold text-black flex items-center gap-1.5 uppercase">
          <Terminal
            size={12}
            strokeWidth={3}
          /> macOS Fix
        </span>
        <button
          on:click={copyCommand}
          class="text-[10px] px-2 py-1 bg-white border border-gray-800 font-bold uppercase hover:bg-black hover:text-white transition-colors cursor-pointer rounded-md"
        >
          {copied ? $t('client.copied', {default: 'COPIED!'}) : $t('client.copy_cmd', {default: 'COPY CMD'})}
        </button>
      </div>
      <p class="text-[11px] text-gray-600 leading-tight">
        {$t('client.mac_hint', {default: 'Run this if the app shows damaged.'})}
      </p>
    </div>

    <div class="flex items-start gap-3 border-gray-800 pt-3">
      <div class="flex flex-col w-full">
        <strong class="text-xs font-black uppercase text-black">
          {$t('client.byo_title', {default: 'Bring Your Own Key'})}
        </strong>
        <p class="text-[11px] font-medium text-gray-500 mt-1 leading-6">
          Supports
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            class="underline decoration-gray-400 hover:text-black hover:decoration-black transition-colors">Gemini</a
          >,
          <a
            href="https://bailian.console.aliyun.com/?tab=model#/api-key"
            target="_blank"
            class="underline decoration-gray-400 hover:text-black hover:decoration-black transition-colors">Qwen</a
          >,
          <a
            href="https://open.bigmodel.cn/usercenter/apikeys"
            target="_blank"
            class="underline decoration-gray-400 hover:text-black hover:decoration-black transition-colors">Zhipu</a
          >,
          custom OpenAI-compatible endpoints
          or
          <a
            href="https://github.com/anig1scur/tocify"
            target="_blank"
            class="underline decoration-gray-400 hover:text-black hover:decoration-black transition-colors">clone</a
          >
          and config yourself.
        </p>
      </div>
    </div>

    <div class="flex justify-between items-center">
      <a
        href="https://github.com/anig1scur/tocify/issues"
        target="_blank"
        class="flex items-center gap-1.5 text-[10px] font-bold uppercase text-gray-400 hover:text-black transition-colors"
      >
        <Bug
          size={12}
          strokeWidth={2.5}
        />
        {$t('client.report_issue', {default: 'Report Issue'})}
      </a>

      <button
        on:click={dismissForWeek}
        class="flex items-center gap-1.5 text-[10px] font-bold uppercase text-gray-400 hover:text-red-500 transition-colors"
        title="Don't show this"
      >
        <EyeOff
          size={12}
          strokeWidth={2.5}
        />
        {$t('client.snooze', {default: 'Hide'})}
      </button>
    </div>
  </div>

  <button
    on:click={toggle}
    class="mr-4 -mt-[2px] h-10 px-5 bg-white border-x-2 border-b-2 border-gray-800 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center gap-3 text-sm font-bold text-black hover:bg-amber-300 transition-colors cursor-pointer z-10 rounded-b-xl"
  >
    {#if !isOpen}
      <img
        src="/favicon.png"
        alt="App Icon"
        class="w-6 h-6 rounded-md border-gray-800"
      />
      <span class="uppercase tracking-wide">
        {$t('client.btn_open', {default: 'Client App'})}
      </span>
      <ChevronDown
        size={16}
        strokeWidth={3}
        class="opacity-50"
      />
    {:else}
      <span class="uppercase tracking-wide">
        {$t('client.btn_fold', {default: 'Fold'})}
      </span>
    {/if}
  </button>
</div>

<style>
  .ease-spring {
    transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  }
</style>
