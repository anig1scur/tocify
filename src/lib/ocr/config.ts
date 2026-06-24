import type { OcrModelSize, OcrResolutionQuality, OcrWasmPaths } from './types';

export const OCR_MIN_WORKER_POOL_SIZE = 1;
export const OCR_WORKER_POOL_SIZE_DEFAULT = 2;
export const OCR_MAX_WORKER_POOL_SIZE = 8;
export const OCR_RUNTIME_SETTINGS_STORAGE_KEY = 'tocify.ocr.runtimeSettings';
export const OCR_MODEL_SIZE_DEFAULT: OcrModelSize = 'tiny';
export const OCR_SELECTION_HISTORY_LIMIT = 80;
export const OCR_LINE_ID_KEY = '__tocifyOcrLineId';

export const INTERNAL_PAGE_BATCH_SIZE = 1;
export const INTERNAL_TEXT_DETECTION_BATCH_SIZE = 1;
export const INTERNAL_TEXT_RECOGNITION_BATCH_SIZE = 2;

export const OCR_BOX_EXTENSION_DEFAULT = 2.0;
export const OCR_BOX_EXTENSION_MIN = 1.0;
export const OCR_BOX_EXTENSION_MAX = 3.0;
export const OCR_BOX_EXTENSION_STEP = 0.1;
export const OCR_ENGINE_CREATE_TIMEOUT_MS = 45_000;
export const OCR_PAGE_PREDICT_TIMEOUT_MS = 120_000;

export const OCR_RESOLUTION_QUALITY_SIZES: Record<OcrResolutionQuality, number> = {
  low: 1200,
  standard: 1600,
  high: 2000,
  ultra: 2400,
};

export const OCR_MODEL_CONFIGS: Record<OcrModelSize, {
  textDetectionModelName: string;
  textDetectionModelAsset: { url: string };
  textRecognitionModelName: string;
  textRecognitionModelAsset: { url: string };
}> = {
  small: {
    textDetectionModelName: 'PP-OCRv6_small_det',
    textDetectionModelAsset: {
      url: '/models/paddleocr/PP-OCRv6_small_det_onnx_infer.tar',
    },
    textRecognitionModelName: 'PP-OCRv6_small_rec',
    textRecognitionModelAsset: {
      url: '/models/paddleocr/PP-OCRv6_small_rec_onnx_infer.tar',
    },
  },
  tiny: {
    textDetectionModelName: 'PP-OCRv6_tiny_det',
    textDetectionModelAsset: {
      url: '/models/paddleocr/PP-OCRv6_tiny_det_onnx_infer.tar',
    },
    textRecognitionModelName: 'PP-OCRv6_tiny_rec',
    textRecognitionModelAsset: {
      url: '/models/paddleocr/PP-OCRv6_tiny_rec_onnx_infer.tar',
    },
  },
};

export const OCR_TREE_STICKY_SEARCH_TOP = 48;
export const OCR_TREE_STICKY_SEARCH_HEIGHT = 36;
export const OCR_TREE_STICKY_GAP = 14;
export const OCR_TREE_STICKY_PAGE_TOP = OCR_TREE_STICKY_SEARCH_TOP + OCR_TREE_STICKY_SEARCH_HEIGHT + OCR_TREE_STICKY_GAP;
export const OCR_TREE_STICKY_PAGE_HEIGHT = 20;

export const PREVIEW_MIN_LOCATED_BOX_HEIGHT = 17;
export const PREVIEW_LOCATED_BOX_HORIZONTAL_PADDING = 32;
export const PREVIEW_MIN_SCALE = 0.5;
export const PREVIEW_MAX_SCALE = 8;
export const PREVIEW_DEFAULT_SCALE = 1.0;

const ORT_CDN_BASE_URL = 'https://registry.npmmirror.com/onnxruntime-web/1.26.0/files/dist/';

export const ORT_JSEP_WASM_PATHS: OcrWasmPaths = {
  mjs: `${ORT_CDN_BASE_URL}ort-wasm-simd-threaded.jsep.mjs`,
  wasm: `${ORT_CDN_BASE_URL}ort-wasm-simd-threaded.jsep.wasm`,
};

export const ORT_PLAIN_WASM_PATHS: OcrWasmPaths = {
  mjs: `${ORT_CDN_BASE_URL}ort-wasm-simd-threaded.mjs`,
  wasm: `${ORT_CDN_BASE_URL}ort-wasm-simd-threaded.wasm`,
};
