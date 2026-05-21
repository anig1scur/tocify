<script lang="ts">
  import {onMount} from 'svelte';

  const year = new Date().getFullYear();
  const THEME_KEY = 'tocify_theme';

  let theme: 'neo' | 'miro' = 'neo';

  function applyTheme(nextTheme: 'neo' | 'miro') {
    theme = nextTheme;

    if (nextTheme === 'miro') {
      localStorage.setItem(THEME_KEY, nextTheme);
      document.documentElement.dataset.theme = nextTheme;
    } else {
      localStorage.removeItem(THEME_KEY);
      document.documentElement.dataset.theme = 'neo';
    }

    window.dispatchEvent(new CustomEvent('tocify-theme-change'));
  }

  function toggleTheme() {
    applyTheme(theme === 'miro' ? 'neo' : 'miro');
  }

  onMount(() => {
    theme = localStorage.getItem(THEME_KEY) === 'miro' ? 'miro' : 'neo';
  });
</script>
<footer class="w-full py-4 px-6 text-center text-sm text-gray-400 select-none">
  <p>
    © {year} Made by
    <a
      href="https://aeriszhu.com"
      target="_blank"
      class="hover:text-black border-b border-transparent hover:border-black transition-all duration-300"
    >
      Yanxin
    </a>
      ♩
    <a
      href="/about"
      class="hover:text-black border-b border-transparent hover:border-black transition-all duration-300 mx-1"
    >
      About
    </a>

    
      ♪ (•̀ᴗ• ) ̑̑


    <a
      href="https://github.com/anig1scur/tocify?tab=readme-ov-file#support-me"
      target="_blank"
      class="hover:text-yellow-600 "
    >
      Buy me a coffee
    </a>

    <button
      class="ml-2 text-[10px] uppercase tracking-wider opacity-35 hover:opacity-100 hover:text-black transition-opacity"
      on:click={toggleTheme}
      title={theme === 'miro' ? 'Switch to Neo Brutalism theme' : 'Switch to Miro draft theme'}
      aria-label={theme === 'miro' ? 'Switch to Neo Brutalism theme' : 'Switch to Miro draft theme'}
    >
      {theme === 'miro' ? 'neo' : 'miro'}
    </button>
  </p>
</footer>
