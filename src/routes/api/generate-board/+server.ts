import { env } from '$env/dynamic/private';
import { withRateLimit } from '$lib/server/ratelimit';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { json } from '@sveltejs/kit';

const LAYOUT_CONFIG = {
  colWidth: 220,
  rowHeight: 160,
  padding: 80,
  jitter: 40
};

const SYSTEM_PROMPT = `
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
      "label": "string (Short, <10 words)",
      "cluster": "string",
      "page": number | null 
    } 
  ], 
  "edges": [ { "source": "id", "target": "id", "type": "string", "label": "string" } ]
}
`;

export const POST = withRateLimit(async ({ request }) => {

  try {
    const { tocItems, apiKey } = await request.json();

    if (!tocItems || !Array.isArray(tocItems)) {
      return json({ error: 'Invalid tocItems' }, { status: 400 });
    }

    const googleApiKey = apiKey || env.GOOGLE_API_KEY;
    if (!googleApiKey) {
      return json({ error: 'No API Key provided' }, { status: 401 });
    }

    const tocText = tocItems
      .map(
        (item) => `[ID:${ item.id }] ${ item.title } (Page: ${ item.page || 'N/A' })`)
      .join('\n');

    const fullPrompt = `${ SYSTEM_PROMPT }\n\nToC Data:\n${ tocText }`;

    const genAI = new GoogleGenerativeAI(googleApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    });

    const responseText = result.response.text();
    const cleanedJson = responseText.replace(/```json|```/g, '').trim();

    let aiData;
    try {
      aiData = JSON.parse(cleanedJson);
    } catch (e) {
      console.error('JSON Parse Error', responseText);
      throw new Error('AI returned invalid JSON structure');
    }

    let finalGraphNodes = aiData.nodes.map((aiNode) => {
      let match = tocItems.find((t) => String(t.id) === String(aiNode.id));

      const page =
        aiNode.page !== undefined ? aiNode.page : (match ? match.page : null);

      return {
        id: aiNode.id,
        title: aiNode.label || aiNode.id,
        isInferred: !page,
        page: page,
        cluster: aiNode.cluster || 'Unclassified',
        w: LAYOUT_CONFIG.colWidth,
        h: LAYOUT_CONFIG.rowHeight,
        x: 0,
        y: 0
      };
    });

    const nodeLevels = new Map();
    finalGraphNodes.forEach(n => nodeLevels.set(n.id, 0));

    const edges = aiData.edges || [];
    const MAX_ITERATIONS = 5;

    for (let i = 0;i < MAX_ITERATIONS;i++) {
      let changed = false;
      edges.forEach(edge => {
        const srcLevel = nodeLevels.get(edge.source) || 0;
        const tgtLevel = nodeLevels.get(edge.target) || 0;

        if (srcLevel >= tgtLevel) {
          nodeLevels.set(edge.target, srcLevel + 1);
          changed = true;
        }
      });
      if (!changed) break;
    }

    const levels = [];
    finalGraphNodes.forEach(node => {
      const lvl = nodeLevels.get(node.id);
      if (!levels[lvl]) levels[lvl] = [];
      levels[lvl].push(node);
    });

    levels.forEach((levelNodes, levelIndex) => {
      if (!levelNodes) return;

      const rowWidth = levelNodes.length * LAYOUT_CONFIG.colWidth;
      const startX = -rowWidth / 2;

      levelNodes.forEach((node, idx) => {
        let gridX = startX + (idx * LAYOUT_CONFIG.colWidth) + 400;
        let gridY = LAYOUT_CONFIG.padding +
          (levelIndex * (LAYOUT_CONFIG.rowHeight + 40));

        const jitter = LAYOUT_CONFIG.jitter;
        const randomOffsetX = (Math.random() - 0.5) * jitter * 2;
        const randomOffsetY = (Math.random() - 0.5) * jitter * 1.5;

        node.x = Math.floor(gridX + randomOffsetX);
        node.y = Math.floor(gridY + randomOffsetY);
      });
    });

    return json({ nodes: finalGraphNodes, edges: edges });

  } catch (error) {
    console.error(error);
    return json({ error: error.message }, { status: 500 });
  }
});