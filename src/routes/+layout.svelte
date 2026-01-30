<script lang="ts">
	import '../app.css';
  import '../lib/i18n';
  import { init } from '@aptabase/web';
  import { onMount } from 'svelte';

  onMount(() => {
    init('A-US-0422911470');
  });

	let { children } = $props();
</script>

{@render children()}
