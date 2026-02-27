<script lang="ts">
  import {onDestroy, tick, createEventDispatcher} from 'svelte';
  import ShortUniqueId from 'short-unique-id';
  import {Sparkles, Loader2} from 'lucide-svelte';
  import {t} from 'svelte-i18n';
  import TocItem from './TocItem.svelte';
  import Tooltip from './Tooltip.svelte';
  import {tocItems, maxPage, autoSaveEnabled, dragDisabled, curFileFingerprint} from '../stores';

  import {dndzone} from 'svelte-dnd-action';
  import {flip} from 'svelte/animate';

  export let currentPage = 1;
  export let isPreview = false;
  export let pageOffset = 0;
  export let insertAtPage = 2;
  export let tocPageCount = 0;

  export let apiConfig = {provider: '', apiKey: ''};
  const dispatch = createEventDispatcher();

  const flipDurationMs = 200;

  let text = ``;
  let isUpdatingFromEditor = false;
  let isProcessing = false;
  let debounceTimer;

  // Undo/Redo State
  let historyStack = [];
  let futureStack = [];
  const maxHistory = 20;

  function saveHistory() {
    const clone = JSON.parse(JSON.stringify($tocItems));
    historyStack.push(clone);
    if (historyStack.length > maxHistory) {
      historyStack.shift();
    }
    futureStack = [];
    historyStack = historyStack; // update
  }

  function undo() {
    if (historyStack.length === 0) return;
    const current = JSON.parse(JSON.stringify($tocItems));
    futureStack.push(current);
    const prev = historyStack.pop();
    $tocItems = prev;
    historyStack = historyStack;
    futureStack = futureStack;
  }

  function redo() {
    if (futureStack.length === 0) return;
    const current = JSON.parse(JSON.stringify($tocItems));
    historyStack.push(current);
    const next = futureStack.pop();
    $tocItems = next;
    historyStack = historyStack;
    futureStack = futureStack;
  }

  function handleKeydown(e) {
    const tagName = e.target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) {
        e.preventDefault();
        redo();
      } else {
        e.preventDefault();
        undo();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }

  let isDragging = false;
  let textGenTimer;

  const unsubscribe = tocItems.subscribe((value) => {
    if (isUpdatingFromEditor) return;
    if (isDragging) return;

    clearTimeout(textGenTimer);
    textGenTimer = setTimeout(() => {
      const newText = generateText(value);
      if (newText !== text) {
        text = newText;
      }
    }, 300);
  });

  onDestroy(() => {
    unsubscribe();
    clearTimeout(textGenTimer);
    clearTimeout(debounceTimer);
  });

  $: if ($curFileFingerprint) {
    historyStack = [];
    futureStack = [];
  }

  function buildTree(items) {
    const root = [];
    const stack = [];
    const uid = new ShortUniqueId({length: 10});

    items.forEach((item) => {
      const newItem = {
        id: uid.randomUUID(),
        title: item.title,
        to: item.page,
        children: [],
        open: true,
      };

      if (item.page > $maxPage) $maxPage = item.page;

      const level = item.level;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(newItem);
      } else {
        const parent = stack[stack.length - 1].node;
        parent.children = parent.children || [];
        parent.children.push(newItem);
      }
      stack.push({node: newItem, level: level});
    });
    return root;
  }

  async function handleAiFormat() {
    if (!text.trim()) return;

    const MAX_TEXT_SIZE = 128 * 1024;
    const byteSize = new TextEncoder().encode(text).length;

    if (byteSize > MAX_TEXT_SIZE) {
      throw new Error(`Text content is too large. Limit is 128KB.`);
    }

    isProcessing = true;
    const response = await fetch('/api/process-toc', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        text: text,
        apiKey: apiConfig.apiKey,
        provider: apiConfig.provider,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || 'AI processing failed');
    }

    const aiResult = await response.json();
    isProcessing = false;

    if (Array.isArray(aiResult) && aiResult.length > 0) {
      saveHistory();
      $tocItems = buildTree(aiResult);
    } else {
      throw new Error('AI could not parse any ToC structure.');
    }
  }

  function parseText(text) {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const items = [];
    const stack = [{level: 0, item: {children: items}}];
    const uid = new ShortUniqueId({length: 10});

    lines.forEach((line) => {
      const match = line.match(/^(\d+(?:\.\d+)*)\s+(.+?)\s+(-?\d+)$/);
      if (match) {
        const [, number, title, pageStr] = match;
        const level = number.split('.').length;
        const page = parseInt(pageStr);

        const newItem = {
          id: uid.randomUUID(),
          title,
          to: page,
          children: [],
          open: true,
        };

        if (page > $maxPage) $maxPage = page;

        while (stack[stack.length - 1].level >= level) stack.pop();
        stack[stack.length - 1].item.children.push(newItem);
        stack.push({level, item: newItem});
      }
    });
    return items;
  }

  function generateText(items, prefix = '') {
    return items
      .map((item, index) => {
        const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
        let txt = `${number} ${item.title} ${item.to}`;
        if (item.children?.length) txt += '\n' + generateText(item.children, number);
        return txt;
      })
      .join('\n');
  }

  function handleInput(e) {
    isUpdatingFromEditor = true;
    text = e.target.value;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const parsed = parseText(text);
      if (parsed.length > 0) {
        $tocItems = parsed;
      }
      tick().then(() => {
        isUpdatingFromEditor = false;
      });
    }, 300);
  }

  const handleDragStart = () => {
    if (!isDragging) {
      saveHistory();
      $autoSaveEnabled = false;
      isDragging = true;
    }
  };

  const handleDragEnd = () => {
    tick().then(() => {
      isDragging = false;
      const newText = generateText($tocItems);
      if (newText !== text) text = newText;
      $autoSaveEnabled = true;
    });
  };

  function handleMouseUp() {
    $dragDisabled = true;
  }

  function handleDndConsider(e) {
    handleDragStart();
    $tocItems = e.detail.items;
  }

  function handleDndFinalize(e) {
    $tocItems = e.detail.items;
    handleDragEnd();
  }

  $: firstItemWithChildrenId = (() => {
    const findFirst = (items) => {
      for (const item of items) {
        if (item.children?.length > 0) return item.id;
        if (item.children) {
          const childResult = findFirst(item.children);
          if (childResult) return childResult;
        }
      }
      return null;
    };
    return findFirst($tocItems);
  })();

  const addMultipleTocItems = (count) => {
    saveHistory();
    const currentItems = $tocItems;
    let startPage;

    if (currentItems.length > 0) {
      startPage = Math.max(...currentItems.map((i) => i.to)) + 1;
    } else {
      startPage = ($maxPage || 0) + 1;
    }

    const uid = new ShortUniqueId({length: 10});
    const newItems = Array.from({length: count}, (_, i) => ({
      id: uid.randomUUID(),
      title: $t('toc.new_section_default'),
      to: startPage + i,
      children: [],
      open: true,
    }));

    $tocItems = [...currentItems, ...newItems];
  };

  const addTocItem = () => {
    addMultipleTocItems(1);
  };

  const updateTocItem = (item, updates, skipHistory = false) => {
    if (!skipHistory) {
      saveHistory();
    }
    const updateItemRecursive = (items) =>
      items.map((currentItem) => {
        if (currentItem.id === item.id) return {...currentItem, ...updates};
        if (currentItem.children?.length) {
          return {...currentItem, children: updateItemRecursive(currentItem.children)};
        }
        return currentItem;
      });
    $tocItems = updateItemRecursive($tocItems);
  };

  const deleteTocItem = (itemToDelete) => {
    saveHistory();
    const deleteItemRecursive = (items) =>
      items.filter((item) => {
        if (item.id === itemToDelete.id) return false;
        if (item.children?.length) item.children = deleteItemRecursive(item.children);
        return true;
      });
    $tocItems = deleteItemRecursive($tocItems);
  };

  const TOC_REGEX = /^(\d+(?:\.\d+)*)\s+(.+?)\s+(-?\d+)$/;

  $: hasInvalidLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => !TOC_REGEX.test(line));

  $: promptTooltipText = $t('toc.prompt_intro');
  let innerWidth: number;
