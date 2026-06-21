import {
  OCR_BOX_EXTENSION_DEFAULT,
  OCR_BOX_EXTENSION_MAX,
  OCR_BOX_EXTENSION_MIN,
  OCR_BOX_EXTENSION_STEP,
  OCR_MAX_WORKER_POOL_SIZE,
  OCR_MIN_WORKER_POOL_SIZE,
  OCR_MODEL_SIZE_DEFAULT,
  OCR_RESOLUTION_QUALITY_SIZES,
  ORT_JSEP_WASM_PATHS,
  ORT_PLAIN_WASM_PATHS,
} from './config';
import type { LocalOcrEngine, OcrBackend, OcrModelSize, OcrResolutionQuality, OcrWasmPaths } from './types';

let workerFetchSupportPromise: Promise<boolean> | null = null;

export function clampOcrWorkerPoolSize(value: unknown) {
  return Math.max(
    OCR_MIN_WORKER_POOL_SIZE,
    Math.min(OCR_MAX_WORKER_POOL_SIZE, Math.floor(Number(value)) || 4),
  );
}

export function isIosLikeBrowser() {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iP(hone|ad|od)/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isFirefoxBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /\bFirefox\//i.test(navigator.userAgent || '');
}

export function getEffectiveOcrWorkerPoolSize(value: unknown) {
  if (isIosLikeBrowser() || isFirefoxBrowser()) return 1;
  return clampOcrWorkerPoolSize(value);
}

export function shouldUseOcrWorker() {
  return !isFirefoxBrowser();
}

export function getOcrOrtRuntimeConfig(): { backend: OcrBackend; wasmPaths: OcrWasmPaths; runtime: string } {
  if (isIosLikeBrowser()) {
    return {
      backend: 'wasm',
      wasmPaths: ORT_PLAIN_WASM_PATHS,
      runtime: 'plain-wasm-ios',
    };
  }

  if (isFirefoxBrowser()) {
    return {
      backend: 'wasm',
      wasmPaths: ORT_PLAIN_WASM_PATHS,
      runtime: 'plain-wasm-firefox',
    };
  }

  return {
    backend: 'auto',
    wasmPaths: ORT_JSEP_WASM_PATHS,
    runtime: 'jsep-auto',
  };
}

export function normalizeOcrModelSize(value: unknown): OcrModelSize {
  return value === 'tiny' || value === 'small' ? value : OCR_MODEL_SIZE_DEFAULT;
}

export function normalizeOcrResolutionQuality(value: unknown): OcrResolutionQuality {
  return value === 'low' || value === 'high' || value === 'ultra' ? value : 'standard';
}

export function clampOcrBoxExtension(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return OCR_BOX_EXTENSION_DEFAULT;

  const clamped = Math.max(OCR_BOX_EXTENSION_MIN, Math.min(OCR_BOX_EXTENSION_MAX, parsed));
  return Number((Math.round(clamped / OCR_BOX_EXTENSION_STEP) * OCR_BOX_EXTENSION_STEP).toFixed(1));
}

export function getOcrResolutionQualitySize(value: OcrResolutionQuality) {
  return OCR_RESOLUTION_QUALITY_SIZES[value];
}

export function supportsWorkerFetch() {
  if (workerFetchSupportPromise) return workerFetchSupportPromise;

  workerFetchSupportPromise = new Promise<boolean>((resolve) => {
    if (
      typeof Worker === 'undefined'
      || typeof Blob === 'undefined'
      || typeof URL === 'undefined'
      || typeof URL.createObjectURL !== 'function'
    ) {
      resolve(false);
      return;
    }

    let worker: Worker | null = null;
    let workerUrl = '';
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (supported: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      worker?.terminate();
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
      resolve(supported);
    };

    try {
      workerUrl = URL.createObjectURL(new Blob([
        "self.postMessage(typeof fetch === 'function');",
      ], { type: 'application/javascript' }));
      worker = new Worker(workerUrl);
      timeoutId = setTimeout(() => finish(false), 1500);
      worker.onmessage = (event) => finish(Boolean(event.data));
      worker.onerror = () => finish(false);
    } catch {
      finish(false);
    }
  });

  return workerFetchSupportPromise;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onLateResolve?: (value: T) => void,
) {
  let settled = false;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      settled = true;
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timedOut) {
          onLateResolve?.(value);
          return;
        }
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export function disposeLateOcrEngine(engine: LocalOcrEngine) {
  void engine.dispose().catch(() => undefined);
}
