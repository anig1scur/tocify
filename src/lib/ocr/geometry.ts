export type OcrBBox = [number, number, number, number];

export type LocalOcrLine = {
  text: string;
  bbox: OcrBBox;
  score: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getLineBBox(line: any): OcrBBox | null {
  if (!Array.isArray(line?.bbox) || line.bbox.length < 4) return null;
  const bbox = line.bbox.slice(0, 4).map((value: unknown) => Number(value));
  if (bbox.some((value: number) => !Number.isFinite(value))) return null;
  return bbox as OcrBBox;
}

export function getLineMergeKey(line: any) {
  const bbox = getLineBBox(line);
  if (bbox) return `bbox:${bbox.map((value) => Math.round(value)).join(',')}`;
  return `text:${String(line?.text ?? '')}`;
}

export function isUserManagedLine(line: any) {
  return Boolean(line?.manual || line?.userEdited);
}

export function markLineUserEdited(line: any) {
  if (!line) return;
  line.userEdited = true;
}

export function verticalOverlapRatio(a: OcrBBox, b: OcrBBox) {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a[3] - a[1], b[3] - b[1]);
}

function horizontalOverlapRatio(a: OcrBBox, b: OcrBBox) {
  const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a[2] - a[0], b[2] - b[0]);
}

function bboxArea(bbox: OcrBBox) {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function bboxIntersectionArea(a: OcrBBox, b: OcrBBox) {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return width * height;
}

function bboxIoU(a: OcrBBox, b: OcrBBox) {
  const intersection = bboxIntersectionArea(a, b);
  const union = bboxArea(a) + bboxArea(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

function findMergeableExistingLineIndex(incomingLine: any, existingLines: any[], usedExistingLines: Set<number>) {
  const incomingKey = getLineMergeKey(incomingLine);
  const exactIndex = existingLines.findIndex((line, index) => !usedExistingLines.has(index) && getLineMergeKey(line) === incomingKey);
  if (exactIndex >= 0) return exactIndex;

  const incomingBox = getLineBBox(incomingLine);
  if (!incomingBox) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  existingLines.forEach((existingLine, index) => {
    if (usedExistingLines.has(index)) return;
    const existingBox = getLineBBox(existingLine);
    if (!existingBox) return;

    const iou = bboxIoU(incomingBox, existingBox);
    const rowOverlap = verticalOverlapRatio(incomingBox, existingBox);
    const columnOverlap = horizontalOverlapRatio(incomingBox, existingBox);
    const score = Math.max(iou, rowOverlap * columnOverlap);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 0.45 ? bestIndex : -1;
}

export function mergeIncomingOcrPage(existingPage: any, incomingPage: any) {
  if (!existingPage || !Array.isArray(existingPage?.lines)) return incomingPage;

  const existingLines = existingPage.lines;
  const incomingLines = Array.isArray(incomingPage?.lines) ? incomingPage.lines : [];
  const usedExistingLines = new Set<number>();
  const mergedLines = incomingLines.map((incomingLine: any) => {
    const existingIndex = findMergeableExistingLineIndex(incomingLine, existingLines, usedExistingLines);
    if (existingIndex < 0) return incomingLine;

    usedExistingLines.add(existingIndex);
    const existingLine = existingLines[existingIndex];
    if (!isUserManagedLine(existingLine)) return incomingLine;

    return {
      ...incomingLine,
      ...existingLine,
      bbox: getLineBBox(existingLine) ?? incomingLine.bbox,
      text: typeof existingLine.text === 'string' ? existingLine.text : incomingLine.text,
    };
  });

  existingLines.forEach((existingLine: any, index: number) => {
    if (!usedExistingLines.has(index) && isUserManagedLine(existingLine)) {
      mergedLines.push(existingLine);
    }
  });

  sortLinesForReadingOrder(mergedLines);
  return {
    ...existingPage,
    ...incomingPage,
    lines: mergedLines,
  };
}

export function sortLinesForReadingOrder(lines: any[]) {
  lines.sort((a, b) => {
    const aBox = getLineBBox(a) ?? [0, 0, 0, 0];
    const bBox = getLineBBox(b) ?? [0, 0, 0, 0];
    const aHeight = Math.max(1, Number(aBox[3]) - Number(aBox[1]));
    const bHeight = Math.max(1, Number(bBox[3]) - Number(bBox[1]));
    const sameRowTolerance = Math.max(aHeight, bHeight) * 0.6;

    if (Math.abs(Number(aBox[1]) - Number(bBox[1])) <= sameRowTolerance) {
      return Number(aBox[0]) - Number(bBox[0]);
    }
    return Number(aBox[1]) - Number(bBox[1]);
  });
}

export function resolveSmallHorizontalOverlaps(lines: LocalOcrLine[]) {
  const sorted = [...lines].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const currentHeight = current.bbox[3] - current.bbox[1];

    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const next = sorted[nextIndex];
      const nextHeight = next.bbox[3] - next.bbox[1];

      if (next.bbox[1] - current.bbox[1] > Math.max(currentHeight, nextHeight)) break;
      if (verticalOverlapRatio(current.bbox, next.bbox) < 0.6) continue;

      const left = current.bbox[0] <= next.bbox[0] ? current : next;
      const right = left === current ? next : current;
      const overlap = left.bbox[2] - right.bbox[0];
      const maxTrim = Math.min(left.bbox[2] - left.bbox[0], right.bbox[2] - right.bbox[0]) * 0.2;

      if (overlap > 0 && overlap <= maxTrim) {
        const splitX = (left.bbox[2] + right.bbox[0]) / 2;
        left.bbox = [left.bbox[0], left.bbox[1], splitX, left.bbox[3]];
        right.bbox = [splitX, right.bbox[1], right.bbox[2], right.bbox[3]];
      }
    }
  }

  return lines;
}
