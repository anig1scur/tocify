import {browser} from '$app/environment';
import {PDFService} from '$lib/pdf-service';
import {DEFAULT_PREFIX_CONFIG, type LevelConfig} from '$lib/prefix-service';
import {get, writable} from 'svelte/store';

export type StyleConfig = {
  fontSize: number; dotLeader: string; color: string; lineSpacing: number;
};
export type TocConfig = {
  titleYStart?: number;
  insertAtPage: number; pageOffset: number; firstLevel: StyleConfig;
  otherLevels: StyleConfig;
  prefixSettings: {enabled: boolean; configs: LevelConfig[];};
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

if (browser) {
  let saveTimer: ReturnType<typeof setTimeout>;
  const saveSession = () => {
    if (!get(autoSaveEnabled)) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const fingerprint = get(curFileFingerprint);
      const items = get(tocItems);

      if (fingerprint) {
        if (items.length > 0) {
          const config = get(tocConfig);
          const session: TocSession = {
            items,
            pageOffset: config.pageOffset,
            updatedAt: Date.now(),
          };
          try {
            localStorage.setItem(`toc_draft_${ fingerprint }`, JSON.stringify(session));
          } catch (e: any) {
            if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
              // Storage full, try to clear old drafts
              try {
                const drafts: { key: string; date: number }[] = [];
                for (let i = 0;i < localStorage.length;i++) {
                  const key = localStorage.key(i);
                  if (key && key.startsWith('toc_draft_') && key !== `toc_draft_${ fingerprint }`) {
                    try {
                      const val = JSON.parse(localStorage.getItem(key) || '{}');
                      drafts.push({ key, date: val.updatedAt || 0 });
                    } catch {
                      drafts.push({ key, date: 0 });
                    }
                  }
                }

                // Sort by oldest first
                drafts.sort((a, b) => a.date - b.date);

                // Delete oldest until we have space or no more drafts
                while (drafts.length > 0) {
                  const toDelete = drafts.shift();
                  if (toDelete) localStorage.removeItem(toDelete.key);

                  try {
                    localStorage.setItem(`toc_draft_${ fingerprint }`, JSON.stringify(session));
                    // If success, break loop
                    return;
                  } catch (retryErr) {
                    // Still full, continue deleting
                  }
                }
              } catch (cleanupErr) {
                console.error('Failed to cleanup storage:', cleanupErr);
              }
            }
            console.error('Failed to save session:', e);
          }
        } else {
          // Clear storage if items are empty
          localStorage.removeItem(`toc_draft_${ fingerprint }`);
        }
      }
    }, 1000); // 1s debounce
  };

  tocItems.subscribe(saveSession);
  tocConfig.subscribe(saveSession);
}