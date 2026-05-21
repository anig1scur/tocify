<script lang="ts">
	import '../app.css';
  import '../lib/i18n';
  import {onMount} from 'svelte';

	let { children } = $props();

  const THEME_KEY = 'tocify_theme';

  function applyTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    document.documentElement.dataset.theme = savedTheme === 'miro' ? 'miro' : 'neo';
  }

  onMount(() => {
    applyTheme();
    window.addEventListener('tocify-theme-change', applyTheme);

    return () => window.removeEventListener('tocify-theme-change', applyTheme);
  });
</script>

{@render children()}