</script>

<svelte:window
  on:keydown={handleKeydown}
  on:mouseup={handleMouseUp}
  on:touchend={handleMouseUp}
  bind:innerWidth
/>

<div class="flex flex-col gap-4 mt-3">
  <div class="h-48 relative group">
    <textarea
      bind:value={text}
      on:input={handleInput}
      class="w-full h-full border-2 border-black rounded-lg p-2 text-sm myfocus leading-6 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none pr-10"
    ></textarea>

    {#if hasInvalidLines}
      <div class="absolute bottom-3 right-3">
        <Tooltip
          isTextCopiable
          width="md:w-[350px] w-[250px]"
          text={promptTooltipText}
          position={innerWidth < 1024 ? '-200 -500' : '100 -600'}
        >
          <button
            on:click={handleAiFormat}
            disabled={isProcessing || !text.trim()}
            class="flex items-center gap-1.5 bg-gradient-to-br from-blue-300 to-pink-600 text-white px-3 py-1.5 rounded-md shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
          >
            {#if isProcessing}
              <Loader2
                size={16}
                class="animate-spin"
              />
              <span class="text-xs font-bold">Processing...</span>
            {:else}
              <Sparkles size={16} />
              <span class="text-xs font-bold">AI Format</span>
            {/if}
          </button>
        </Tooltip>
      </div>
    {/if}
  </div>

  <div class="-ml-8">
    {#if $tocItems.length > 0}
      <section
        use:dndzone={{
          items: $tocItems,
          flipDurationMs,
          dragDisabled: $dragDisabled,
          dropTargetStyle: {outline: '2px dashed #000', borderRadius: '8px'},
        }}
        on:consider={handleDndConsider}
        on:finalize={handleDndFinalize}
        class="min-h-[20px]"
      >
        {#each $tocItems as item, i (item.id)}
          <div animate:flip={{duration: flipDurationMs}}>
            <TocItem
              {item}
              showTooltip={item.id === firstItemWithChildrenId}
              onUpdate={updateTocItem}
              onDelete={deleteTocItem}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              {currentPage}
              {isPreview}
              {pageOffset}
              {insertAtPage}
              {tocPageCount}
              on:hoveritem
              on:jumpToPage={(e) => {
                dispatch('jumpToPage', e.detail);
              }}
              index={i + 1}
            />
          </div>
        {/each}
      </section>
    {/if}

    <div class="flex items-center gap-2 ml-9 mt-3 mb-4">
      <button
        on:click={addTocItem}
        class="btn font-bold bg-yellow-400 text-black border-2 border-black rounded-lg px-4 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[4px] hover:translate-y-[4px] transition-all"
      >
        {$t('btn.add_section')}
      </button>
      <button
        on:click={() => addMultipleTocItems(5)}
        class="btn font-bold bg-gray-100 text-black border-2 border-black rounded-lg px-3 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm"
      >
        +5
      </button>
      <button
        on:click={() => addMultipleTocItems(10)}
        class="btn font-bold bg-gray-100 text-black border-2 border-black rounded-lg px-3 py-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all text-sm"
      >
        +10
      </button>
    </div>
  </div>
</div>
