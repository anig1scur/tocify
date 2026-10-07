<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { t } from 'svelte-i18n';
  import { Github, MessageSquare, X, Star } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';

  export let show: boolean = false;

  const dispatch = createEventDispatcher();
  const GITHUB_URL = 'https://github.com/anig1scur/tocify';

  function close() {
    show = false;
    dispatch('close');
  }

  function handleStar() {
    window.open(GITHUB_URL, '_blank');
    handleDontShow();
  }

  function handleFeedback() {
    window.open(`${GITHUB_URL}/issues`, '_blank');
    close();
  }

  function handleDontShow() {
    localStorage.setItem('tocify_hide_star_request', 'true');
    close();
  }
</script>

{#if show}
  <div
    class="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
    transition:fade={{ duration: 200 }}
    on:click={close}
  >
    <div
      class="bg-white rounded-xl p-8 max-w-md w-full border-4 border-black shadow-[8px_8px_0px_var(--hard-shadow-color)] relative overflow-hidden"
      transition:fly={{ y: 20, duration: 300 }}
      on:click|stopPropagation
    >
      <button
        on:click={close}
        class="absolute -top-6 -right-6 w-24 h-24 bg-yellow-300 rounded-full border-4 border-black -rotate-12 flex items-center justify-center group hover:bg-white transition-all active:scale-95 z-20"
        title="Close"
      >
        <Star
          size={40}
          class="fill-black group-hover:fill-transparent transition-all"
          strokeWidth={3}
        />
      </button>

      <div class="flex flex-col gap-6 pt-4">
        <div class="space-y-2">
          <h2 class="text-3xl font-black italic uppercase tracking-tight">
            {$t('star_request.title')}
          </h2>
          <p class=" font-medium text-gray-700 leading-relaxed">
            {$t('star_request.body')}
          </p>
        </div>

        <div class="flex flex-col gap-3 mt-2">
          <button
            on:click={handleStar}
            class="flex items-center justify-center gap-2 py-4 bg-black text-white rounded-xl font-bold text-lg hover:bg-gray-800 transition-all active:scale-95 shadow-[4px_4px_0px_rgba(0,0,0,0.3)]"
          >
            <Github size={24} />
            {$t('star_request.btn_star')}
          </button>

          <button
            on:click={handleFeedback}
            class="flex items-center justify-center gap-2 py-4 bg-yellow-400 border-4 border-black rounded-xl font-bold text-lg hover:bg-yellow-300 transition-all active:scale-95 shadow-[4px_4px_0px_var(--hard-shadow-color)]"
          >
            <MessageSquare size={24} />
            {$t('star_request.btn_feedback')}
          </button>
        </div>

        <div class="flex items-center justify-between mt-4">
          <button
            on:click={close}
            class="text-sm font-bold text-gray-500 hover:text-black transition-colors"
          >
            {$t('star_request.btn_maybe_later')}
          </button>
          <button
            on:click={handleDontShow}
            class="text-sm font-bold text-gray-400 hover:text-red-500 transition-colors underline decoration-2 underline-offset-4"
          >
            {$t('star_request.btn_dont_show')}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
