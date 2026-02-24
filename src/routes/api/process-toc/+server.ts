import { env } from '$env/dynamic/private';
import { withRateLimit } from '$lib/server/ratelimit';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { error, json } from '@sveltejs/kit';
import { jsonrepair } from 'jsonrepair';
import OpenAI from 'openai';

import { LIMIT_CONFIG } from '$lib/server/ratelimit';

const SYSTEM_PROMPT_VISION = `
Role: Expert PDF ToC Image Parser.
Task: Parse image(s) into a structured JSON array.

Strict Rules:
1. READING ORDER (Auto-Detect):
   - Horizontal: Top-to-Bottom. Page num at line end.
   - Vertical (CJK): Right-to-Left columns. Page num at column bottom.
   - Stitch multiple images mentally.

2. FILTERING (CRITICAL):
   - PAGE NUMBERS: Must contain Arabic digits (0-9).
   - DISCARD line if page is Roman numeral (i, v, x).
   - KEEP Roman numerals in TITLES (e.g., "Part II").

3. CONTENT EXTRACTION:
   - VISUAL LITERALISM: Transcribe page text exactly (e.g., "10", "10-15") as String.
   - PREFIXES: Preserve exact numbering in Title (e.g., "1.1 Intro", "Chapter 1:").
   - LEVEL: Infer 1, 2, 3 from indentation/size/color visual hierarchy.

Output Format (JSON Only, No Markdown):
[{"title": "String (w/ prefix)", "level": Number, "page": "String"}]
Return [] if unusable.
`;

const SYSTEM_PROMPT_TEXT = `
You are an expert Table of Contents text parser.
Your task is to convert raw, unstructured ToC text (copied from websites like Amazon, Douban, etc.) into a structured JSON array.

Rules:
1.  **Extract Structure**: Identify the title, hierarchy level, and page number from each line.
2.  **Hierarchy**: Infer the 'level' (1, 2, 3) based on numbering (e.g., "1.", "1.1", "1.1.1") or indentation.
3.  **Page Numbers**: Extract the page number at the end of the line.
4.  **FULL TITLE RETENTION (CRITICAL)**:
    - The "title" field MUST include the numbering prefix exactly as it appears in the text.
    - Example Input: "1.2 Methodology ....... 15" -> Output Title: "1.2 Methodology"
    - Example Input: "Chapter One: Basics ... 5" -> Output Title: "Chapter One: Basics"
    - Do NOT remove the leading numbers or labels.
5.  **ROMAN NUMERAL BAN (PAGES)**: If the *page number* at the end is Roman (i, v, x), **DISCARD THE LINE**.
6.  **Clean Up**: Remove dots (.....) or dashes (----) that connect the title to the page number.
7.  **JSON ONLY**: Return strictly a JSON array. No markdown.
    Format: [{"title": "String", "level": Number, "page": Number}]
`;

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface TocItem {
  title: string;
  level: number;
  page: number;
}

function normalizeToc(rawData: any[]): TocItem[] {
  if (!Array.isArray(rawData)) return [];

  return rawData
    .map((item) => {
      let cleanPage = 0;

      if (typeof item.page === 'string') {
        const match = item.page.match(/(\d+)/);
        if (match) {
          cleanPage = parseInt(match[0], 10);
        }
      } else if (typeof item.page === 'number') {
        cleanPage = item.page;
      }

      return {
        title: String(item.title || '').trim(),
        level: typeof item.level === 'number' ? item.level : 1,
        page: cleanPage
      };
    })
    .filter(item => item.page > 0 && item.title.length > 0);
}

function determineProvider(request: Request, userProvider?: string): string {
  if (userProvider) {
    return userProvider;
  }

  if (env.AI_PROVIDER) {
    return env.AI_PROVIDER.toLowerCase();
  }

  const country = request.headers.get('x-vercel-ip-country') ||
    request.headers.get('cf-ipcountry') ||
    request.headers.get('x-country-code');

  if (country === 'CN') {
    // return randomChoice(['gemini', 'qwen', 'doubao', 'zhipu']);
    return randomChoice(['gemini', 'qwen', 'doubao']);
  }

  return 'gemini';
}

