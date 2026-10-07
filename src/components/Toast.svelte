<script lang="ts">
  import {onMount} from 'svelte';
  import {createEventDispatcher} from 'svelte';
  import {X, CheckCircle, AlertTriangle, InfoIcon} from 'lucide-svelte';
  import {fly} from 'svelte/transition';

  export let message = 'Success!';
  export let duration = 3000;
  export let type: 'success' | 'error' | 'info' = 'info';

  const dispatch = createEventDispatcher();

  let timeout: ReturnType<typeof setTimeout>;
  onMount(() => {
    timeout = setTimeout(() => {
      dispatch('close');
    }, duration + (type === 'error' ? 3000 : 0));
    return () => clearTimeout(timeout);
  });

</script>

<div
  class="fixed md:top-5 md:right-5 text-black right-1/2 w-[90vw] md:w-fit max-w-[90vw] transform translate-x-1/2 md:-translate-x-0 p-2 md:p-4 rounded-lg shadow-[2px_2px_0px_var(--hard-shadow-color)] flex items-center z-[999] border-2 border-black"
  class:bg-lime-400={type === 'success'}
  class:bg-red-500={type === 'error'}
  class:bg-yellow-400={type === 'info'}
  transition:fly={{ y: -50, x: 0, duration: 300, opacity: 0.5 }}>
  {#if type === 'success'}
    <CheckCircle
      size={20}
      class="mr-3 flex-shrink-0"
    />
  {:else if type === 'error'}
    <AlertTriangle
      size={20}
      class="mr-3 flex-shrink-0"
    />
  {:else}
    <InfoIcon
      size={20}
      class="mr-3 flex-shrink-0"
    />
  {/if}

  <span class="font-semibold pr-8">{message}</span>

  <button
    on:click={() => dispatch('close')}
    class="absolute right-2 p-1 rounded-full text-black hover:bg-black hover:text-white transition-colors"
  >
    <X size={20} />
  </button>
</div>