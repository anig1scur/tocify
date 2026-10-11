import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createServer, loadEnv } from 'vite';

const env = { ...loadEnv('development', process.cwd(), 'TOCIFY_TEST_'), ...process.env };
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value.`);
  return args[index + 1];
};
const provider = option('--provider');
const imagePath = option('--image');
const model = option('--model');
if (model && !provider) throw new Error('--model requires --provider.');
const supported = ['gemini', 'qwen', 'zhipu', 'doubao', 'deepseek', 'custom'];
if (provider && !supported.includes(provider)) throw new Error(`Unknown provider: ${provider}`);
const providers = supported.filter((name) => (!provider || name === provider)
  && env[`TOCIFY_TEST_${name.toUpperCase()}_API_KEY`]?.trim());
const modelFields = {
  gemini: ['geminiModel'],
  qwen: ['qwenTextModel', 'qwenVisionModel'],
  zhipu: ['zhipuTextModel', 'zhipuVisionModel'],
  doubao: ['doubaoTextModel', 'doubaoVisionModel'],
  deepseek: ['deepseekModel'],
  custom: ['customModel'],
};

if (!providers.length) {
  console.error('No test API key configured. Copy .env.example to .env.local, add a TOCIFY_TEST_*_API_KEY, then run this command again.');
  process.exitCode = 1;
} else {
  let images;
  if (imagePath) {
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(imagePath).toLowerCase()];
    if (!mime) throw new Error('--image supports PNG, JPEG, or WebP.');
    images = [`data:${mime};base64,${(await readFile(imagePath)).toString('base64')}`];
  }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => originalFetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  try {
    const { processToc } = await vite.ssrLoadModule('/src/lib/llm/core.ts');
    for (const name of providers) {
      const apiKey = env[`TOCIFY_TEST_${name.toUpperCase()}_API_KEY`].trim();
      const started = Date.now();
      try {
        const result = await processToc({
          provider: name,
          apiKey,
          customBaseUrl: env.TOCIFY_TEST_CUSTOM_BASE_URL,
          doubaoEndpointIdText: model || env.TOCIFY_TEST_DOUBAO_ENDPOINT_ID_TEXT,
          doubaoEndpointIdVision: model || env.TOCIFY_TEST_DOUBAO_ENDPOINT_ID_VISION,
          modelOverrides: model ? Object.fromEntries(modelFields[name].map((field) => [field, model])) : undefined,
          ...(images ? { images } : { text: '1 Introduction .... 1\n1.1 Background .... 3\n2 Methods .... 8' }),
        });
        assert.ok(result.length > 0, 'The model returned no outline entries.');
        if (!images) {
          assert.deepEqual(result, [
            { title: '1 Introduction', level: 1, page: 1 },
            { title: '1.1 Background', level: 2, page: 3 },
            { title: '2 Methods', level: 1, page: 8 },
          ]);
        }
        console.log(`${name}: PASS (${result.length} entries, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
      } catch (error) {
        const message = String(error.message).replaceAll(apiKey, '[redacted]');
        console.error(`${name}: FAIL — ${message.slice(0, 350)}`);
        process.exitCode = 1;
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
}
