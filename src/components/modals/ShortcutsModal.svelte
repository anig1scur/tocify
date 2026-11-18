<script lang="ts">
  import {t} from 'svelte-i18n';
  import {page} from '$app/stores';
  import {Keyboard} from 'lucide-svelte';
  import Modal from './Modal.svelte';
  import {shortcutsOpen, modKey, isEditableTarget, isDialogOpen, isBareKey} from '$lib/utils/shortcuts';

  /** One row: a description and its key combos; several combos read as alternatives. */
  type Row = {label: string; keys: string[][]};
  type Group = {title: string; rows: Row[]};

  const M = modKey;

  $: isOcr = $page.url.pathname.startsWith('/ocr');

  $: generalRows = [
    {label: 'shortcuts.show', keys: [['/']]},
    {label: 'shortcuts.open_pdf', keys: [[M, 'O']]},
    ...(isOcr
      ? [
          {label: 'shortcuts.ocr_run', keys: [[M, '↩']]},
          {label: 'shortcuts.ocr_export', keys: [[M, 'S']]},
        ]
      : [
          {label: 'shortcuts.export_pdf', keys: [[M, 'S']]},
          {label: 'shortcuts.export_chapters', keys: [[M, '⇧', 'S']]},
          {label: 'shortcuts.generate', keys: [[M, '↩']]},
          {label: 'shortcuts.toggle_preview', keys: [['P']]},
        ]),
    {label: 'shortcuts.escape', keys: [['Esc']]},
  ];

  $: tocRows = [
    {label: 'shortcuts.toc_search', keys: [[M, 'F']]},
    {label: 'shortcuts.toc_select_all', keys: [[M, 'A']]},
    {label: 'shortcuts.toc_move', keys: [['↑'], ['↓']]},
    {label: 'shortcuts.toc_extend', keys: [['⇧', '↑'], ['⇧', '↓']]},
    {label: 'shortcuts.toc_fold', keys: [['←'], ['→']]},
    {label: 'shortcuts.toc_edit', keys: [['↩']]},
    {label: 'shortcuts.toc_indent', keys: [['Tab'], ['⇧', 'Tab']]},
    {label: 'shortcuts.toc_page_step', keys: [['↑'], ['⇧', '↑']]},
    {label: 'shortcuts.toc_delete', keys: [['⌫']]},
    {label: 'shortcuts.undo_redo', keys: [[M, 'Z'], [M, '⇧', 'Z']]},
  ];

  $: ocrRows = [
    {label: 'shortcuts.ocr_line', keys: [['↑'], ['↓']]},
    {label: 'shortcuts.ocr_edit_line', keys: [['↩']]},
    {label: 'shortcuts.ocr_delete_line', keys: [['⌫']]},
    {label: 'shortcuts.undo_redo', keys: [[M, 'Z'], [M, '⇧', 'Z']]},
  ];

  $: previewRows = [
    {label: 'shortcuts.preview_page', keys: [['←'], ['→']]},
    ...(isOcr ? [] : [{label: 'shortcuts.preview_ends', keys: [['Home'], ['End']]}]),
    {label: 'shortcuts.preview_zoom', keys: [['+'], ['−'], ['0']]},
  ];

  $: dialogRows = [
    {label: 'shortcuts.dialog_confirm', keys: [[M, '↩']]},
    {label: 'shortcuts.dialog_erase_undo', keys: [[M, 'Z']]},
    {label: 'shortcuts.dialog_offset', keys: [['←'], ['→'], ['↩']]},
  ];

  $: groups = (
    isOcr
      ? [
          {title: 'shortcuts.group_general', rows: generalRows},
          {title: 'shortcuts.group_ocr', rows: ocrRows},
          {title: 'shortcuts.group_preview', rows: previewRows},
        ]
      : [
          {title: 'shortcuts.group_general', rows: generalRows},
          {title: 'shortcuts.group_toc', rows: tocRows},
          {title: 'shortcuts.group_preview', rows: previewRows},
          {title: 'shortcuts.group_dialogs', rows: dialogRows},
        ]
  ) as Group[];

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing) return;
    // Esc in a plain field (settings, page ranges, OCR text) leaves it. The ToC tree handles its own fields.
    if (
      e.key === 'Escape' &&
      e.target instanceof HTMLElement &&
      isEditableTarget(e.target) &&
      !e.target.closest('.toc-tree') &&
      !isDialogOpen()
    ) {
      e.target.blur();
      return;
    }
    // "/" (or "?", the same key with Shift) opens the list — never while typing, so a slash in a field stays a slash.
    if ($shortcutsOpen || (e.key !== '/' && e.key !== '?')) return;
    if (!isBareKey(e) || isEditableTarget(e.target) || isDialogOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    shortcutsOpen.set(true);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<Modal
  open={$shortcutsOpen}
  title={$shortcutsOpen ? $t('shortcuts.title') : ''}
  closeLabel={$shortcutsOpen ? $t('chapter_export.close') : ''}
  accent="white"
  size="lg"
  on:close={() => shortcutsOpen.set(false)}
  on:submit={() => shortcutsOpen.set(false)}
>
  <svelte:fragment slot="icon"><Keyboard size={18} strokeWidth={2.25} /></svelte:fragment>

  <div class="shortcut-groups min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
    {#each groups as group (group.title)}
      <section class="shortcut-group">
        <h3 class="mb-1.5 text-sm font-bold text-black">{$t(group.title)}</h3>
        <dl>
          {#each group.rows as row (row.label)}
            <div class="shortcut-row">
              <dt class="min-w-0 text-[13px] leading-5 text-gray-700">{$t(row.label)}</dt>
              <dd class="flex shrink-0 items-center gap-1">
                {#each row.keys as combo, comboIndex}
                  {#if comboIndex > 0}<span class="px-0.5 text-xs text-gray-400">/</span>{/if}
                  <span class="flex items-center gap-0.5">
                    {#each combo as key}
                      <kbd>{key}</kbd>
                    {/each}
                  </span>
                {/each}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>

  <svelte:fragment slot="footer">
    <p class="text-xs leading-5 text-gray-500">{$t('shortcuts.typing_note')}</p>
  </svelte:fragment>
</Modal>

<style>
  .shortcut-groups {
    display: grid;
    gap: 20px 32px;
  }

  @media (min-width: 768px) {
    .shortcut-groups {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    border-bottom: 1px solid var(--divider);
  }

  .shortcut-row:last-child {
    border-bottom: 0;
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid #d1d5db;
    border-bottom-width: 2px;
    border-radius: 5px;
    background: #fff;
    color: #000;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }
</style>
