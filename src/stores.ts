import {browser} from '$app/environment';
import { PDFService } from '$lib/pdf/service';
import { type LevelConfig, DEFAULT_PREFIX_CONFIG } from '$lib/utils/prefix';
import { type PageLabelSettings, createDefaultPageLabelSettings } from '$lib/pdf/page-labels';
import {get, writable} from 'svelte/store';

export type StyleConfig = {
  fontSize: number; dotLeader: string; color: string; lineSpacing: number;
};
export type TocConfig = {
  titleYStart?: number;
  insertAtPage: number; pageOffset: number; firstLevel: StyleConfig;
  otherLevels: StyleConfig;
  prefixSettings: {enabled: boolean; configs: LevelConfig[];};
  pageLabelSettings: PageLabelSettings;
  fontFamily?: 'hei' | 'song' | 'huiwen';
};

type TocSession = {
  items: any[]; pageOffset: number; updatedAt?: number;
};

export const maxPage = writable(0);
export const dragDisabled = writable(true);


export const tocItems = writable<any[]>([]);
export const curFileFingerprint = writable<string>('');
export const pdfService = writable(new PDFService());
export const tocConfig = writable<TocConfig>({
  prefixSettings: {
    enabled: false,
    configs: DEFAULT_PREFIX_CONFIG,
  },
  pageLabelSettings: createDefaultPageLabelSettings(),
  fontFamily: 'huiwen',
  pageOffset: 0,
  insertAtPage: 2,
  firstLevel: {
    fontSize: 11,
    dotLeader: '.',
    color: '#000000',
    lineSpacing: 1.7,
  },
  otherLevels: {
    fontSize: 10,
    dotLeader: '',
    color: '#333333',
    lineSpacing: 1.6,
  },
});

export const autoSaveEnabled = writable(true);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingDraft: {fingerprint: string; value: string | null} | null = null;

export function cancelTocDraftSave() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  pendingDraft = null;
}

export function flushTocDraft() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const draft = pendingDraft;
  pendingDraft = null;
  if (!browser || !draft) return;

  const key = `toc_draft_${draft.fingerprint}`;
  try {
    if (draft.value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, draft.value);
  } catch (error: any) {
    if (draft.value !== null && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)) {
      const drafts: {key: string; date: number}[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const otherKey = localStorage.key(i);
        if (!otherKey?.startsWith('toc_draft_') || otherKey === key) continue;
        try {
          drafts.push({key: otherKey, date: JSON.parse(localStorage.getItem(otherKey) || '{}').updatedAt || 0});
        } catch {
          drafts.push({key: otherKey, date: 0});
        }
      }
      drafts.sort((a, b) => a.date - b.date);
      for (const oldDraft of drafts) {
        localStorage.removeItem(oldDraft.key);
        try {
          localStorage.setItem(key, draft.value);
          return;
        } catch { /* Try the next oldest draft. */ }
      }
    }
    console.error('Failed to save session:', error);
  }
}

if (browser) {
  const saveSession = () => {
    if (!get(autoSaveEnabled)) return;
    const fingerprint = get(curFileFingerprint);
    if (!fingerprint) return;
    // Capture the book and its contents together, before another file can become active.
    if (pendingDraft && pendingDraft.fingerprint !== fingerprint) flushTocDraft();
    const items = get(tocItems);
    const session: TocSession = {
      items,
      pageOffset: get(tocConfig).pageOffset,
      updatedAt: Date.now(),
    };
    pendingDraft = {fingerprint, value: items.length ? JSON.stringify(session) : null};
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushTocDraft, 1000);
  };

  tocItems.subscribe(saveSession);
  tocConfig.subscribe(saveSession);
  autoSaveEnabled.subscribe((enabled) => {
    if (enabled) saveSession();
    else cancelTocDraftSave();
  });
  window.addEventListener('pagehide', flushTocDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTocDraft();
  });
}
