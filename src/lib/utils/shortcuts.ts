import {writable} from 'svelte/store';

/** Whether the keyboard shortcuts dialog is open. */
export const shortcutsOpen = writable(false);

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

/** Label for the platform's command key. */
export const modKey = isMac ? '⌘' : 'Ctrl';

/** ⌘ on macOS, Ctrl elsewhere — either is accepted so muscle memory from both works. */
export function hasMod(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

/** A modal dialog owns the keyboard while it is open. */
export function isDialogOpen() {
  return typeof document !== 'undefined' && Boolean(document.querySelector('[aria-modal="true"]'));
}

/** Plain keys (no modifiers except Shift) that should not fire while typing or under a dialog. */
export function isBareKey(event: KeyboardEvent) {
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Commit whatever field is being edited (titles save on blur) before a global action runs. */
export function blurActiveField() {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (active instanceof HTMLElement && isEditableTarget(active)) active.blur();
}
