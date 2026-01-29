// from
// https://github.com/marp-team/marp-cli/blob/9e0eff5f9d9530577458e93769cd2b0000958a7d/src/utils/pdf.ts
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type {PDFDocument, PDFRef} from 'pdf-lib';
// Use pre-bundled pdf-lib to avoid circular dependency warning. pdf-lib as an
// external dependency will make failure in the standalone binary.
// @see https://github.com/marp-team/marp-cli/issues/373
import {PDFHexString, PDFName, PDFString} from 'pdf-lib';

// --- Outline ---

type PDFOutlineTo =
    // | string
    number|[pageIndex: number, xPercentage: number, yPercentage: number];

export interface PDFOutlineItem {
  title: string;
  to: PDFOutlineTo;
  italic?: boolean;
  bold?: boolean;
}

export interface PDFOutlineItemWithChildren extends Omit<PDFOutlineItem, 'to'> {
  to?: PDFOutlineTo;
  children: PDFOutline[];
  open: boolean;
}

export type PDFOutline = PDFOutlineItem|PDFOutlineItemWithChildren;

const walk = (
    outlines: readonly PDFOutline[],
    callback: (outline: PDFOutline) =>
        void|boolean  // stop walking to children if returned false
    ) => {
  for (const outline of outlines) {
    const ret = callback(outline);
    if ('children' in outline && ret !== false)
      walk(outline.children, callback);
  }
};

const flatten = (outlines: readonly PDFOutline[]) => {
  const result: PDFOutline[] = [];

  walk(outlines, (outline) => void result.push(outline));
  return result;
};

const getOpeningCount = (outlines: readonly PDFOutline[]) => {
  let count = 0;

  walk(outlines, (outline) => {
    count += 1;
    return !('open' in outline && !outline.open);
  });

  return count;
};

export const setOutline = async (
    doc: PDFDocument, outlines: readonly PDFOutline[],
    pageNumberingOffset: number, addedPagesCount: number

    ) => {
  const rootRef = doc.context.nextRef();
  const refMap = new WeakMap<PDFOutline, PDFRef>();

  for (const outline of flatten(outlines)) {
    refMap.set(outline, doc.context.nextRef());
  }

  const pageRefs = (() => {
    const refs: PDFRef[] = [];

    doc.catalog.Pages().traverse((kid, ref) => {
      if (kid.get(kid.context.obj('Type'))?.toString() === '/Page') {
        refs.push(ref);
      }
    });

    return refs;
  })();

  const getFinalPageIndex = (labeledPageNum: number): number => {
    // 1. Start with the labeled page number (e.g., "1" from the ToC)
    // 2. Add the user-confirmed offset (e.g., physical page 5 is labeled "1" ->
    // offset is 4)
    // 3. Add the number of new physical ToC pages we inserted at the front
    const finalPageNum = labeledPageNum + pageNumberingOffset + addedPagesCount;

    // Convert 1-based page number to 0-based index
    const finalIndex = Math.max(0, finalPageNum - 1);

    // Clamp the index to be within the valid range of the document's pages
    return Math.min(finalIndex, pageRefs.length - 1);
  };

  const createOutline = (outlines: readonly PDFOutline[], parent: PDFRef) => {
    const {length} = outlines;

    for (let i = 0; i < length; i += 1) {
      const outline = outlines[i];
      const outlineRef = refMap.get(outline)!;

      const destOrAction = (() => {
        if (typeof outline.to === 'string') {
          return {A: {S: 'URI', URI: PDFHexString.fromText(outline.to)}};
        } else if (typeof outline.to === 'number') {
          const finalIndex = getFinalPageIndex(outline.to);
          return { Dest: [pageRefs[finalIndex], 'Fit'] };
        } else if (Array.isArray(outline.to)) {
          const finalIndex = getFinalPageIndex(outline.to[0]);
          const page = doc.getPage(finalIndex);  // Use correct index
          const width = page.getWidth();
          const height = page.getHeight();

          return {
            Dest: [
              pageRefs[finalIndex],
              'XYZ',
              width * outline.to[1],
              height * outline.to[2],
              null,
            ],
          };
        }
        return {};
      })();

      const childrenDict = (() => {
        if ('children' in outline && outline.children.length > 0) {
          createOutline(outline.children, outlineRef);

          return {
            First: refMap.get(outline.children[0])!,
            Last: refMap.get(outline.children[outline.children.length - 1])!,
            Count: getOpeningCount(outline.children) * (outline.open ? 1 : -1),
          };
        }
        return {};
      })();

      doc.context.assign(outlineRef, doc.context.obj({
        Title: PDFHexString.fromText(outline.title),
        Parent: parent,
        ...(i > 0 ? {Prev: refMap.get(outlines[i - 1])!} : {}),
        ...(i < length - 1 ? {Next: refMap.get(outlines[i + 1])!} : {}),
        ...childrenDict,
        ...destOrAction,
        F: (outline.italic ? 1 : 0) | (outline.bold ? 2 : 0),
      }));
    }
  };

  createOutline(outlines, rootRef);

  // Root
  const rootCount = getOpeningCount(outlines);

  doc.context.assign(rootRef, doc.context.obj({
    Type: 'Outlines',
    ...(rootCount > 0 ? {
      First: refMap.get(outlines[0])!,
      Last: refMap.get(outlines[outlines.length - 1])!,
    } :
                        {}),
    Count: rootCount,
  }));

  doc.catalog.set(doc.context.obj('Outlines'), rootRef);
};