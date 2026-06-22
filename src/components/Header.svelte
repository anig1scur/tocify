<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  import {t} from 'svelte-i18n';
  import {Github, HelpCircle} from 'lucide-svelte';
  import Logo from '../assets/logo.svelte';
  import LanguageSwitch from '../components/LanguageSwitch.svelte';

  export let activePage: 'toc' | 'ocr' = 'toc';
  export let showHelp = true;

  const dispatch = createEventDispatcher();
</script>

<div class="flex justify-between items-start gap-4">
  <div>
    <div class="flex items-center gap-2">
      <Logo />
      <h1 class="text-3xl tracking-widest font-semibold">Tocify</h1>
    </div>
    <p class="text-xs text-gray-700 mt-1 pl-1">{$t('header.tagline')}</p>
    <div class="flex items-end gap-2 mt-3 text-xs font-semibold">
      <a
        href="/"
        class="px-3 py-1 rounded-full border-2 border-black transition-colors {activePage === 'toc' ? 'bg-sky-100 hover:bg-sky-200' : 'bg-white hover:bg-gray-50'}"
      >
        {$t('header.toc')}
      </a>
      <a
        href="/ocr"
        class="px-3 py-1 rounded-full border-2 border-black transition-colors {activePage === 'ocr' ? 'bg-sky-100 hover:bg-sky-200' : 'bg-white hover:bg-gray-50'}"
      >
        {$t('header.ocr')}
      </a>
    </div>
  </div>

  <div class="flex items-center gap-2 pt-2">
    <a
      href="https://github.com/anig1scur/tocify"
      target="_blank"
      rel="noopener noreferrer"
      class="text-black hover:text-gray-700 transition-colors"
      title={$t('header.github')}
      aria-label={$t('header.github')}
    >
      <Github size={30} />
    </a>
    {#if showHelp}
      <button
        on:click={() => dispatch('openhelp')}
        class="text-black hover:text-gray-700 transition-colors"
        title={$t('header.help')}
        aria-label={$t('header.help')}
      >
        <HelpCircle size={30} />
      </button>
    {/if}
    <LanguageSwitch />
  </div>
</div>
