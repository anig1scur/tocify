import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const viteDirectory = dirname(require.resolve('vite/package.json'));
execFileSync(process.execPath, [join(viteDirectory, 'bin/vite.js'), 'build'], {
  env: { ...process.env, VITE_TOCIFY_LOCAL: '1' },
  stdio: 'inherit',
});

const client = 'build/local/client';
const assets = join(client, 'local-assets');
const ortDirectory = dirname(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs'));
const pdfjsDirectory = dirname(require.resolve('pdfjs-dist/package.json'));
// The prerendered build's server imports jsonrepair for the two LLM endpoints.
const jsonrepairDirectory = resolve(dirname(require.resolve('jsonrepair')), '../..');

const ortFiles = [
  'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

await mkdir(join(assets, 'ort'), { recursive: true });
await Promise.all([
  cp(join(pdfjsDirectory, 'cmaps'), join(assets, 'cmaps'), { recursive: true }),
  cp(jsonrepairDirectory, 'build/local/node_modules/jsonrepair', { recursive: true }),
  ...ortFiles.map((file) => cp(join(ortDirectory, file), join(assets, 'ort', file))),
  rm(join(client, 'models/paddleocr'), { recursive: true, force: true }),
  rm(join(client, 'videos/demo.mp4'), { force: true }),
]);