export const POST = withRateLimit(async ({ request }) => {
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    'https://tocify.aeriszhu.com', 'https://tocify.vercel.app',
    'http://localhost:5173', 'http://127.0.0.1:5173'
  ];

  if (origin && !allowedOrigins.includes(origin)) {
    return new Response('Forbidden', { status: 403 });
  }


  try {
    const { images, text, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision } = await request.json();

    if ((!images || !Array.isArray(images) || images.length === 0) &&
      (!text || typeof text !== 'string' || !text.trim())) {
      throw error(
        400,
        'Invalid request. Must provide either "images" array or "text" string.');
    }

    if (images && Array.isArray(images)) {
      if (images.length > LIMIT_CONFIG.MAX_IMAGES) {
        throw error(
          400,
          `Too many pages. Maximum allowed is ${ LIMIT_CONFIG.MAX_IMAGES }.`);
      }
    }

    if (text && typeof text === 'string') {
      const byteLength = new TextEncoder().encode(text).length;
      const maxBytes = LIMIT_CONFIG.MAX_TEXT_SIZE_KB * 1024;

      if (byteLength > maxBytes) {
        throw error(
          400,
          `Text too large. Maximum allowed is ${ LIMIT_CONFIG.MAX_TEXT_SIZE_KB }KB.`);
      }
    }

    const currentProvider = determineProvider(request, provider);
    const isTextMode = !!(text && text.trim());

    console.log(`[ToC Parser] Provider: ${ currentProvider } | Mode: ${ isTextMode ? 'TEXT' : 'VISION' }`);

    let jsonText = '';

    if (currentProvider === 'qwen') {
      jsonText =
        await processWithQwen(isTextMode ? text : images, apiKey, isTextMode);
    } else if (currentProvider === 'zhipu') {
      jsonText = await processWithZhipu(
        isTextMode ? text : images, apiKey, isTextMode);
      jsonText = await processWithDoubao(
        isTextMode ? text : images, apiKey, isTextMode, doubaoEndpointIdText, doubaoEndpointIdVision);
    } else {
      jsonText = await processWithGemini(
        isTextMode ? text : images, apiKey, isTextMode);
    }

    let rawString = jsonText.replace(/```json\n?|```/g, '').trim();

    const firstBracket = rawString.indexOf('[');
    if (firstBracket !== -1) {
      rawString = rawString.substring(firstBracket);
    }

    let tocData;
    try {
      tocData = JSON.parse(rawString);
    } catch (e) {
      console.warn(
        `[${ currentProvider }] JSON strict parse failed, trying repair...`);
      try {
        const repaired = jsonrepair(rawString);
        tocData = JSON.parse(repaired);
      } catch (repairError) {
        console.error(`[${ currentProvider }] JSON Repair failed:`, rawString);
        throw error(
          500,
          'AI returned invalid JSON structure that could not be repaired. Please try again.');
      }
    }

    tocData = normalizeToc(tocData);
    return json(tocData);

  } catch (err: any) {
    console.error('API Error:', err);
    throw error(
      err.status || 500,
      err.message || err.body.message ||
      'Failed to process ToC, please contact support.');
  }
});

async function processWithGemini(
  input: string[] | string, userKey?: string,
  isTextMode: boolean = false): Promise<string> {
  const apiKey = userKey || env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error('[Gemini] API Key is missing.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: isTextMode ? SYSTEM_PROMPT_TEXT : SYSTEM_PROMPT_VISION,
  });

  if (isTextMode) {
    const result = await model.generateContent([input as string]);
    return result.response.text();
  } else {
    const images = input as string[];
    const imageParts = images.map((img) => {
      const base64Data = img.includes('base64,') ? img.split(',')[1] : img;
      const mimeType = img.match(/data:(.*?);/)?.[1] || 'image/png';
      return { inlineData: { data: base64Data, mimeType: mimeType } };
    });

    const prompt =
      'Analyze these Table of Contents images and return the single structured JSON.';
    const result = await model.generateContent([prompt, ...imageParts]);
    return result.response.text();
  }
}

