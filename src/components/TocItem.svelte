<script lang="ts">
  import {ChevronRight, ChevronDown, Plus, Trash, GripVertical} from 'lucide-svelte';
  import ShortUniqueId from 'short-unique-id';
  import Self from './TocItem.svelte';
  import {maxPage, tocConfig, dragDisabled} from '../stores';
  import {createEventDispatcher} from 'svelte';
  import {t} from 'svelte-i18n';
  import {dndzone} from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';
  import type { TocItem } from '$lib/pdf/service';

  export let item: TocItem;
  export let onUpdate: (item: TocItem, updates: Partial<TocItem>, skipHistory?: boolean) => void;
  export let onDelete: (item: TocItem) => void;
  export let onDragStart: () => void = () => {};
  export let onDragEnd: () => void = () => {};

  export let currentPage = 1;
  export let isPreview = false;
  export let pageOffset = 0;
  export let insertAtPage = 2;
  export let tocPageCount = 0;
  
  // Numbering props
  export let prefix = '';
  export let index = 0;

  const dispatch = createEventDispatcher<{
    hoveritem: { to: number };
    jumpToPage: { to: number };
  }>();
  const flipDurationMs = 200;

  let editTitle = item ? item.title : '';
  let editPage = item ? item.to : 1;
  let isFocused = false;
  let isPageFocused = false;
  
  $: currentNumber = prefix ? `${prefix}.${index}` : `${index}`;

  $: if (item && !isFocused && item.title !== editTitle) {
    editTitle = item.title;
  }

  $: if (item && !isPageFocused && item.to !== editPage) {
    editPage = item.to;
  }

  $: physicalContentPage = item.to + pageOffset;
  $: targetPageInPreview =
    physicalContentPage >= insertAtPage ? physicalContentPage + tocPageCount : physicalContentPage;

  $: isActive = isPreview && currentPage === targetPageInPreview;

  function handleToggle() {
    item.open = !item.open;
    onUpdate(item, {open: item.open});
  }

  function handleUpdateTitle() {
    onUpdate(item, {title: editTitle});
  }

  function handleUpdatePage() {
    const page = Math.floor(editPage);
    if (!isNaN(page) && page !== item.to) {
      onUpdate(item, {to: page});
    }
  }

  function handlePageInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const val = parseInt(target.value);
    if (!isNaN(val) && val > 0) {
      dispatch('jumpToPage', {to: val});
    }
  }

  function handleAddChild() {
    const currentChildren = item.children || [];
    let startPage;

    if (currentChildren.length > 0) {
      startPage = Math.max(...currentChildren.map((c) => c.to)) + 1;
    } else {
      startPage = item.to + 1;
    }

    const newChild = {
      id: new ShortUniqueId({length: 10}).randomUUID(),
      title: $t('toc.new_item_default') || 'New Item',
      to: startPage,
      children: [],
      open: true,
    };
    
    const updatedChildren = [...currentChildren, newChild];
    onUpdate(item, {children: updatedChildren, open: true});
  }

  function handleUpdateChild(childItem: TocItem, updates: Partial<TocItem>, skipHistory = false) {
    const updatedChildren = (item.children || []).map((child) =>
      child.id === childItem.id ? {...child, ...updates} : child,
    );
    onUpdate(item, {children: updatedChildren}, skipHistory);
  }

  function handleDeleteChild(childItem: TocItem) {
    const updatedChildren = (item.children || []).filter((c) => c.id !== childItem.id);
    onUpdate(item, {children: updatedChildren});
  }

  function handleMouseEnter() {
    if (item) {
      dispatch('hoveritem', {to: item.to});
    }
  }

  function handleDndConsider(e: CustomEvent<{items: TocItem[]}>) {
    onDragStart();
    item.children = e.detail.items;
    item = item;
  }

  function handleDndFinalize(e: CustomEvent<{items: TocItem[]}>) {
    item.children = e.detail.items;
    item = item;
    onUpdate(item, {children: item.children}, true);
    onDragEnd();
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('.toc-item-title'));
      const target = e.target as HTMLInputElement;
      const index = allInputs.indexOf(target);
      if (index !== -1) {
        if (e.key === 'ArrowUp' && index > 0) {
          allInputs[index - 1].focus();
        } else if (e.key === 'ArrowDown' && index < allInputs.length - 1) {
          allInputs[index + 1].focus();
        }
      }
    }
  }
</script>

{#if item}
  <div>
    <div
      class="flex items-center gap-1 py-1.5 rounded-md group -mr-1"
      on:mouseenter={handleMouseEnter}
      class:bg-blue-200={isActive}
      class:font-bold={isActive}
    >
      <div 
        class="flex items-center gap-1 flex-1 min-w-0 h-full"
        on:mousedown={() => ($dragDisabled = false)}
        on:touchstart={() => ($dragDisabled = false)}
      >
        <div
          class="cursor-grab active:cursor-grabbing text-gray-400 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <GripVertical size={14} />
        </div>

        <button
          on:click|stopPropagation={handleToggle}
          class=" hover:bg-gray-200 rounded-md text-gray-500 ml-[-4px]"
          class:invisible={!item.children || item.children.length === 0}
          title="Toggle"
        >
          {#if item.open}
            <ChevronDown size={16} />
          {:else}
            <ChevronRight size={16} />
          {/if}
        </button>

        {#if $tocConfig.prefixSettings.enabled}
          <span class="text-xs text-gray-600 font-mono select-none pr-1">
            {currentNumber}
          </span>
        {/if}

        <input
          type="text"
          bind:value={editTitle}
          on:focus={() => (isFocused = true)}
          on:blur={() => {
            isFocused = false;
            handleUpdateTitle();
          }}
          on:keydown={handleTitleKeydown}
          on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
          class="toc-item-title border-2 border-black rounded px-2 py-1 text-sm myfocus focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-[100px]"
        />
      </div>


      <input
        type="number"
        bind:value={editPage}
        on:input={handlePageInput}
        on:focus={() => (isPageFocused = true)}
        on:blur={() => {
          isPageFocused = false;
          handleUpdatePage();
        }}
        on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
        class="w-14 border-2 border-black rounded ml-1 pl-1.5 py-1 text-sm myfocus focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div class="flex">
        <button
          on:click={handleAddChild}
          class="p-1 hover:bg-gray-200 rounded-md"
          title="Add Child"
        >
          <Plus size={16} />
        </button>
        <button
          on:click={() => onDelete(item)}
          class="px-1 hover:bg-gray-200 rounded-md text-black"
          title="Delete"
        >
          <Trash size={16} />
        </button>
      </div>
    </div>

    {#if item.open}
      <div
        class="ml-6 pl-2 border-transparent hover:border-gray-200 transition-colors"
        use:dndzone={{
          items: item.children || [],
          flipDurationMs,
          dragDisabled: $dragDisabled,
          dropTargetStyle: item.children?.length > 0 ? {outline: '2px dashed #000', borderRadius: '4px'} : {},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
      >
        {#each item.children || [] as child, i (child.id)}
          <div animate:flip={{duration: flipDurationMs}}>
            <Self
              prefix={currentNumber}
              index={i + 1}
              item={child}
              onUpdate={handleUpdateChild}
              onDelete={handleDeleteChild}
              {onDragStart}
              {onDragEnd}
              {currentPage}
              {isPreview}
              {pageOffset}
              {insertAtPage}
              {tocPageCount}
              on:hoveritem
              on:jumpToPage={(e: CustomEvent<{to: number}>) => dispatch('jumpToPage', e.detail)}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
