import {GoogleGenerativeAI} from '@google/generative-ai';
import {jsonrepair} from 'jsonrepair';
import OpenAI from 'openai';

const LIMIT_CONFIG = {
  MAX_IMAGES: 10,
  MAX_TEXT_SIZE_KB: 128
};

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

const SYSTEM_PROMPT_GRAPH = `
Role: You are an expert Investigative Journalist and Domain Expert. 
Task: Create a "Conspiracy Wall" knowledge graph based on the provided Table of Contents (ToC).

**CORE OBJECTIVE:**
Don't just copy the ToC. **Read between the lines.** Use your internal knowledge base to identify *implicit connections*, *underlying themes*, or *prerequisite concepts* that link these chapters together.

**CRITICAL RULES:**

1.  **LANGUAGE CONSISTENCY (IMPORTANT):**
    - Detect the dominant language of the provided ToC.
    - **ALL** output specific fields (label, cluster, edge label) **MUST** be in that same language.

2.  **CONNECTING THE DOTS (The "Detective" Work):**
    - **Explode** high-level chapters into specific, bite-sized concepts.
    - **Bridge Nodes**: If Chapter A and Chapter B are related via a concept not explicitly written, **CREATE a new node** for that concept to bridge them.
    - **Target**: Generate 10-20 nodes. 

3.  **DATA INTEGRITY (PAGES):**
    - **Strictly Preserve Pages**: If a node directly corresponds to a provided ToC item, you **MUST** include its exact "page" number from the input.
    - **Inferred Nodes**: If the node is a new concept (Bridge Node) created by you, set "page" to null.

4.  **EDGES (RELATIONSHIPS):**
    - Avoid generic "relates to". Use specific active verbs like: 'CAUSES', 'PRECEDES', 'SOLVES', 'CONTRADICTS', 'ENABLES'.

Output JSON format:
{
  "nodes": [ 
    { 
      "id": "string", 
      "label": "string (Short, <6 words)",
      "cluster": "string",
      "page": number | null 
    } 
  ], 
  "edges": [ { "source": "id", "target": "id", "type": "string", "label": "string" } ]
}
`;

export async function generateKnowledgeGraph(
  payload:
    { tocItems: any[]; apiKey: string; provider: string; doubaoConfig?: { textEndpoint: string; visionEndpoint: string } }) {
  const { tocItems, apiKey, provider, doubaoConfig } = payload;

  if (!apiKey) throw new Error('API Key is missing');

  const tocText = tocItems
    .map(
      (item) => `[ID:${ item.id }] ${ item.title } (Page: ${ item.page || 'N/A' })`)
    .join('\n');

  const fullPrompt = `ToC Data:\n${ tocText }`;
  const currentProvider = !provider ? 'gemini' : provider;

  let jsonText = '';

  if (currentProvider === 'qwen') {
    jsonText = await processWithQwen(fullPrompt, apiKey, true, SYSTEM_PROMPT_GRAPH);
  } else if (currentProvider === 'zhipu') {
    jsonText = await processWithZhipu(fullPrompt, apiKey, true, SYSTEM_PROMPT_GRAPH);
  } else if (currentProvider === 'doubao') {
    jsonText = await processWithDoubao(fullPrompt, apiKey, doubaoConfig, true, SYSTEM_PROMPT_GRAPH);
  } else {
    jsonText = await processWithGemini(fullPrompt, apiKey, true, SYSTEM_PROMPT_GRAPH);
  }

  let rawString = jsonText.replace(/```json\n?|```/g, '').trim();
  const firstBracket = rawString.indexOf('{'); // Look for object, not array
  if (firstBracket !== -1) {
    rawString = rawString.substring(firstBracket);
  }

  try {
    return JSON.parse(rawString);
  } catch (e) {
    console.warn('JSON parse failed, repairing...');
    const repaired = jsonrepair(rawString);
    return JSON.parse(repaired);
  }
}

