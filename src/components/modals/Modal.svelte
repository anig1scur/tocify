<script lang="ts">
  import {createEventDispatcher, onDestroy, tick} from 'svelte';
  import {fade} from 'svelte/transition';
  import {X} from 'lucide-svelte';
  import {lift, MOTION} from '$lib/utils/motion';

  /** Shared frame for every dialog: same backdrop, border, shadow, header, footer tray and motion. */
  export let open = false;
  export let title = '';
  export let subtitle = '';
  export let closeLabel = 'Close';
  export let size: 'sm' | 'md' | 'lg' | 'xl' = 'md';
  /** Fixed-height dialogs (editors) fill most of the viewport; others size to content. */
  export let tall = false;
  /** Explicit height utility, e.g. 'h-[min(82dvh,680px)]'; overrides `tall`. */
  export let heightClass = '';
  /** paper: dotted paper wash for tools; lime / yellow: the app's full-bleed moments. */
  export let backdrop: 'paper' | 'lime' | 'yellow' = 'paper';
  /** Fill of the square icon tag next to the title. */
  export let accent: 'yellow' | 'green' | 'blue' | 'lime' | 'white' = 'yellow';
  export let closeOnBackdrop = true;
  export let bodyClass = '';
  export let labelledBy = '';

  const dispatch = createEventDispatcher<{close: void; submit: void}>();
  const titleId = `dialog-title-${Math.random().toString(36).slice(2, 9)}`;

  let panel: HTMLDivElement;
  let returnFocusTo: HTMLElement | null = null;
  let wasOpen = false;
  let previousOverflow = '';

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-5xl',
  };

  const accentClass = {
    yellow: 'bg-yellow-400',
    green: 'bg-green-500',
    blue: 'bg-blue-400',
    lime: 'bg-lime-400',
    white: 'bg-white',
  };

  const backdropClass = {
    paper: 'bg-black/40 backdrop-blur-sm',
    lime: 'bg-lime-400',
    yellow: 'bg-yellow-400',
  };

  $: syncOpenState(open);

  async function syncOpenState(isOpen: boolean) {
    if (typeof document === 'undefined' || isOpen === wasOpen) return;
    wasOpen = isOpen;

    if (isOpen) {
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      await tick();
      panel?.focus({preventScroll: true});
    } else {
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.({preventScroll: true});
      returnFocusTo = null;
    }
  }

  onDestroy(() => {
    if (wasOpen && typeof document !== 'undefined') {
      document.body.style.overflow = previousOverflow;
    }
  });

  export function close() {
    dispatch('close');
    open = false;
  }

  /** Esc closes; ⌘/Ctrl + Enter fires the dialog's primary action (`on:submit`). */
  function handleKeydown(event: KeyboardEvent) {
    if (!open || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      dispatch('submit');
    }
  }

  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 {backdropClass[backdrop]}"
    transition:fade={{duration: MOTION.base}}
    on:click|self={() => closeOnBackdrop && close()}
    role="presentation"
  >
    <div
      bind:this={panel}
      class="dialog-panel relative flex w-full flex-col overflow-hidden rounded-xl border-2 border-black bg-white outline-none {sizeClass[size]} {heightClass || (tall ? 'h-[min(90dvh,860px)]' : 'max-h-[90dvh]')}"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy || titleId}
      tabindex="-1"
      in:lift
      out:lift={{duration: MOTION.base, direction: 'out'}}
      on:keydown={trapFocus}
    >
      <header class="flex shrink-0 items-center gap-3 border-b border-[color:var(--divider)] px-4 py-3 sm:px-5">
        {#if $$slots.icon}
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md border-2 border-black text-black {accentClass[accent]}" aria-hidden="true">
            <slot name="icon" />
          </span>
        {/if}
        <div class="min-w-0 flex-1">
          <h2 id={titleId} class="truncate text-lg font-bold leading-6 text-black">{title}</h2>
          {#if subtitle}
            <p class="truncate text-xs leading-5 text-gray-500">{subtitle}</p>
          {/if}
        </div>
        <slot name="header-extra" />
        <button
          type="button"
          class="nb-icon-btn"
          on:click={close}
          title="{closeLabel} (Esc)"
          aria-label={closeLabel}
        >
          <X size={18} />
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col {bodyClass}">
        <slot />
      </div>

      {#if $$slots.footer}
        <footer class="flex shrink-0 flex-wrap items-center gap-2 border-t border-[color:var(--divider)] bg-[#f9f8f5] px-4 py-3 sm:px-5">
          <slot name="footer" />
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dialog-panel {
    box-shadow: none;
  }
</style>
