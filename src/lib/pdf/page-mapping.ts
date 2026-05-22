export type PageMappingMode =
  | 'single'
  | 'two_up_side_by_side_left_first'
  | 'two_up_side_by_side_right_first';

export const DEFAULT_PAGE_MAPPING_MODE: PageMappingMode = 'single';

export function normalizePageMappingMode(value: unknown): PageMappingMode {
  if (
    value === 'two_up_side_by_side' ||
    value === 'two_up_side_by_side_left_first' ||
    value === 'two_up_side_by_side_right_first' ||
    value === 'two_up_vertical_top_first' ||
    value === 'two_up_vertical_bottom_first'
  ) {
    return value === 'two_up_side_by_side_right_first'
      ? 'two_up_side_by_side_right_first'
      : 'two_up_side_by_side_left_first';
  }

  return DEFAULT_PAGE_MAPPING_MODE;
}

export function getMappedSheetPage(
  logicalPage: number,
  mode: PageMappingMode = DEFAULT_PAGE_MAPPING_MODE,
): number {
  const rawPage = Math.trunc(Number(logicalPage) || 1);

  if (mode === 'single') return rawPage;

  if (mode === 'two_up_side_by_side_right_first') {
    return Math.floor(rawPage / 2) + 1;
  }

  return Math.ceil(rawPage / 2);
}

export function getPhysicalPageNumber(
  logicalPage: number,
  pageOffset = 0,
  mode: PageMappingMode = DEFAULT_PAGE_MAPPING_MODE,
): number {
  return getMappedSheetPage(logicalPage, mode) + Math.trunc(Number(pageOffset) || 0);
}

export function getPageJumpTarget(
  logicalPage: number,
  pageOffset = 0,
  mode: PageMappingMode = DEFAULT_PAGE_MAPPING_MODE,
) : { pageNumber: number } {
  return { pageNumber: getPhysicalPageNumber(logicalPage, pageOffset, mode) };
}

export function getPageOffsetForTarget(
  logicalPage: number,
  physicalPage: number,
  mode: PageMappingMode = DEFAULT_PAGE_MAPPING_MODE,
): number {
  return Math.trunc(Number(physicalPage) || 1) - getMappedSheetPage(logicalPage, mode);
}

export function getLogicalPageForPhysicalTarget(
  physicalPage: number,
  pageOffset = 0,
  mode: PageMappingMode = DEFAULT_PAGE_MAPPING_MODE,
): number {
  const mappedPage = Math.trunc(Number(physicalPage) || 1) - Math.trunc(Number(pageOffset) || 0);

  if (mode === 'single') return mappedPage;

  if (mode === 'two_up_side_by_side_right_first') {
    return mappedPage === 1 ? 1 : mappedPage * 2 - 2;
  }

  return mappedPage * 2 - 1;
}

export function getPreviewTargetPage(
  logicalPage: number,
  options?: {
    pageOffset?: number;
    pageMappingMode?: PageMappingMode;
    tocPageCount?: number;
    insertAtPage?: number;
    addPhysicalTocPage?: boolean;
  },
): number {
  const pageOffset = options?.pageOffset ?? 0;
  const pageMappingMode = options?.pageMappingMode ?? DEFAULT_PAGE_MAPPING_MODE;
  const physicalPage = getPhysicalPageNumber(logicalPage, pageOffset, pageMappingMode);

  if (!options?.addPhysicalTocPage) return physicalPage;

  const insertAtPage = options?.insertAtPage ?? 2;
  const tocPageCount = options?.tocPageCount ?? 0;

  return physicalPage >= insertAtPage ? physicalPage + tocPageCount : physicalPage;
}