async function processWithQwen(
  input: string[] | string, userKey?: string,
  isTextMode: boolean = false): Promise<string> {
  const apiKey = userKey || env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    throw new Error('[Qwen] API Key is missing.');
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  });

  if (isTextMode) {
    const response = await client.chat.completions.create({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_TEXT },
        { role: 'user', content: input as string }
      ]
    });
    return response.choices[0].message.content || '[]';

  } else {
    const images = input as string[];
    const contentParts: any[] = [{
      type: 'text',
      text:
        'Analyze these Table of Contents images and return the single structured JSON.'
    }];

    images.forEach((img) => {
      let imageUrl = img;
      if (!img.startsWith('data:image/')) {
        imageUrl = `data:image/png;base64,${ img }`;
      }
      contentParts.push({ type: 'image_url', image_url: { url: imageUrl } });
    });

    const response = await client.chat.completions.create({
      model: 'qwen-vl-plus',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_VISION },
        { role: 'user', content: contentParts }
      ]
    });

    return response.choices[0].message.content || '[]';
  }
}

async function processWithZhipu(
  input: string[] | string, userKey?: string,
  isTextMode: boolean = false): Promise<string> {
  const apiKey = userKey || env.ZHIPU_API_KEY;

  if (!apiKey) {
    throw new Error('[Zhipu] API Key is missing.');
  }

  const client = new OpenAI(
    { apiKey: apiKey, baseURL: 'https://open.bigmodel.cn/api/paas/v4/' });


  if (isTextMode) {
    const response = await client.chat.completions.create({
      model: 'glm-4-flash',
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_TEXT },
        { role: 'user', content: input as string }
      ]
    });
    return response.choices[0].message.content || '[]';
  } else {
    const images = input as string[];
    const contentParts: any[] = [{
      type: 'text',
      text:
        'Analyze these Table of Contents images and return the single structured JSON.'
    }];

    images.forEach((img) => {
      let imageUrl = img;
      if (!img.startsWith('data:image/')) {
        imageUrl = `data:image/png;base64,${ img }`;
      }
      contentParts.push({ type: 'image_url', image_url: { url: imageUrl } });
    });

    try {
      const response = await client.chat.completions.create({
        model: 'glm-4v-flash',
        // 这玩意没用
        max_completion_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_VISION },
          { role: 'user', content: contentParts }
        ]
      });

      return response.choices[0].message.content || '[]';
    } catch (err: any) {
      // 捕获图片过多的具体错误，方便调试
      console.error('[Zhipu Vision Error]', err);
      if (err.message && err.message.includes('context_length_exceeded')) {
        throw new Error(
          '图片总大小超出了智谱 Flash 模型的限制，请尝试减少图片数量或切换到付费模型 glm-4v');
      }
      throw err;
    }
  }
}

async function processWithDoubao(
  input: string[] | string, userKey?: string,
  isTextMode: boolean = false, epText?: string, epVision?: string): Promise<string> {
  const apiKey = userKey || env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error('[Doubao] API Key is missing.');

  const modelName =
    isTextMode ? (epText || env.DOUBAO_ENDPOINT_ID_TEXT) : (epVision || env.DOUBAO_ENDPOINT_ID_VISION);

  if (!modelName) {
    throw new Error(`[Doubao] Endpoint ID missing for ${ isTextMode ? 'TEXT' : 'VISION' } mode. Please check Settings or .env`);
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  });

  if (isTextMode) {
    const response = await client.chat.completions.create({
      model: modelName,
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_TEXT },
        { role: 'user', content: input as string }
      ]
    });
    return response.choices[0].message.content || '[]';
  } else {
    const images = input as string[];
    const contentParts: any[] = [{
      type: 'text',
      text:
        'Analyze these Table of Contents images and return the structured JSON array.'
    }];

    images.forEach((img) => {
      let imageUrl = img;
      if (!img.startsWith('data:image/')) {
        imageUrl = `data:image/png;base64,${ img }`;
      }
      contentParts.push({ type: 'image_url', image_url: { url: imageUrl } });
    });

    const response = await client.chat.completions.create({
      model: modelName,
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_VISION },
        { role: 'user', content: contentParts }
      ]
    });

    return response.choices[0].message.content || '[]';
  }
}
