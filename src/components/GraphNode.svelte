<script>
  import {BrainCircuit} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import {createEventDispatcher} from 'svelte';
  import {CARD_W, CARD_H} from '$lib/utils/graph';

  export let node;
  export let activeNodeId;
  export let isDragTarget;
  const dispatch = createEventDispatcher();
</script>

<div
  class="absolute pointer-events-auto select-none group rounded-md flex flex-col items-center justify-center text-center p-3 transition-colors duration-75
        {isDragTarget ? 'z-[100] scale-105' : 'z-20'}
        {activeNodeId === node.id ? 'ring-4 ring-blue-400' : 'hover:scale-105'}"
  style="
        left: {node.x}px; 
        top: {node.y}px; 
        width: {CARD_W}px; 
        height: {CARD_H}px;
        cursor: grab;
        "
  on:mousedown
  on:click
>
  {#if node.isInferred}
    <div
      class="absolute top-2 left-2 flex items-center gap-1 text-[9px] text-slate-400 uppercase font-bold tracking-widest px-1 rounded"
    >
      <BrainCircuit size={10} />
    </div>
  {/if}

  <div class="font-['HuiwenMincho'] text-lg leading-5 font-bold text-gray-400 break-words line-clamp-3 w-full">
    {node.title}
  </div>

  {#if node.page}
    <button
      class="absolute bottom-2 right-2 text-xs font-mono text-gray-400 bg-white/50 px-1 rounded border border-transparent hover:text-yellow-400 transition-colors"
      title={$t('knowledge_board.jump_to_page', {values: {page: node.page}})}
      on:click|stopPropagation={() => dispatch('jump', node.page)}
    >
      p.{node.page}
    </button>
  {/if}
</div>
