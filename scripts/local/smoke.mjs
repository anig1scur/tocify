import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

const [, , runtime = process.execPath, entry = 'scripts/local/server.mjs'] = process.argv;
const origin = 'http://127.0.0.1:3210';
const fakeUpstream = `
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (String(url) !== 'https://open.bigmodel.cn/api/paas/v4/chat/completions') {
      return fetchReal(url, options);
    }
    if (options.headers.Authorization !== 'Bearer local-smoke-test') {
      throw new Error('The selected provider did not receive the test key.');
    }
    const body = JSON.parse(options.body);
    const graph = body.messages.some(({ content }) => String(content).includes('ToC Data:'));
    const content = graph
      ? '{"nodes":[],"edges":[]}'
      : '[{"title":"Example","page":1,"level":1},{"title":"';
    return Promise.resolve(Response.json({ choices: [{ message: { content }, finish_reason: graph ? 'stop' : 'length' }] }));
  };
`;
const child = spawn(runtime, ['--import', `data:text/javascript,${encodeURIComponent(fakeUpstream)}`, entry, '--no-open'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const started = new Promise((resolve, reject) => {
  child.stdout.on('data', (chunk) => {
    if (chunk.toString().includes(origin)) resolve();
  });
  child.once('error', reject);
  child.once('exit', (code) => reject(new Error(`Local server exited (${code}).`)));
});

try {
  await Promise.race([
    started,
    setTimeout(20_000, null, { ref: false }).then(() => { throw new Error('Local server did not start.'); }),
  ]);
  const paths = [
    '/', '/ocr', '/about', '/manifest.webmanifest', '/sw.js', '/pdf.worker.min.mjs',
    '/models/paddleocr/PP-OCRv6_tiny_det_onnx_infer.tar',
    '/local-assets/ort/ort-wasm-simd-threaded.wasm',
    '/local-assets/fonts/SourceHanSansSC-Regular.woff2',
    '/local-assets/cmaps/UniGB-UCS2-H.bcmap',
  ];
  for (const path of paths) {
    const response = await fetch(origin + path, { method: 'HEAD' });
    assert.equal(response.status, 200, path);
  }

  const post = (endpoint, input, requestOrigin = origin) => fetch(origin + '/api/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin },
    body: JSON.stringify({ provider: 'zhipu', apiKey: 'local-smoke-test', ...input }),
  });
  const textResponse = await post('process-toc', { text: 'Example 1' });
  assert.equal(textResponse.status, 200);
  assert.deepEqual(await textResponse.json(), {
    items: [{ title: 'Example', page: 1, level: 1 }],
    incomplete: true,
  });
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(38_000);
  const visionResponse = await post('process-toc', { images: Array(16).fill(image) });
  assert.equal(visionResponse.status, 200);
  assert.equal((await visionResponse.json()).incomplete, true);
  const graphResponse = await post('generate-board', { tocItems: [{ id: 1, title: 'Example', page: 1 }] });
  assert.equal(graphResponse.status, 200);
  assert.deepEqual(await graphResponse.json(), { nodes: [], edges: [] });
  assert.equal((await post('process-toc', { text: 'Example 1' }, 'https://example.org')).status, 403);
  assert.equal((await post('generate-board', { tocItems: [] }, 'https://example.org')).status, 403);
  console.log('Local server smoke tests passed.');
} finally {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
}
