import { execFileSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { download } from './download.mjs';

const require = createRequire(import.meta.url);
const viteDirectory = dirname(require.resolve('vite/package.json'));
execFileSync(process.execPath, [join(viteDirectory, 'bin/vite.js'), 'build'], {
  env: { ...process.env, VITE_TOCIFY_LOCAL: '1' },
  stdio: 'inherit',
});

const assets = 'build/local/client/local-assets';
const ortDirectory = dirname(createRequire(import.meta.resolve('@paddleocr/paddleocr-js')).resolve('onnxruntime-web'));
const pdfjsDirectory = dirname(require.resolve('pdfjs-dist/package.json'));
// The prerendered build's server imports jsonrepair for the two LLM endpoints.
const jsonrepairDirectory = resolve(dirname(require.resolve('jsonrepair')), '../..');

const fonts = {
  'huiwen-mincho.ttf': '90bb5b835fd5841a46fa8fca4fe1c82aeb4b9c02be15eadc3effc60dad4fef58',
  'SourceHanSansSC-Regular.woff2': 'a617b2a9d24843b124977a512d454f26fbf82a8952fa623f119a1208442ced4b',
  'SourceHanSerifSC-Regular.woff2': '662226f79a8aee4b8ef05b175b9c4d967c5a17e9efad51387d0dea84ac6f0aed',
};
const ortFiles = [
  'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
];
const fontLicenses = [
  ['Source-Han-Sans-OFL.txt', 'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/2.005R/LICENSE.txt', 'fcac737e761ec63dbfbdce11030a1780161920d80315edba9c8beff1c2bac5a2'],
  ['Source-Han-Serif-OFL.txt', 'https://raw.githubusercontent.com/adobe-fonts/source-han-serif/2.003R/LICENSE.txt', '9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903'],
];

await Promise.all(['fonts', 'ort'].map((folder) => mkdir(join(assets, folder), { recursive: true })));
await Promise.all([
  cp(join(pdfjsDirectory, 'cmaps'), join(assets, 'cmaps'), { recursive: true }),
  cp(jsonrepairDirectory, 'build/local/node_modules/jsonrepair', { recursive: true }),
  ...ortFiles.map((file) => cp(join(ortDirectory, file), join(assets, 'ort', file))),
  ...Object.entries(fonts).map(([file, hash]) => download(
    `https://static.aeriszhu.com/${file}`, join(assets, 'fonts', file), hash,
  )),
  ...fontLicenses.map(([file, url, hash]) => download(url, join(assets, 'fonts', file), hash)),
]);
