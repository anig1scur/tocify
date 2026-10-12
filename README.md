<h1>
  Tocify
  <img src="https://raw.githubusercontent.com/anig1scur/tocify/refs/heads/main/static/favicon.svg" width="36" />
</h1>

Tocify is a free, online and open-source web application to add, edit, or generate Table of Contents (ToCs) / bookmarks for PDFs. It uses AI to parse scanned directory images or raw text into structured outlines, and creates clickable bookmarks & printable TOC pages for PDFs in cross platforms.

AI features require your own provider API key. Enter it in **API Settings**; it is stored in your browser and requests go directly to your selected provider. PDF editing and local OCR remain free.

**Pages per request** in API Settings defaults to 8 and accepts 1–16. Try 2–4 for dense directories, incomplete results, or failed requests. At most two batches run at once. If a response is truncated or its JSON array is unfinished, complete entries are kept and a warning names the affected PDF pages. A syntactically complete response can still omit content; verify it against the source pages. Qwen image requests use the provider's default output limit.

## Local development and model testing

Run `pnpm install` and `pnpm dev`, then open `http://localhost:5173`. Load a PDF, choose a provider in API Settings, and enter your new key. There is no Auto provider or shared server key.

Default models are Gemini `gemini-3.5-flash-lite`, Qwen `qwen3.8-flash`, Zhipu text `glm-4.7-flash` and vision `glm-4.6v-flash`, DeepSeek `deepseek-flash` (text and images), and custom OpenAI `gpt-6-luna`. Model fields suggest newer alternatives and accept custom model IDs. Doubao defaults to `doubao-seed-2-1-lite-260915` for text and images. Activate this model in Ark first; the model fields also accept your existing Endpoint IDs.

`pnpm test:llm` verifies missing-key rejection and model routing with mocked responses, without API usage. For real API tests, copy `.env.example` to `.env.local` and fill in the desired `TOCIFY_TEST_*` keys. These variables are only read by the test script and are never used to fund website requests.

```sh
pnpm test:llm:live --provider gemini
pnpm test:llm:live --provider deepseek --image /absolute/path/to/toc.png
pnpm test:llm:live --provider zhipu --image /absolute/path/to/toc.png
```

Live tests call the provider and use its API quota. Omitting `--provider` tests all configured test keys. Use `--model MODEL_ID` with `--provider` to test another model. Text tests check chapter names, hierarchy, and page numbers; image tests check that the supplied image produces a nonempty outline.

The built-in Qwen provider uses the Beijing API endpoint. Use a Beijing-region key; for another region, select Custom / OpenAI Compatible and enter that region's base URL. A `403 Access denied by API-Key restrictions` response calls for checking the key's model permissions and IP allowlist in Model Studio. Changing the model ID alone does not grant access to the new model. Use the exact lowercase ID, for example `qwen3.8-flash`. See [API key permissions](https://help.aliyun.com/zh/model-studio/get-api-key).

## Vercel configuration

The website does not require model credentials or Redis rate-limit credentials on Vercel. Deploy the updated code and confirm that `/api/process-toc` and `/api/generate-board` return HTTP 400 when no user API key is supplied. You can then remove these obsolete environment variables from Production, Preview, and Development:

`AI_PROVIDER`, `GOOGLE_API_KEY`, `DASHSCOPE_API_KEY`, `QWEN_VL_MODEL`, `ZHIPU_API_KEY`, `DOUBAO_API_KEY`, `DOUBAO_ENDPOINT_ID_TEXT`, `DOUBAO_ENDPOINT_ID_VISION`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN`.

Vercel environment-variable changes apply to new deployments. Previous deployments keep their existing configuration; retire obsolete deployments and revoke former shared provider keys after migrating. Keep new test keys in your local `.env.local` or browser API Settings.

</div>


## Usage


<https://github.com/user-attachments/assets/48e09103-f3a8-4d13-afeb-d11b5c8ade44>

---

### 1. Basic

<img src="./screenshots/basic.png" alt="Basic" width="100%"/>

### 2. Format text

<img src="./screenshots/text.gif" alt="Format text" width="100%"/>

### 3. Edit style

<img src="./screenshots/style.png" alt="Edit style" width="100%"/>
