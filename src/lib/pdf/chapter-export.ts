import type {TocItem} from './service';

export type ExportableChapter = {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  hasChildren: boolean;
  startPage: number;
  endPage: number;
};

function flattenTocItemsForExport(
  items: TocItem[],
  level = 1,
  parentId: string | null = null,
): Array<TocItem & {level: number; parentId: string | null; hasChildren: boolean}> {
  return items.flatMap((item) => [
    {...item, level, parentId, hasChildren: (item.children || []).length > 0},
    ...flattenTocItemsForExport(item.children || [], level + 1, item.id),
  ]);
}

function clampPage(page: number, totalPages: number) {
  return Math.min(totalPages, Math.max(1, page));
}

function sanitizeFilenamePart(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getBaseFilename(filename: string) {
  return filename.toLowerCase().endsWith('.pdf') ? filename.slice(0, -4) : filename;
}

export function findTocItemById(items: TocItem[], id: string): TocItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const childMatch = findTocItemById(item.children || [], id);
    if (childMatch) return childMatch;
  }
  return null;
}

export function filterSelectedChapterRoots(
  chapters: ExportableChapter[],
  allChapters: ExportableChapter[],
) {
  const selectedIdSet = new Set(chapters.map((chapter) => chapter.id));
  return chapters.filter((chapter) => {
    let currentParentId = chapter.parentId;
    while (currentParentId) {
      if (selectedIdSet.has(currentParentId)) {
        return false;
      }
      currentParentId = allChapters.find((item) => item.id === currentParentId)?.parentId ?? null;
    }
    return true;
  });
}

export function buildChapterExportItems(
  items: TocItem[],
  pageOffset: number,
  totalPages: number,
  untitledLabel: string,
): ExportableChapter[] {
  if (totalPages <= 0) return [];

  const flatItems = flattenTocItemsForExport(items);

  return flatItems.map((item, index) => {
    const startPage = clampPage(item.to + pageOffset, totalPages);
    let endPage = totalPages;

    for (let nextIndex = index + 1; nextIndex < flatItems.length; nextIndex += 1) {
      if (flatItems[nextIndex].level <= item.level) {
        endPage = Math.max(
          startPage,
          clampPage(flatItems[nextIndex].to + pageOffset - 1, totalPages),
        );
        break;
      }
    }

    return {
      id: item.id,
      title: item.title?.trim() || `${untitledLabel} ${index + 1}`,
      level: item.level,
      parentId: item.parentId,
      hasChildren: item.hasChildren,
      startPage,
      endPage,
    };
  });
}

export function getChapterFilename(baseFilename: string, chapter: ExportableChapter) {
  const baseName = getBaseFilename(baseFilename || 'document');
  const titlePart = sanitizeFilenamePart(chapter.title) || 'chapter';
  return `${baseName}_${titlePart}_p${chapter.startPage}-${chapter.endPage}.pdf`;
}

export function getMergedChapterFilename(baseFilename: string, chapters: ExportableChapter[]) {
  if (chapters.length === 1) {
    return getChapterFilename(baseFilename, chapters[0]);
  }

  return `${getBaseFilename(baseFilename || 'document')}_chapters.pdf`;
}

export function getChapterArchiveFilename(baseFilename: string, chapters: ExportableChapter[]) {
  if (chapters.length === 1) {
    const baseName = getBaseFilename(getChapterFilename(baseFilename, chapters[0]));
    return `${baseName}.zip`;
  }

  return `${getBaseFilename(baseFilename || 'document')}_chapters.zip`;
}

export function mergeChapterRanges(chapters: ExportableChapter[]) {
  const ranges = chapters
    .map((chapter) => ({startPage: chapter.startPage, endPage: chapter.endPage}))
    .sort((a, b) => a.startPage - b.startPage);

  return ranges.reduce<Array<{startPage: number; endPage: number}>>((merged, range) => {
    const lastRange = merged[merged.length - 1];
    if (!lastRange || range.startPage > lastRange.endPage + 1) {
      merged.push({...range});
    } else {
      lastRange.endPage = Math.max(lastRange.endPage, range.endPage);
    }
    return merged;
  }, []);
}

export function createPageMapForRanges(ranges: Array<{startPage: number; endPage: number}>) {
  const pageMap = new Map<number, number>();
  let nextExportedPage = 1;

  for (const range of ranges) {
    for (let sourcePage = range.startPage; sourcePage <= range.endPage; sourcePage += 1) {
      if (!pageMap.has(sourcePage)) {
        pageMap.set(sourcePage, nextExportedPage);
        nextExportedPage += 1;
      }
    }
  }

  return pageMap;
}

export function buildOutlineTreeForExport(
  item: TocItem,
  pageMap: Map<number, number>,
  pageOffset: number,
): TocItem | null {
  const sourcePage = item.to + pageOffset;
  const exportedPage = pageMap.get(sourcePage);
  if (!exportedPage) return null;

  const children = (item.children || [])
    .map((child) => buildOutlineTreeForExport(child, pageMap, pageOffset))
    .filter(Boolean) as TocItem[];

  return {
    ...item,
    to: exportedPage,
    children,
    open: true,
  };
}
