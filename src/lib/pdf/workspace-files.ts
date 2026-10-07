import {writable} from 'svelte/store';

export const workspacePdfFiles = writable<{toc: File | null; ocr: File | null}>({
  toc: null,
  ocr: null,
});
