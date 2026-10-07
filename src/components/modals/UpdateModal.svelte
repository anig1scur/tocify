<script lang="ts">
  import {fade, fly} from 'svelte/transition';
  import {Sparkles, Download, X, Loader2, AlertTriangle} from 'lucide-svelte';

  export let showUpdateModal: boolean = false;
  export let updateData: {version: string; body: string; date?: string} | null = null;

  export let onUpdate: () => Promise<void>;
  export let onCancel: () => void;

  let isUpdating = false;
  let errorMessage: string | null = null;

  const handleUpdateClick = async () => {
    if (isUpdating) return;

    isUpdating = true;
    errorMessage = null;

    try {
      await onUpdate();
    } catch (e: any) {
      console.error('Update detailed error:', e);

      errorMessage = `Error: ${e.message || JSON.stringify(e)}`;
      isUpdating = false;

      // console.error('Update failed:', e);
      // errorMessage = e.message || 'Download failed. Please check your network connection.';
      // isUpdating = false;
    }
  };

  const handleClose = () => {
    if (isUpdating) return;
    errorMessage = null;
    onCancel();
  };
</script>

{#if showUpdateModal && updateData}
  <div
    class="fixed inset-0 bg-gray-400/90 flex items-center justify-center z-[60] p-4"
    transition:fade={{duration: 150}}
    on:click|self={handleClose}
  >
    <div
      class="bg-white rounded-lg p-0 max-w-lg w-full max-h-[85vh] flex flex-col border-4 border-black shadow-[12px_12px_0px_var(--hard-shadow-color)] relative overflow-hidden"
      transition:fly={{y: 20, duration: 200}}
      on:click|stopPropagation
    >
      <div class="bg-yellow-300 border-b-4 border-black p-5 flex justify-between items-center">
        <div class="flex items-center gap-3">
          <div class="bg-white p-2 border-2 border-black rounded shadow-[2px_2px_0px_var(--hard-shadow-color)]">
            <Sparkles
              size={24}
              class="text-black"
            />
          </div>
          <div>
            <h2 class="text-2xl font-black italic tracking-tighter">NEW VERSION</h2>
            <p class="text-xs font-bold ">v{updateData.version} is available!</p>
          </div>
        </div>

        {#if !isUpdating}
          <button
            on:click={handleClose}
            class="p-2 rounded-lg border-2 border-transparent hover:bg-black hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        {/if}
      </div>

      <div class="p-6 overflow-y-auto custom-scrollbar flex-1">
        {#if errorMessage}
          <div
            class="mb-4 bg-red-100 border-2 border-red-600 text-red-700 p-3 rounded flex items-start gap-3"
            transition:fade
          >
            <AlertTriangle
              class="shrink-0 mt-0.5"
              size={20}
            />
            <div class="text-sm font-bold">
              <p>Update Failed:</p>
              <p class="font-normal">{errorMessage}</p>
            </div>
          </div>
        {/if}

        <div class="prose prose-sm max-w-none">
          <p class="font-bold text-lg mb-2">✨ What's New:</p>
          <div
            class="bg-gray-50 border-2 border-black rounded p-4  text-sm whitespace-pre-wrap leading-relaxed"
          >
            {updateData.body || 'Bug fixes and performance improvements.'}
          </div>
        </div>
      </div>

      <div class="p-6 pt-0 mt-auto grid grid-cols-2 gap-4">
        <button
          on:click={handleClose}
          disabled={isUpdating}
          class="px-4 py-3 font-bold border-2 border-black rounded bg-white text-black hover:bg-gray-100 transition-all active:translate-x-[2px] active:translate-y-[2px] shadow-[2px_2px_0px_var(--hard-shadow-color)] hover:shadow-[2px_2px_0px_var(--hard-shadow-color)] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-[2px_2px_0px_var(--hard-shadow-color)] disabled:translate-x-0 disabled:translate-y-0"
        >
          Later
        </button>

        <button
          on:click={handleUpdateClick}
          disabled={isUpdating}
          class="flex items-center justify-center gap-2 px-4 py-3 font-bold border-2 border-black rounded bg-green-400 text-black transition-all active:translate-x-[2px] active:translate-y-[2px] shadow-[2px_2px_0px_var(--hard-shadow-color)] hover:shadow-[2px_2px_0px_var(--hard-shadow-color)] hover:bg-green-300 active:shadow-none disabled:bg-green-200 disabled:cursor-not-allowed disabled:shadow-[2px_2px_0px_var(--hard-shadow-color)] disabled:translate-x-0 disabled:translate-y-0"
        >
          {#if isUpdating}
            <Loader2
              size={20}
              class="animate-spin"
            />
            <span>Installing...</span>
          {:else}
            <Download
              size={20}
              strokeWidth={3}
            />
            <span>Update Now</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