export async function processToc(
    payload:
    { images?: string[]; text?: string; apiKey: string; provider: string; doubaoEndpointIdText?: string; doubaoEndpointIdVision?: string }) {
  const { images, text, apiKey, provider, doubaoEndpointIdText, doubaoEndpointIdVision } = payload;

  if (!apiKey) {
    throw new Error('Please enter your API Key in Settings first.');
  }

  if ((!images || images.length === 0) && (!text || !text.trim())) {
    throw new Error('Invalid request. Must provide either images or text.');
  }

  if (images && images.length > LIMIT_CONFIG.MAX_IMAGES) {
    throw new Error(
        `Too many pages. Maximum allowed is ${LIMIT_CONFIG.MAX_IMAGES}.`);
  }

  const isTextMode = !!(text && text.trim());
  console.log(`[ToC Service] Provider: ${provider} | Mode: ${
      isTextMode ? 'TEXT' : 'VISION'}`);

  let jsonText = '';

  const currentProvider = provider === 'auto' || !provider ? 'qwen' : provider;

  if (currentProvider === 'qwen') {
    jsonText =
        await processWithQwen(isTextMode ? text! : images!, apiKey, isTextMode);
  } else if (currentProvider === 'zhipu') {
    jsonText = await processWithZhipu(
        isTextMode ? text! : images!, apiKey, isTextMode);
  } else if (currentProvider === 'doubao') {
    jsonText = await processWithDoubao(
      isTextMode ? text! : images!, apiKey,
      { textEndpoint: doubaoEndpointIdText || '', visionEndpoint: doubaoEndpointIdVision || '' },
      isTextMode);
  } else {
    jsonText = await processWithGemini(
        isTextMode ? text! : images!, apiKey, isTextMode);
  }

  let rawString = jsonText.replace(/```json\n?|```/g, '').trim();
  const firstBracket = rawString.indexOf('[');
  if (firstBracket !== -1) {
    rawString = rawString.substring(firstBracket);
  }

  try {
    return JSON.parse(rawString);
  } catch (e) {
    console.warn(
        `[${currentProvider}] JSON strict parse failed, trying repair...`);
    try {
      const repaired = jsonrepair(rawString);
      return JSON.parse(repaired);
    } catch (repairError) {
      console.error(`[${currentProvider}] JSON Repair failed:`, rawString);
      throw new Error(
          'AI returned invalid JSON structure that could not be repaired.');
    }
  }
}

async function processWithGemini(
    input: string[]|string, apiKey: string,
  isTextMode: boolean, systemPrompt?: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt || (isTextMode ? SYSTEM_PROMPT_TEXT : SYSTEM_PROMPT_VISION),
  });

  if (isTextMode) {
    const result = await model.generateContent([input as string]);
    return result.response.text();
  } else {
    const images = input as string[];
    const imageParts = images.map((img) => {
      const base64Data = img.includes('base64,') ? img.split(',')[1] : img;
      const mimeType = img.match(/data:(.*?);/)?.[1] || 'image/png';
      return {inlineData: {data: base64Data, mimeType: mimeType}};
    });

    const prompt =
        'Analyze these Table of Contents images and return the single structured JSON.';
    const result = await model.generateContent([prompt, ...imageParts]);
    return result.response.text();
  }
}

async function processWithQwen(
    input: string[]|string, apiKey: string,
  isTextMode: boolean, systemPrompt?: string): Promise<string> {
  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    dangerouslyAllowBrowser: true
  });

  if (isTextMode) {
    const response = await client.chat.completions.create({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT_TEXT },
        {role: 'user', content: input as string}
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
        imageUrl = `data:image/png;base64,${img}`;
      }
      contentParts.push({type: 'image_url', image_url: {url: imageUrl}});
    });

    const response = await client.chat.completions.create({
      model: 'qwen-vl-plus',
      messages: [
        {role: 'system', content: SYSTEM_PROMPT_VISION},
        {role: 'user', content: contentParts}
      ]
    });

    return response.choices[0].message.content || '[]';
  }
}

async function processWithZhipu(
    input: string[]|string, userKey?: string,
  isTextMode: boolean = false, systemPrompt?: string): Promise<string> {
  const apiKey = userKey;
  if (!apiKey) {
    throw new Error('[Zhipu] API Key is missing.');
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    dangerouslyAllowBrowser: true
  });

  const VISION_MODEL = 'glm-4v-flash';

  if (isTextMode) {
    const response = await client.chat.completions.create({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT_TEXT },
        {role: 'user', content: input as string}
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
        imageUrl = `data:image/png;base64,${img}`;
      }
      contentParts.push({type: 'image_url', image_url: {url: imageUrl}});
    });

    try {
      const response = await client.chat.completions.create({
        model: VISION_MODEL,
        temperature: 0.1,
        messages: [
          {role: 'system', content: SYSTEM_PROMPT_VISION},
          {role: 'user', content: contentParts}
        ]
      });

      return response.choices[0].message.content || '[]';
    } catch (err: any) {
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
  input: string[] | string, apiKey: string, config: { textEndpoint: string; visionEndpoint: string } | undefined,
  isTextMode: boolean, systemPrompt?: string): Promise<string> {
  if (!apiKey) throw new Error('[Doubao] API Key is missing.');

  // For Doubao, we need an endpoint ID.
  // Since we are in client mode, we can't use env vars.
  // We expect the user to have provided them or we default to empty which will fail if not provided.
  // Ideally these should be in the settings.
  const modelName = isTextMode ? config?.textEndpoint : config?.visionEndpoint;

  if (!modelName) {
    throw new Error(`[Doubao] Endpoint ID missing for ${ isTextMode ? 'TEXT' : 'VISION' } mode. Please configure it in settings.`);
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    dangerouslyAllowBrowser: true,
  });

  if (isTextMode) {
    const response = await client.chat.completions.create({
      model: modelName,
      max_completion_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT_TEXT },
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