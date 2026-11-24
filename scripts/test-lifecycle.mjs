// @ts-nocheck
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual store/service/page functions with controlled IO and clocks.
// This lets failures and file-switch races be exercised without model API calls.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src/routes/+page.svelte');
const ocr = read('src/routes/ocr/+page.svelte');
const instanceScript = (source) => source.split('<script lang="ts">')[1].split('</script>')[0];
function functions(source, names) {
  const file = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  return file.statements.filter((node) => names.includes(node.name?.text)
    || node.declarationList?.declarations.some((declaration) => names.includes(declaration.name.text)))
    .map((node) => node.getText(file)).join('\n');
}
function evaluate(source, values = {}) {
  const context = vm.createContext({exports: {}, console, DOMException, URL, AbortController,
    structuredClone, Uint8Array, ArrayBuffer, setTimeout, clearTimeout, ...values});
  const file = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const withoutImports = file.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(file)).join('\n').replaceAll('import.meta.url', '"file:///fixture.ts"');
  vm.runInContext(ts.transpileModule(withoutImports, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText, context);
  return {context, run: (code) => vm.runInContext(code, context)};
}
function clock() {
  let next = 0;
  const callbacks = new Map();
  return {
    setTimeout: (fn) => { const id = ++next; callbacks.set(id, fn); return id; },
    clearTimeout: (id) => callbacks.delete(id),
    fire: async () => {
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) await callback();
    },
    get size() { return callbacks.size; },
  };
}
function writable(value) {
  const subscribers = new Set();
  return {get value() {return value;},
    set(next) {value = next; for (const callback of subscribers) callback(value);},
    update(fn) {this.set(fn(value));},
    subscribe(fn) {subscribers.add(fn); fn(value); return () => subscribers.delete(fn);},
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function exportFixture(copy) {
  const downloads = [], errors = [];
  const fixture = evaluate(functions(instanceScript(main), ['updatePDF', 'exportPDF']), {
    isViewActive: true, isFileLoading: false, isExporting: false,
    isPreviewMode: true, isPreviewLoading: false, pdfLoadSequence: 1, pdfUpdateSequence: 0,
    pdfState: {filename: 'B.pdf', doc: {copy}, totalPages: 5, currentPage: 1},
    $pdfService: {}, pdfjs: {}, PdfLib: {}, addPhysicalTocPage: false,
    config: {prefixSettings: {enabled: false}, pageOffset: 0, pageLabelSettings: {}}, $tocItems: [],
    $t: (key) => key, toastProps: {}, tocPdfInstance: null, tocPageCount: 0,
    setOutline: () => {}, setPageLabels: () => {}, updateViewerInstance: () => {},
    savePdfBytes: async (bytes, filename) => {downloads.push({bytes, filename}); return true;},
    console: {error: (...args) => errors.push(args)}, setTimeout: () => 0,
  });
  return {...fixture, downloads, errors};
}

await test('failed generation cannot download an old PDF or report success', async () => {
  const fixture = exportFixture(async () => {throw new Error('generation failed');});
  fixture.context.pdfState.newDoc = {save: () => {throw new Error('stale document used');}};
  await fixture.run('exportPDF()');
  assert.equal(fixture.downloads.length, 0);
  assert.equal(fixture.context.toastProps.type, 'error');
  assert.equal(fixture.context.isExporting, false);
});

await test('successful export serializes once and does not retain the generated document', async () => {
  let saves = 0;
  const fixture = exportFixture(async () => ({save: async () => {saves++; return new Uint8Array([66]);}}));
  await fixture.run('exportPDF()');
  assert.equal(saves, 1);
  assert.equal(fixture.downloads[0].filename, 'B_outlined.pdf');
  assert.equal(fixture.context.pdfState.newDoc, undefined);
  assert.equal(fixture.context.toastProps.type, 'success');
});

await test('a rejected outline update aborts export before serialization', async () => {
  let saves = 0;
  const fixture = exportFixture(async () => ({save: async () => {saves++;}}));
  fixture.context.setOutline = async () => {throw new Error('invalid outline');};
  await fixture.run('exportPDF()');
  assert.equal(saves, 0);
  assert.equal(fixture.downloads.length, 0);
  assert.equal(fixture.context.toastProps.type, 'error');
});

await test('switching books while export is building suppresses the old download', async () => {
  const gate = deferred();
  const fixture = exportFixture(() => gate.promise);
  const exporting = fixture.run('exportPDF()');
  fixture.context.pdfState = {filename: 'C.pdf', doc: {}};
  fixture.context.pdfLoadSequence++;
  gate.resolve({save: async () => new Uint8Array([66])});
  await exporting;
  assert.equal(fixture.downloads.length, 0);
  assert.notEqual(fixture.context.toastProps.type, 'success');
});

await test('previewing a book does not copy or serialize its complete PDF', async () => {
  let copies = 0;
  const fixture = exportFixture(async () => {copies++; throw new Error('unnecessary full copy');});
  await fixture.run('updatePDF()');
  assert.equal(copies, 0);
});

await test('a slow first upload cannot replace the next selected book', async () => {
  const gate = deferred();
  const fingerprint = writable(''), items = writable([]);
  const fixture = evaluate(functions(instanceScript(main), ['loadPdfFile']), {
    IS_LOCAL: false,
    pdfLoadSequence: 0, pdfUpdateSequence: 0, isViewActive: true, isFileLoading: false,
    pdfState: {currentPage: 1}, isPreviewMode: false,
    debouncedUpdatePDF: {cancel() {}}, flushTocDraft() {}, autoSaveEnabled: writable(true),
    curFileFingerprint: fingerprint, tocItems: items, $tocItems: [], workspacePdfFiles: writable({}),
    localStorage: {setItem() {}, getItem: () => null},
    releasePdfResources: async () => {}, loadPdfLibraries: async () => {},
    $pdfService: {}, config: {insertAtPage: 2}, tocConfig: writable({firstLevel: {}, otherLevels: {}}),
    PdfLib: {PDFDocument: {load: async (bytes) => ({tag: bytes[0], getPageCount: () => 1,
      getPage: () => ({getSize: () => ({width: 595})})})}},
    pdfjs: {version: 'test', getDocument: ({data}) => ({promise: Promise.resolve({
      numPages: data[0], getOutline: async () => [], destroy: async () => {},
    })})},
    PDFService: {sanitizePdfMetadata() {}, getAutoLayout: () => ({}), getSharedWorker() {}},
    pdfLoadingTasks: new Set(), updateTocField() {}, getPdfEffectiveData: () => [],
    prepareTocInBackground() {}, updateViewerInstance() {}, $t: (key) => key,
  });
  fixture.context.fileA = {name: 'A.pdf', size: 1, arrayBuffer: () => gate.promise};
  fixture.context.fileB = {name: 'B.pdf', size: 2, arrayBuffer: async () => new Uint8Array([5]).buffer};
  const first = fixture.run('loadPdfFile(fileA)');
  await new Promise(setImmediate);
  await fixture.run('loadPdfFile(fileB)');
  gate.resolve(new Uint8Array([3]).buffer);
  await first;
  assert.equal(fixture.context.pdfState.filename, 'B.pdf');
  assert.equal(fixture.context.pdfState.doc.tag, 5);
  assert.equal(fingerprint.value, 'B.pdf_2');
  assert.equal(fixture.context.isFileLoading, false);
});

await test('OCR waits for cancellation before destroying the current PDF and loading another', async () => {
  const gate = deferred();
  let cancellations = 0, destroyed = 0;
  const fixture = evaluate(functions(instanceScript(ocr), ['loadPdf']), {
    pdfLoadSequence: 0, isViewActive: true, pdfLoadingTask: null, isFileLoading: false,
    activeOcrRunPromise: gate.promise, activeOcrRunState: {}, lastOcrRunSnapshot: {},
    pdfInstance: {destroy: async () => {destroyed++;}}, pdfFile: {name: 'A.pdf'},
    cancelPreviewRender() {}, cancelLocalOcr: () => {cancellations++;}, resetStateForNewFile() {},
    workspacePdfFiles: writable({}), renderQueue: {clearDocument() {}}, looksLikePdf: () => true,
    pdfjsLib: {getDocument: () => ({promise: Promise.resolve({numPages: 5})})},
    resetPreviewViewForDocument() {},
    file: {name: 'B.pdf', arrayBuffer: async () => new Uint8Array([1]).buffer},
  });
  const loading = fixture.run('loadPdf(file)');
  assert.equal(cancellations, 1);
  assert.equal(destroyed, 0);
  gate.resolve();
  await loading;
  assert.equal(destroyed, 1);
  assert.equal(fixture.context.pdfFile.name, 'B.pdf');
  assert.equal(fixture.context.pdfInstance.numPages, 5);
  assert.equal(fixture.context.activeOcrRunState, null);
});

await test('typing immediately after load cannot be overwritten by the initial text refresh', async () => {
  const timer = clock();
  const fixture = evaluate(functions(instanceScript(read('src/components/TocEditor.svelte')), ['handleInput']), {
    ...timer, text: '', isUpdatingFromEditor: false, debounceTimer: undefined,
    parseText: (text) => [{title: text}], tick: async () => {}, $tocItems: [],
  });
  fixture.context.textGenTimer = timer.setTimeout(() => {fixture.context.text = '';});
  fixture.context.event = {target: {value: 'new chapter'}};
  fixture.run('handleInput(event)');
  await timer.fire();
  assert.equal(fixture.context.$tocItems[0].title, 'new chapter');
});

await test('late text-AI results cannot be applied to the next book', async () => {
  const gate = deferred(), responses = [];
  const fixture = evaluate(functions(instanceScript(read('src/components/TocEditor.svelte')), ['handleAiFormat']), {
    text: 'raw table of contents', isProcessing: false, aiFormatController: null, aiFormatError: '',
    $curFileFingerprint: 'A', apiConfig: {apiKey: 'test'}, TextEncoder,
    requiresUserApiKey: () => false, recognizeToc: () => gate.promise,
    buildTree: (value) => value, dispatch: (...args) => responses.push(args), $t: (key) => key,
  });
  const formatting = fixture.run('handleAiFormat()');
  fixture.context.$curFileFingerprint = 'B';
  fixture.context.aiFormatController.abort();
  gate.resolve({items: [{title: 'A old result'}], incomplete: false});
  await formatting;
  assert.equal(responses.length, 0);
  assert.equal(fixture.context.aiFormatError, '');
  assert.equal(fixture.context.isProcessing, false);
});

function draftsFixture() {
  const timer = clock(), data = new Map(), listeners = {};
  const storage = {get length() {return data.size;}, key: (i) => [...data.keys()][i],
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)};
  const fixture = evaluate(read('src/stores.ts'), {
    browser: true, writable, get: (store) => store.value,
    PDFService: class {}, DEFAULT_PREFIX_CONFIG: [], createDefaultPageLabelSettings: () => ({}),
    localStorage: storage, ...timer,
    window: {addEventListener: (event, fn) => {listeners[event] = fn;}},
    document: {addEventListener: () => {}},
  });
  return {...fixture, timer, data, listeners, stores: fixture.context.exports};
}

await test('switching during the debounce saves A and preserves B existing draft', async () => {
  const {stores, timer, data} = draftsFixture();
  data.set('toc_draft_B', 'existing B draft');
  stores.curFileFingerprint.set('A');
  stores.tocItems.set([{title: 'A latest edit'}]);
  stores.flushTocDraft();
  stores.autoSaveEnabled.set(false);
  stores.curFileFingerprint.set('B');
  stores.tocItems.set([]);
  await timer.fire();
  assert.equal(JSON.parse(data.get('toc_draft_A')).items[0].title, 'A latest edit');
  assert.equal(data.get('toc_draft_B'), 'existing B draft');
});

await test('a pending draft captures its book and immutable contents', async () => {
  const {stores, timer, data} = draftsFixture();
  stores.curFileFingerprint.set('A');
  const items = [{title: 'A edit'}];
  stores.tocItems.set(items);
  stores.curFileFingerprint.set('B');
  items[0].title = 'later mutation';
  await timer.fire();
  assert.equal(JSON.parse(data.get('toc_draft_A')).items[0].title, 'A edit');
  assert.equal(data.has('toc_draft_B'), false);
});

await test('pagehide flushes unsaved edits without waiting for a timer', () => {
  const {stores, data, listeners} = draftsFixture();
  stores.curFileFingerprint.set('A');
  stores.tocItems.set([{title: 'last edit before closing'}]);
  listeners.pagehide();
  assert.equal(JSON.parse(data.get('toc_draft_A')).items[0].title, 'last edit before closing');
});

await test('resuming autosave persists the final drag result', async () => {
  const {stores, data, timer} = draftsFixture();
  stores.curFileFingerprint.set('A');
  stores.autoSaveEnabled.set(false);
  stores.tocItems.set([{title: 'reordered chapter'}]);
  stores.autoSaveEnabled.set(true);
  await timer.fire();
  assert.equal(JSON.parse(data.get('toc_draft_A')).items[0].title, 'reordered chapter');
});

function serviceFixture(fetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(8)})) {
  const workers = [];
  class Worker {
    constructor() {workers.push(this); this.terminated = false;}
    terminate() {this.terminated = true;}
    postMessage(message) {queueMicrotask(() => this.onmessage?.({data: {id: message.id, type: 'SUCCESS'}}));}
  }
  const fixture = evaluate(read('src/lib/pdf/service.ts'), {
    browser: true, Worker, fetch, PDFDocument: {}, fontkit: {}, isLegacyBrowser: () => false,
    FONT_ASSET_BASE: 'https://static.aeriszhu.com/',
    pdfjsLib: {GlobalWorkerOptions: {}, PDFWorker: class {destroy() {}}},
    A4_WIDTH: 595, BASE_FONT_SIZE_L1: 14, BASE_FONT_SIZE_OTHER: 12,
  });
  return {...fixture, workers, Service: fixture.context.exports.PDFService};
}

