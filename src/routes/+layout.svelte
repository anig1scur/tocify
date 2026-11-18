<script lang="ts">
	import '../app.css';
  import '../lib/i18n';
  import ShortcutsModal from '../components/modals/ShortcutsModal.svelte';

	let { children } = $props();
</script>

{@render children()}

<ShortcutsModal />

{#await import('../components/PwaPrompt.svelte') then { default: PwaPrompt }}
  <PwaPrompt />
{/await}
