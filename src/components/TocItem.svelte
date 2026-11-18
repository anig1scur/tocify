<script lang="ts">
  import {ChevronRight, Plus, Trash2, GripVertical} from 'lucide-svelte';
  import {slide} from 'svelte/transition';
  import {cubicOut} from 'svelte/easing';
  import {MOTION} from '$lib/utils/motion';
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
  export let onSelectionDragStart: (item: TocItem, event: MouseEvent) => void = () => {};
  export let selectedIds: Set<string> = new Set();
  export let searchQuery = '';

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
  let suppressNextRowClick = false;

  $: currentNumber = prefix ? `${prefix}.${index}` : `${index}`;
  $: isSelected = selectedIds.has(item.id);
  $: normalizedSearchQuery = searchQuery.trim().toLowerCase();
  $: shouldHighlightTitle = Boolean(normalizedSearchQuery && !isFocused);
  $: highlightedTitleParts = getHighlightedParts(editTitle, normalizedSearchQuery);
  $: isShadowItem = Boolean(getDndMarker(item));
  $: nestedChildren = item?.id === SHADOW_PLACEHOLDER_ITEM_ID ? [] : (item.children || []);
  $: depth = prefix ? prefix.split('.').length : 0;
  $: hasChildren = (item?.children || []).length > 0;
  $: selectionMode = selectedIds.size > 0;
  $: titlePlaceholder = prefix === '' ? $t('toc.new_chapter_default') : ($t('toc.new_item_default') || 'New Item');

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
    if (suppressNextRowClick) {
      suppressNextRowClick = false;
      return;
    }

    if (isSelectionBlockedTarget(event.target)) return;
    onSelect(item, event);
  }

  function handleRowMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    if (isSelectionBlockedTarget(event.target)) return;

    if (event.shiftKey) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    suppressNextRowClick = true;
    onSelectionDragStart(item, event);
  }

  function handleSelectionDotMouseDown(event: MouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      onSelect(item, event);
      return;
    }

    onSelectionDragStart(item, event);
  }

  function handleShiftSelectFromInput(event: MouseEvent) {
    if (!event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(item, event);
  }

  function getDndMarker(tocItem: TocItem) {
    return (tocItem as TocItem & Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME];
  }

  function getHighlightedParts(text: string, query: string) {
    if (!query) return [{text, matched: false}];

    const lowerText = text.toLowerCase();
    const firstMatchIndex = lowerText.indexOf(query);

    if (firstMatchIndex === -1) {
      return [{text, matched: false}];
    }

    const contextLength = 16;
    const start = Math.max(0, firstMatchIndex - contextLength);
    const end = Math.min(text.length, firstMatchIndex + query.length + contextLength);
    const displayText = `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
    const lowerDisplayText = displayText.toLowerCase();
    const parts: {text: string; matched: boolean}[] = [];
    let cursor = 0;
    let matchIndex = lowerDisplayText.indexOf(query);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        parts.push({text: displayText.slice(cursor, matchIndex), matched: false});
      }

      parts.push({text: displayText.slice(matchIndex, matchIndex + query.length), matched: true});
      cursor = matchIndex + query.length;
      matchIndex = lowerDisplayText.indexOf(query, cursor);
    }

    if (cursor < displayText.length) {
      parts.push({text: displayText.slice(cursor), matched: false});
    }

    return parts.length > 0 ? parts : [{text: displayText, matched: false}];
  }
</script>

{#if item}
  <div class="toc-node" style="--depth: {depth}">
    <div
      class="toc-row group/row relative flex h-9 items-center gap-1 rounded-md pl-1 pr-0.5"
      class:is-active={isActive}
      class:is-selected={isSelected}
      class:is-editing-title={isFocused}
      class:is-editing={isFocused || isPageFocused}
      class:is-root={depth === 0}
      class:selection-mode={selectionMode}
      data-is-dnd-shadow-item-hint={isShadowItem}
      data-toc-item-id={item.id}
      on:mouseenter={handleMouseEnter}
      on:mousedown={handleRowMouseDown}
      on:click={handleRowClick}
    >
      <!-- Drag handle + checkbox live in one column at the tree's left edge, whatever the depth. -->
      <div class="toc-gutter">
        <div
          data-drag-handle
          class="toc-handle"
          on:mousedown={enableDrag}
          on:touchstart={enableDrag}
          aria-hidden="true"
        >
          <GripVertical size={14} />
        </div>
        <button
          type="button"
          on:click|stopPropagation={(event) => {
            if (event.detail === 0) onSelect(item, event);
          }}
          on:mousedown={handleSelectionDotMouseDown}
          class="toc-check nb-check"
          aria-pressed={isSelected}
          title={$t('toc.select_item')}
          aria-label={$t('toc.select_item')}
        ></button>
      </div>

      <button
        type="button"
        on:click|stopPropagation={handleToggle}
        class="toc-caret"
        class:invisible={!hasChildren}
        aria-expanded={hasChildren ? Boolean(item.open) : undefined}
        title={$t('settings.toggle_expand')}
        aria-label={$t('settings.toggle_expand')}
        tabindex={hasChildren ? 0 : -1}
      >
        <ChevronRight size={14} strokeWidth={2.25} class="transition-transform duration-200 {item.open ? 'rotate-90' : ''}" />
      </button>

      {#if $tocConfig.prefixSettings.enabled}
        <span class="toc-number shrink-0 select-none text-xs tabular-nums text-gray-500" title={currentNumber}>{currentNumber}</span>
      {/if}

      <div class="toc-title-wrap" data-value={editTitle || titlePlaceholder}>
        {#if shouldHighlightTitle}
          <div class="toc-title-highlight" aria-hidden="true">
            {#each highlightedTitleParts as part}
              {#if part.matched}
                <mark class="rounded-sm bg-yellow-300 text-black">{part.text}</mark>
              {:else}
                <span>{part.text}</span>
              {/if}
            {/each}
          </div>
        {/if}
        <input
          type="text"
          size="1"
          bind:value={editTitle}
          on:mousedown={handleShiftSelectFromInput}
          on:focus={handleTitleFocus}
          on:blur={() => {
            isFocused = false;
            handleUpdateTitle();
          }}
          on:keydown={handleTitleKeydown}
          on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
          placeholder={titlePlaceholder}
          aria-label={titlePlaceholder}
          class="toc-field toc-item-title"
          class:is-highlighted={shouldHighlightTitle}
        />
      </div>

      <span class="toc-leader" aria-hidden="true"></span>

      <input
        type="number"
        bind:value={editPage}
        on:mousedown={handleShiftSelectFromInput}
        on:input={handlePageInput}
        on:focus={() => (isPageFocused = true)}
        on:blur={() => {
          isPageFocused = false;
          handleUpdatePage();
        }}
        on:keypress={(e) => e.key === 'Enter' && (e.target as HTMLElement).blur()}
        aria-label={$t('toc.page_number')}
        class="toc-field toc-page"
      />

      <div class="toc-actions">
        <button
          type="button"
          on:click={handleAddChild}
          class="toc-action"
          title={$t('toc.add_child')}
          aria-label={$t('toc.add_child')}
        >
          <Plus size={15} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          on:click={() => onDelete(item)}
          class="toc-action hover:!text-red-600"
          title={$t('toc.delete_item')}
          aria-label={$t('toc.delete_item')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>

    {#if item.open && nestedChildren.length > 0}
      <div
        class="toc-children"
        transition:slide={{duration: MOTION.base, easing: cubicOut}}
        use:dndzone={{
          items: nestedChildren,
          flipDurationMs,
          dragDisabled: $dragDisabled || Boolean(normalizedSearchQuery),
          dropTargetStyle: nestedChildren.length > 0 ? {outline: '2px dashed #000', outlineOffset: '2px', borderRadius: '6px'} : {},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
      >
        {#each nestedChildren as child, i (`${child.id}${getDndMarker(child) ? `_${getDndMarker(child)}` : ''}`)}
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
              {onSelectionDragStart}
              {selectedIds}
              {searchQuery}
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

<style>
  /* Rows read like the printed contents page: title · · · · page. Edit chrome appears on hover. */
  .toc-row {
    --row-bg: #fff;
    transition: background-color 120ms ease;
  }

  .toc-row:hover {
    --row-bg: #f5f5f4;
    background: var(--row-bg);
  }

  .toc-row.is-selected {
    --row-bg: #fef9c3;
    background: var(--row-bg);
  }

  .toc-row.is-active {
    --row-bg: #bfdbfe;
    background: var(--row-bg);
  }

  .toc-row.is-root .toc-field {
    font-weight: 500;
  }

  .toc-row.is-active .toc-field {
    font-weight: 700;
  }

  .toc-gutter {
    position: absolute;
    top: 0;
    left: calc(var(--depth) * -1 * var(--toc-indent, 20px) - var(--toc-gutter, 56px) + 2px);
    display: flex;
    align-items: center;
    height: 100%;
  }

  .toc-handle {
    display: grid;
    place-items: center;
    width: 16px;
    height: 26px;
    border-radius: 5px;
    color: #9ca3af;
    cursor: grab;
  }

  .toc-handle:hover {
    color: #000;
    background: rgb(0 0 0 / .06);
  }

  .toc-handle:active {
    cursor: grabbing;
  }

  /* Row tools float over the leader on hover, so titles keep the full width. */
  .toc-actions {
    position: absolute;
    top: 50%;
    right: calc(2.75rem + 6px);
    display: flex;
    align-items: center;
    padding-left: 18px;
    transform: translateY(-50%);
    background: linear-gradient(to right, transparent, var(--row-bg) 16px);
  }

  .toc-handle,
  .toc-check,
  .toc-actions {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .toc-check {
    margin-left: 1px;
  }

  .toc-actions {
    pointer-events: none;
  }

  .toc-row:hover .toc-actions,
  .toc-row:focus-within .toc-actions {
    pointer-events: auto;
  }

  .toc-row:hover .toc-handle,
  .toc-row:hover .toc-check,
  .toc-row:hover .toc-actions,
  .toc-row:focus-within .toc-actions,
  .toc-row:focus-within .toc-check,
  .toc-row.selection-mode .toc-check,
  .toc-row.is-selected .toc-check,
  .toc-check:focus-visible {
    opacity: 1;
  }

  /* While typing, nothing floats over the field: tools hide and the title takes the leader's room. */
  .toc-row.is-editing .toc-actions {
    opacity: 0;
    pointer-events: none;
  }

  .toc-row.is-editing-title .toc-title-wrap {
    flex: 1 1 auto;
  }

  .toc-row.is-editing-title > .toc-leader {
    display: none;
  }

  @media (hover: none) {
    .toc-handle,
    .toc-check,
    .toc-actions {
      opacity: 1;
      pointer-events: auto;
    }

    .toc-actions {
      position: static;
      padding-left: 0;
      transform: none;
      background: none;
    }

    .toc-row.is-editing .toc-actions {
      display: none;
    }
  }

  .toc-node .toc-node .toc-field,
  .toc-node .toc-node .toc-title-wrap::after,
  .toc-node .toc-node .toc-title-highlight {
    font-size: 13px;
  }

  .toc-caret {
    position: absolute;
    left: calc(-1 * var(--toc-indent, 20px));
    top: 50%;
    display: grid;
    place-items: center;
    width: 20px;
    height: 24px;
    margin-top: -12px;
    border-radius: 4px;
    color: #6b7280;
  }

  .toc-caret:hover {
    color: #000;
    background: rgb(0 0 0 / .06);
  }

  .toc-caret:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: -2px;
  }

  .toc-number {
    padding-left: 4px;
  }

  /* Auto-width title: the hidden copy in ::after sizes the grid cell to the text. */
  .toc-title-wrap {
    position: relative;
    display: inline-grid;
    flex: 0 1 auto;
    min-width: 4ch;
    max-width: 100%;
  }

  .toc-title-wrap::after,
  .toc-title-wrap > input {
    grid-area: 1 / 1;
  }

  .toc-title-wrap::after {
    content: attr(data-value) '  ';
    visibility: hidden;
    overflow: hidden;
    height: 0;
    padding: 0 8px;
    border: 1px solid transparent;
    font-size: 14px;
    white-space: pre;
  }

  .toc-row.is-root .toc-title-wrap::after {
    font-weight: 500;
  }

  .toc-field {
    --field-border-width: 1px;
    --field-border-color: transparent;
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 7px;
    border-radius: 6px !important;
    background: transparent;
    color: var(--ink);
    font-size: 14px;
    line-height: 24px;
    text-overflow: ellipsis;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .toc-field::placeholder {
    color: #9ca3af;
    font-weight: 400;
  }

  .toc-field:hover {
    --field-border-color: #d1d5db;
    background: #fff;
  }

  .toc-field:focus {
    background: #fff;
  }

  .toc-title-highlight {
    position: absolute;
    inset: 0;
    overflow: hidden;
    padding: 0 8px;
    font-size: 14px;
    line-height: 28px;
    white-space: nowrap;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  /* While search highlights a title, only the highlighted copy is visible. */
  .toc-field.is-highlighted {
    color: transparent;
    caret-color: #000;
  }

  .toc-row.is-root .toc-title-highlight {
    font-weight: 500;
  }

  /* Dots run on under the empty left part of the right-aligned number. */
  .toc-row > .toc-leader {
    margin-right: -10px;
  }

  .toc-page {
    position: relative;
    flex: none;
    width: 2.75rem;
    padding: 0 4px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .toc-page::-webkit-inner-spin-button,
  .toc-page::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
  }

  .toc-action {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    color: #6b7280;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms var(--ease-out-soft);
  }

  .toc-action:hover {
    color: #000;
    background: rgb(0 0 0 / .07);
  }

  .toc-action:active {
    transform: scale(.9);
  }

  .toc-action:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: -2px;
  }

  /* Nested level: indentation alone shows the hierarchy. */
  .toc-children {
    position: relative;
    margin-left: var(--toc-indent, 20px);
  }

  @media (prefers-reduced-motion: reduce) {
    .toc-row,
    .toc-field,
    .toc-check,
    .toc-actions {
      transition: none;
    }
  }
</style>
