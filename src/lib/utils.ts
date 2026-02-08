import type {TocItem} from '$lib/pdf-service';
import type * as PdfjsLibTypes from 'pdfjs-dist';
import ShortUniqueId from 'short-unique-id';

export function findActiveTocPath(
  items: TocItem[],
  current: number,
  pageOffset: number,
  addPhysicalTocPage: boolean = false,
  tocPageCount: number = 0,
  insertAtPage: number = 2,
  currentPath: TocItem[] = []
): TocItem[] {
  let bestPath: TocItem[] = [];

  for (const item of items) {
    let itemPage = item.to + pageOffset;
    if (addPhysicalTocPage && itemPage >= insertAtPage) {
      itemPage += tocPageCount;
    }

    if (itemPage <= current) {
      const childPath = findActiveTocPath(
        item.children || [],
        current,
        pageOffset,
        addPhysicalTocPage,
        tocPageCount,
        insertAtPage,
        [...currentPath, item]
      );

      if (childPath.length > 0) {
        bestPath = childPath;
      } else {
        bestPath = [...currentPath, item];
      }
    } else {
      break;
    }
  }
  return bestPath;
}


export function buildTree(
    items: {title: string; level: number; page: number}[]): TocItem[] {
  const root: TocItem[] = [];
  const stack: {node: TocItem; level: number}[] = [];
  const uid = new ShortUniqueId({ length: 10 });

  items.forEach((item) => {
    const newItem: TocItem = {
      id: uid.randomUUID(),
      title: item.title,
      to: item.page,
      children: [],
      open: true,
    };
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

/**
 * 将 PDF.js 原生 Outline 转换为应用内的 TocItem 格式
 */
export async function convertPdfJsOutlineToTocItems(
    outline: any[], doc: PdfjsLibTypes.PDFDocumentProxy): Promise<TocItem[]> {
  const uid = new ShortUniqueId({ length: 10 });

  const processNode = async(node: any): Promise<TocItem> => {
    let pageNum = 1;

    try {
      let dest = node.dest;

      // 如果 dest 是字符串（Named Destination），先获取具体引用
      if (typeof dest === 'string') {
        dest = await doc.getDestination(dest);
      }

      // 如果 dest 是数组（常见情况），第一个元素通常是 Ref
      if (Array.isArray(dest) && dest.length > 0) {
        const ref = dest[0];
        if (ref) {
          const pageIndex = await doc.getPageIndex(ref);
          pageNum = pageIndex + 1;
        }
      }
    } catch (e) {
      console.warn('Failed to resolve page for outline item:', node.title, e);
    }

    const children = node.items && node.items.length > 0 ?
        await Promise.all(node.items.map(processNode)) :
        [];

    return {
      id: `imported-${ uid.randomUUID() }`,
      title: node.title,
      to: pageNum,
      children: children,
      open: false,
    };
  };

  return Promise.all(outline.map(processNode));
}


export function setNestedValue<T extends object>(obj: T, fieldPath: string, value: unknown): T {
  const keys = fieldPath.split('.');
  let target: Record<string, unknown> = obj as Record<string, unknown>;

  keys.slice(0, -1).forEach((key) => {
    target = target[key] as Record<string, unknown>;
  });

  target[keys[keys.length - 1]] = value;

  return obj;
}
