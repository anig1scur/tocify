<script lang="ts">
  import {fade, fly} from 'svelte/transition';
  import {X, Send} from 'lucide-svelte';

  export let showHelpModal: boolean;

  const email = 'anigiscur@gmail.com';
  let copied = false;

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };
</script>

{#if showHelpModal}
  <div
    class="fixed inset-0 bg-lime-400 flex items-center justify-center z-50 p-4"
    transition:fade={{duration: 150}}
    on:click={() => (showHelpModal = false)}
  >
    <div
      class="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto border-4 border-black shadow-[8px_8px_0px_var(--hard-shadow-color)]"
      transition:fly={{y: 20, duration: 200}}
      on:click|stopPropagation
    >
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div class="flex flex-wrap items-center gap-4">
          <h2 class="text-2xl font-black italic">How to Use Tocify</h2>

          <span class=" font-bold border-l-2 border-black pl-4 ml-1 hidden sm:inline-block">
            Feedback
            <Send
              size={18}
              class="inline-block font-bold mr-1"
            />
          </span>

          <button
            on:click={copyEmail}
            class=" relative overflow-hidden group flex items-center gap-2 px-3 py-1.5
              text-xs font-bold uppercase tracking-wider
              border-2 border-black rounded-md
              {copied
              ? 'bg-lime-400 text-black border-black cursor-default'
              : 'bg-white text-black hover:bg-yellow-400 hover:text-black active:scale-95'}
            "
            title="Click to copy email"
          >
            {#if copied}
              <span>COPIED!</span>
            {:else}
              <span>{email}</span>
            {/if}
          </button>
        </div>

        <button
          on:click={() => (showHelpModal = false)}
          class="absolute top-4 right-4 md:relative md:top-auto md:right-auto p-2 border-2 border-transparent hover:border-black rounded hover:bg-gray-100 transition-all"
          aria-label="Close modal"
        >
          <X
            size={24}
            strokeWidth={3}
          />
        </button>
      </div>

      <div class="flex flex-col gap-6">
        <video
          src={'/videos/demo.mp4'}
          controls
          loop
          autoplay
          muted
          class="w-full h-auto rounded-md"
        ></video>
      </div>
    </div>
  </div>
{/if}
