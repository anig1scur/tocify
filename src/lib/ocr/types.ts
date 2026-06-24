import type { OcrResult } from '@paddleocr/paddleocr-js';

import type { OcrBBox } from './geometry';

export type LocalOcrEngine = {
  predict(input: unknown, params?: Record<string, unknown>): Promise<OcrResult[]>;
  dispose(): Promise<void>;
};

export type OcrModelSize = 'tiny' | 'small';
export type OcrResolutionQuality = 'low' | 'standard' | 'high' | 'ultra';
export type OcrTreeSortMode = 'reading' | 'confidence';
export type OcrBackend = 'auto' | 'wasm';
export type OcrWasmPaths = string | { mjs: string; wasm: string };
export type DragMode = 'move' | 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type OcrProgressPhase = 'initializing' | 'rendering' | 'recognizing' | 'postprocessing';

export type OcrSelectionState = {
  pageNumber: number;
  lineIndex: number;
};

export type OcrSelectionHistoryEntry =
  | {
    type: 'bbox';
    pageNumber: number;
    lineId: string;
    fallbackIndex: number;
    beforeBBox: OcrBBox;
    afterBBox: OcrBBox;
    selectionBefore: OcrSelectionState;
    selectionAfter: OcrSelectionState;
  }
  | {
    type: 'create' | 'delete';
    pageNumber: number;
    lineId: string;
    lineIndex: number;
    line: any;
    selectionBefore: OcrSelectionState;
    selectionAfter: OcrSelectionState;
  };

export type OcrProgress = {
  phase: OcrProgressPhase;
  current: number;
  total: number;
};
