<script lang="ts">
  import {InfoIcon, RefreshCw, X} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import {fly} from 'svelte/transition';
  import {useRegisterSW} from 'virtual:pwa-register/svelte';

  const {needRefresh, updateServiceWorker} = useRegisterSW({
    immediate: true,
    onRegistered(registration: ServiceWorkerRegistration | undefined) {
      registration?.update();
    },
    onRegisterError(error: unknown) {
      console.warn('SW registration error', error);
    },
  });

  function close() {
    needRefresh.set(false);
  }

  async function refresh() {
    await updateServiceWorker(true);
  }
</script>

{#if $needRefresh}
  <div
    class="fixed md:bottom-5 md:right-5 bottom-4 right-1/2 w-[90vw] md:w-fit max-w-[90vw] transform translate-x-1/2 md:translate-x-0 p-2 md:p-4 rounded-lg shadow-[2px_2px_0px_var(--hard-shadow-color)] flex items-center gap-3 z-[999] border-2 border-black text-black bg-yellow-400"
    role="status"
    aria-live="polite"
    transition:fly={{y: 50, x: 0, duration: 300, opacity: 0.5}}
  >
    <InfoIcon size={20} class="flex-shrink-0" />

    <span class="font-semibold pr-2">
      {$t('pwa.update_ready')}
    </span>

    <button
      on:click={refresh}
      class="inline-flex items-center gap-1 border-2 border-black bg-white px-2 py-1 rounded-md font-semibold shadow-[1px_1px_0px_var(--hard-shadow-color)] hover:bg-black hover:text-white transition-colors"
      aria-label={$t('pwa.refresh')}
    >
      <RefreshCw size={16} />
      <span>{$t('pwa.refresh')}</span>
    </button>

    <button
      on:click={close}
      class="p-1 rounded-full text-black hover:bg-black hover:text-white transition-colors"
      aria-label={$t('pwa.close')}
    >
      <X size={20} />
    </button>
  </div>
{/if}
