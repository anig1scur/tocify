<script lang="ts">
  import {ChevronRight, ChevronDown, Plus, Trash, GripVertical} from 'lucide-svelte';
  import ShortUniqueId from 'short-unique-id';
  import Self from './TocItem.svelte';
  import {maxPage, tocConfig, dragDisabled} from '../stores';
  import {createEventDispatcher} from 'svelte';
  import {t} from 'svelte-i18n';
  import {
    dndzone,
    SHADOW_ITEM_MARKER_PROPERTY_NAME,
    SHADOW_PLACEHOLDER_ITEM_ID,
  } from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';
  import type {TocItem} from '$lib/pdf/service';

  export let item: TocItem;
  export let onUpdate: (item: TocItem, updates: Partial<TocItem>, skipHistory?: boolean) => void;
  export let onDelete: (item: TocItem) => void;
  export let onDragStart: () => void = () => {};
  export let onDragEnd: () => void = () => {};
  export let onSelect: (item: TocItem, event: MouseEvent) => void = () => {};
  export let selectedIds: Set<string> = new Set();

  export let currentPage = 1;
  export let isPreview = false;
  export let pageOffset = 0;
  export let insertAtPage = 2;
  export let tocPageCount = 0;

  export let prefix = '';
  export let index = 0;

  const dispatch = createEventDispatcher<{
    hoveritem: {to: number};
    jumpToPage: {to: number};
    showNavHint: void;
  }>();
  export let flipDurationMs = 200;

  let editTitle = item ? item.title : '';
  let editPage = item ? item.to : 1;
  let isFocused = false;
  let isPageFocused = false;

  $: currentNumber = prefix ? `${prefix}.${index}` : `${index}`;
  $: isSelected = selectedIds.has(item.id);
  $: isShadowItem = Boolean(item?.[SHADOW_ITEM_MARKER_PROPERTY_NAME]);
  $: nestedChildren = item?.id === SHADOW_PLACEHOLDER_ITEM_ID ? [] : (item.children || []);

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
    const val = parseInt(target.value, 10);
    if (!isNaN(val) && val > 0) {
      dispatch('jumpToPage', {to: val});
    }
  }

  function handleAddChild() {
    const currentChildren = item.children || [];
    let startPage;

    if (currentChildren.length > 0) {
      startPage = Math.max(...currentChildren.map((child) => child.to)) + 1;
    } else {
      startPage = item.to + 1;
    }

    const newChild = {
      id: new ShortUniqueId({length: 10}).randomUUID(),
      title: '',
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
    const updatedChildren = (item.children || []).filter((child) => child.id !== childItem.id);
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
      const inputIndex = allInputs.indexOf(target);
      if (inputIndex !== -1) {
        if (e.key === 'ArrowUp' && inputIndex > 0) {
          allInputs[inputIndex - 1].focus();
        } else if (e.key === 'ArrowDown' && inputIndex < allInputs.length - 1) {
          allInputs[inputIndex + 1].focus();
        }
      }
    }
  }

  function handleTitleFocus() {
    isFocused = true;
    const expiryStr = localStorage.getItem('tocify_edit_title_toast_until');
    const now = Date.now();
    if (!expiryStr || now > parseInt(expiryStr, 10)) {
      dispatch('showNavHint');
      const newExpiry = now + 30 * 24 * 60 * 60 * 1000;
      localStorage.setItem('tocify_edit_title_toast_until', newExpiry.toString());
    }
  }

  function enableDrag() {
    $dragDisabled = false;
  }

  function isSelectionBlockedTarget(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    return Boolean(element?.closest('button,input,textarea,label,a,[data-drag-handle]'));
  }

  function handleRowClick(event: MouseEvent) {
    if (isSelectionBlockedTarget(event.target)) return;
    onSelect(item, event);
  }
</script>

{#if item}
  <div>
    <div
      class="flex items-center gap-1 py-1.5 rounded-md group -mr-1 border-2 border-transparent"
      class:bg-blue-200={isActive}
      class:font-bold={isActive}
      class:border-amber-400={isSelected}
      class:bg-amber-50={isSelected && !isActive}
      data-is-dnd-shadow-item-hint={isShadowItem}
      on:mouseenter={handleMouseEnter}
      on:click={handleRowClick}
    >
      <div
        class="flex items-center gap-1 flex-1 min-w-0 h-full"
      >
        <button
          on:click|stopPropagation={(e) => onSelect(item, e)}
          class="w-3 h-3 rounded-full border-2 flex-shrink-0 transition-all duration-150 {isSelected ? 'bg-amber-400 border-amber-500 scale-100' : 'border-gray-300 scale-90 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:!scale-100 hover:!border-amber-400'}"
          title={$t('toc.select_item')}
          aria-label={$t('toc.select_item')}
        ></button>
        <div
          data-drag-handle
          class="cursor-grab active:cursor-grabbing rounded-md p-0.5 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100 text-gray-400"
          on:mousedown={enableDrag}
          on:touchstart={enableDrag}
        >
          <GripVertical size={12} />
        </div>

        <button
          on:click|stopPropagation={handleToggle}
          class="hover:bg-gray-200 rounded-md text-gray-500 ml-[-4px]"
          class:invisible={!item.children || item.children.length === 0}
          title={$t('settings.toggle_expand')}
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
          on:focus={handleTitleFocus}
          on:blur={() => {
            isFocused = false;
            handleUpdateTitle();
          }}
          on:keydown={handleTitleKeydown}
          on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
          placeholder={prefix === '' ? $t('toc.new_chapter_default') : ($t('toc.new_item_default') || 'New Item')}
          class="toc-item-title border-2 border-black rounded px-2 py-1 text-sm myfocus focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-[100px] placeholder:text-gray-400"
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
          title={$t('toc.add_child')}
        >
          <Plus size={14} />
        </button>
        <button
          on:click={() => onDelete(item)}
          class="px-1 hover:bg-gray-200 rounded-md text-black"
          title={$t('toc.delete_item')}
        >
          <Trash size={14} />
        </button>
      </div>
    </div>

    {#if item.open && nestedChildren.length > 0}
      <div
        class="ml-6 pl-2 border-transparent hover:border-gray-200 transition-colors"
        use:dndzone={{
          items: nestedChildren,
          flipDurationMs,
          dragDisabled: $dragDisabled,
          dropTargetStyle: nestedChildren.length > 0 ? {outline: '2px dashed #000', borderRadius: '4px'} : {},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
      >
        {#each nestedChildren as child, i (`${child.id}${child[SHADOW_ITEM_MARKER_PROPERTY_NAME] ? `_${child[SHADOW_ITEM_MARKER_PROPERTY_NAME]}` : ''}`)}
          <div animate:flip={{duration: flipDurationMs}}>
            <Self
              prefix={currentNumber}
              index={i + 1}
              item={child}
              {flipDurationMs}
              onUpdate={handleUpdateChild}
              onDelete={handleDeleteChild}
              {onDragStart}
              {onDragEnd}
              {onSelect}
              {selectedIds}
              {currentPage}
              {isPreview}
              {pageOffset}
              {insertAtPage}
              {tocPageCount}
              on:showNavHint
              on:hoveritem
              on:jumpToPage={(e: CustomEvent<{to: number}>) => dispatch('jumpToPage', e.detail)}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
