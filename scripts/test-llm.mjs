import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const originalFetch = globalThis.fetch;
const calls = [];
const outline = [{ title: '1 Introduction', level: 1, page: 1 }];
const graph = { nodes: [{ id: '1', label: 'Introduction', cluster: 'Book', page: 1 }], edges: [] };
const images = ['data:image/png;base64,cGFnZQ=='];

globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url: String(url), headers: options.headers, body });
  const prompt = JSON.stringify(body);
  const content = JSON.stringify(prompt.includes('ToC Data:') ? graph : outline);
  return Response.json(String(url).includes('generativelanguage.googleapis.com')
    ? { candidates: [{ content: { parts: [{ text: content }] } }] }
    : { choices: [{ message: { content } }] });
};

try {
  const core = await vite.ssrLoadModule('/src/lib/llm/core.ts');
  const { normalizeToc } = await vite.ssrLoadModule('/src/lib/utils/toc.ts');
  const backend = await vite.ssrLoadModule('/src/lib/llm/server.ts');
  const tocRoute = await vite.ssrLoadModule('/src/routes/api/process-toc/+server.ts');
  const graphRoute = await vite.ssrLoadModule('/src/routes/api/generate-board/+server.ts');

  // Even a configured server key must never fund requests without the user's key.
  process.env.GOOGLE_API_KEY = 'server-key-must-not-be-used';
  process.env.AI_PROVIDER = 'gemini';

  for (const provider of ['gemini', 'qwen', 'zhipu', 'doubao', 'deepseek', 'custom']) {
    for (const apiKey of [undefined, '', '   ']) {
      await test(`${provider}: reject missing user key before any upstream request`, async () => {
        const before = calls.length;
        await assert.rejects(backend.processTocOnServer({ provider, apiKey, text: '1 Introduction 1' }),
          (error) => error.status === 400 && error.message.includes('own API key'));
        await assert.rejects(backend.generateBoardOnServer({ provider, apiKey, tocItems: [] }),
          (error) => error.status === 400 && error.message.includes('own API key'));
        assert.equal(calls.length, before);
      });
    }
  }

  for (const provider of [undefined, '', 'auto']) {
    await test(`reject removed Auto provider: ${String(provider)}`, async () => {
      const before = calls.length;
      await assert.rejects(backend.processTocOnServer({ provider, apiKey: 'user-key', text: 'Introduction 1' }),
        (error) => error.status === 400);
      assert.equal(calls.length, before);
    });
  }

  for (const provider of ['gemini', 'qwen', 'zhipu', 'deepseek', 'doubao']) {
    await test(`${provider}: browser and server share text and vision defaults`, async () => {
      for (const input of [{ text: '1 Introduction 1' }, { images }]) {
        const expectedModel = provider === 'gemini' || provider === 'deepseek' ? core.DEFAULT_MODELS[`${provider}Model`]
          : core.DEFAULT_MODELS[`${provider}${input.images ? 'Vision' : 'Text'}Model`];
        for (const run of [core.processToc, backend.processTocOnServer]) {
          assert.deepEqual(await run({ provider, apiKey: ' user-key ', ...input }), outline);
          const call = calls.at(-1);
          if (provider === 'gemini') {
            assert.ok(call.url.includes(`/models/${expectedModel}:generateContent`));
            assert.equal(call.headers['x-goog-api-key'], 'user-key');
          } else {
            assert.equal(call.body.model, expectedModel);
            assert.equal(call.headers.Authorization, 'Bearer user-key');
            assert.equal(call.body.max_tokens, 4096);
          }
          if (provider === 'qwen') assert.equal(call.body.enable_thinking, false);
          if (provider === 'zhipu') assert.deepEqual(call.body.thinking, { type: 'disabled' });
          if (provider === 'doubao') assert.deepEqual(call.body.thinking, { type: 'disabled' });
          if (provider === 'deepseek') {
            assert.equal(call.url, 'https://api.deepseek.com/chat/completions');
            assert.deepEqual(call.body.thinking, { type: 'disabled' });
            if (input.images) {
              assert.equal(call.body.messages.at(-1).role, 'user');
              assert.equal(call.body.messages.at(-1).content.at(-1).image_url.url, images[0]);
            }
          }
        }
      }
    });
  }

  await test('text and vision model overrides stay independent', async () => {
    const config = { provider: 'zhipu', apiKey: 'user-key', modelOverrides: {
      zhipuTextModel: 'my-text-model', zhipuVisionModel: 'my-vision-model',
    } };
    await core.processToc({ ...config, text: 'Introduction 1' });
    assert.equal(calls.at(-1).body.model, 'my-text-model');
    await core.processToc({ ...config, images });
    assert.equal(calls.at(-1).body.model, 'my-vision-model');
  });

  await test('DeepSeek model override also applies to knowledge graphs', async () => {
    const config = { provider: 'deepseek', apiKey: 'user-key', modelOverrides: { deepseekModel: 'my-deepseek-model' } };
    await core.processToc({ ...config, images });
    assert.equal(calls.at(-1).body.model, 'my-deepseek-model');
    await backend.generateBoardOnServer({ ...config, tocItems: [{ id: 1, title: 'Introduction', page: 1 }] });
    assert.equal(calls.at(-1).url, 'https://api.deepseek.com/chat/completions');
    assert.equal(calls.at(-1).body.model, 'my-deepseek-model');
  });

  await test('remove retained ToC page leaders without removing meaningful title numbers', () => {
    assert.deepEqual(normalizeToc([
      { title: '1.1 Background .... 3', level: 2, page: 3 },
      { title: '第 2 章 方法 …… 8', level: 1, page: '8' },
      { title: '2 Methods ....', level: 1, page: 8 },
      { title: 'Chapter 1984', level: 1, page: 1984 },
      { title: 'Wait... 9', level: 1, page: 4 },
    ]), [
      { title: '1.1 Background', level: 2, page: 3 },
      { title: '第 2 章 方法', level: 1, page: 8 },
      { title: '2 Methods', level: 1, page: 8 },
      { title: 'Chapter 1984', level: 1, page: 1984 },
      { title: 'Wait... 9', level: 1, page: 4 },
    ]);
  });

  await test('paid GLM-5.3 keeps required thinking enabled', async () => {
    await core.processToc({ provider: 'zhipu', apiKey: 'user-key', images,
      modelOverrides: { zhipuVisionModel: 'glm-5.3-flash' } });
    assert.deepEqual(calls.at(-1).body.thinking, { type: 'enabled' });
    assert.equal(calls.at(-1).body.reasoning_effort, 'low');
    assert.equal(calls.at(-1).body.max_tokens, 16384);
  });

  await test('custom GPT-6 Luna uses the supported low latency request parameters', async () => {
    await core.processToc({ provider: 'custom', apiKey: 'user-key', text: 'Introduction 1' });
    assert.equal(calls.at(-1).body.model, 'gpt-6-luna');
    assert.equal(calls.at(-1).body.reasoning_effort, 'none');
    assert.equal(calls.at(-1).body.max_completion_tokens, 4096);
  });

  await test('Doubao never falls back to a server endpoint', async () => {
    process.env.DOUBAO_ENDPOINT_ID_TEXT = 'server-endpoint';
    await backend.processTocOnServer({ provider: 'doubao', apiKey: 'user-key', text: 'Intro 1' });
    assert.equal(calls.at(-1).body.model, core.DEFAULT_MODELS.doubaoTextModel);
    await backend.processTocOnServer({ provider: 'doubao', apiKey: 'user-key', text: 'Intro 1', doubaoEndpointIdText: 'ep-user-text' });
    assert.equal(calls.at(-1).body.model, 'ep-user-text');
  });

  await test('knowledge graph uses the same Qwen default and request options', async () => {
    const result = await backend.generateBoardOnServer({ provider: 'qwen', apiKey: 'user-key', tocItems: [{ id: 1, title: 'Introduction', page: 1 }] });
    assert.equal(result.nodes[0].title, 'Introduction');
    assert.equal(calls.at(-1).body.model, core.DEFAULT_MODELS.qwenTextModel);
    assert.equal(calls.at(-1).body.enable_thinking, false);
  });

  await test('Qwen permissions errors explain model and IP restrictions without retrying', async () => {
    const successFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json({ error: { message: 'Access denied by API-Key restrictions.' } }, { status: 403 });
    };
    try {
      await assert.rejects(core.processToc({ provider: 'qwen', apiKey: 'user-key', images }),
        /API-Key restrictions.*model permissions and IP allowlist.*qwen3\.8-flash.*Beijing/);
      assert.equal(requests, 1);
    } finally { globalThis.fetch = successFetch; }
  });

  await test('Qwen model-not-found errors name the requested model and explain migration', async () => {
    const successFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: { message: 'Model not exist.' } }, { status: 404 });
    try {
      await assert.rejects(core.processToc({ provider: 'qwen', apiKey: 'user-key', images,
        modelOverrides: { qwenVisionModel: 'qwen-vl-plus' } }),
        /Model not exist.*qwen-vl-plus.*retirement status.*qwen3\.8-flash/);
    } finally { globalThis.fetch = successFetch; }
  });

  await test('both HTTP routes reject requests without a key', async () => {
    const before = calls.length;
    const originalError = console.error;
    console.error = () => {};
    try {
      const makeRequest = (path, body) => new Request(`http://localhost:5173/api/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      await assert.rejects(tocRoute.POST({ request: makeRequest('process-toc', { provider: 'gemini', text: 'Intro 1' }) }),
        (error) => error.status === 400);
      const response = await graphRoute.POST({ request: makeRequest('generate-board', { provider: 'qwen', tocItems: [] }) });
      assert.equal(response.status, 400);
      assert.equal(calls.length, before);
    } finally { console.error = originalError; }
  });
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