await test('PDF service starts lazily, rejects abandoned requests, terminates and restarts', async () => {
  const {Service, workers} = serviceFixture();
  const service = new Service();
  assert.equal(workers.length, 0);
  const request = service.postWorkerMessage('WAIT', {});
  service.dispose();
  await assert.rejects(request, {name: 'AbortError'});
  assert.equal(workers[0].terminated, true);
  assert.equal(service.workerCallbacks.size, 0);
  await service.loadFonts('huiwen');
  assert.equal(workers.length, 2);
  service.dispose();
  assert.equal(workers[1].terminated, true);
});

await test('font loading cannot restart an abandoned worker after disposal', async () => {
  const gate = deferred();
  const {Service, workers} = serviceFixture(() => gate.promise);
  const service = new Service();
  const loading = service.loadFonts('huiwen');
  service.dispose();
  gate.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(8)});
  await assert.rejects(loading, {name: 'AbortError'});
  assert.equal(workers.length, 0);
});

function ocrCacheFixture() {
  const timer = clock();
  const cleared = [];
  return {...evaluate(ocr.split('<script context="module" lang="ts">')[1].split('</script>')[0], {
    cachedRenderQueue: {clearDocument: (doc) => cleared.push(doc)}, ...timer,
  }), timer, cleared};
}

