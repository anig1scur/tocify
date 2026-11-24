<script lang="ts">
  import {Send, Copy, Check} from 'lucide-svelte';
  import {IS_LOCAL} from '$lib/local';
  import Modal from './Modal.svelte';

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

<Modal
  bind:open={showHelpModal}
  title="How to Use Tocify"
  closeLabel="Close"
  backdrop="lime"
  size="xl"
>
  <svelte:fragment slot="header-extra">
    <button
      type="button"
      on:click={copyEmail}
      class="nb-chip hidden gap-1.5 sm:inline-flex {copied ? 'border-lime-400 bg-lime-300' : ''}"
      title="Click to copy email"
    >
      <Send size={13} />
      {#if copied}
        <Check size={13} /> Copied
      {:else}
        {email}
        <Copy size={12} class="text-gray-400" />
      {/if}
    </button>
  </svelte:fragment>

  <div class="min-h-0 overflow-y-auto p-4 sm:p-5">
    <video
      src={IS_LOCAL ? 'https://pdf.aeriszhu.com/videos/demo.mp4' : '/videos/demo.mp4'}
      controls
      loop
      autoplay
      muted
      class="h-auto w-full rounded-lg"
    ></video>
  </div>
</Modal>