await test('inactive OCR releases models and parsed PDF while keeping editable results', async () => {
  let disposed = 0, destroyed = 0;
  const fixture = ocrCacheFixture();
  fixture.context.cache = {localOcrPool: [{dispose: async () => {disposed++;}}],
    pdfInstance: {destroy: async () => {destroyed++;}}, localOcrRuntimeKey: 'runtime',
    editorDoc: {pages: [{page: 1, lines: [{text: 'edited text'}]}]}};
  fixture.run('ocrViewCache = cache; localOcrPool = cache.localOcrPool');
  await fixture.run('releaseCachedOcrResources()');
  await fixture.run('releaseCachedOcrResources()');
  assert.equal(disposed, 1);
  assert.equal(destroyed, 1);
  assert.equal(fixture.context.cache.pdfInstance, null);
  assert.equal(fixture.context.cache.localOcrPool.length, 0);
  assert.equal(fixture.context.cache.editorDoc.pages[0].lines[0].text, 'edited text');
});

await test('active background OCR keeps its resources until the run has settled', async () => {
  let disposed = 0;
  const fixture = ocrCacheFixture();
  fixture.context.cache = {localOcrPool: [{dispose: async () => {disposed++;}}]};
  fixture.run('ocrViewCache = cache; localOcrPool = cache.localOcrPool; activeOcrRunPromise = Promise.resolve()');
  await fixture.run('releaseCachedOcrResources()');
  assert.equal(disposed, 0);
  fixture.run('activeOcrRunPromise = null');
  await fixture.run('releaseCachedOcrResources()');
  assert.equal(disposed, 1);
});

await test('idle OCR engines are disposed and removed from the reusable pool', async () => {
  let disposed = 0;
  const fixture = ocrCacheFixture();
  fixture.context.pool = [{dispose: async () => {disposed++;}}];
  fixture.run('scheduleOcrPoolIdleRelease(pool)');
  assert.equal(disposed, 0);
  await fixture.timer.fire();
  assert.equal(disposed, 1);
  assert.equal(fixture.context.pool.length, 0);
});
