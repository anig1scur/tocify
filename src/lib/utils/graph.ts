export const CARD_W = 200;
export const CARD_H = 120;
export const GAP_X = 320;
export const GAP_Y = 280;

export const getRandomPaperColor = () => {
  const papers = ['#ffffff', '#fdfbf7', '#fcfcfc'];
  return papers[Math.floor(Math.random() * papers.length)];
};

export function getDistance(p1, p2) {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function getClosestPoints(srcNode, tgtNode) {
  const getAnchors = (node) =>
      [{x: node.x + CARD_W / 2, y: node.y},           // Top Mid
       {x: node.x + CARD_W / 2, y: node.y + CARD_H},  // Bottom Mid
  ];

  const srcAnchors = getAnchors(srcNode);
  const tgtAnchors = getAnchors(tgtNode);

  let minDistance = Infinity;
  let bestPair = {start: srcAnchors[0], end: tgtAnchors[0]};

  srcAnchors.forEach((start) => {
    tgtAnchors.forEach((end) => {
      const dist = getDistance(start, end);
      if (dist < minDistance) {
        minDistance = dist;
        bestPair = {start, end};
      }
    });
  });

  return bestPair;
}

export function computeHierarchicalLayout(nodes, edges, canvasWidth) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map();
  const revAdj = new Map();
  nodes.forEach((n) => {
    adj.set(n.id, []);
    revAdj.set(n.id, []);
  });
  edges.forEach((e) => {
    if (adj.has(e.source)) adj.get(e.source).push(e.target);
    if (revAdj.has(e.target)) revAdj.get(e.target).push(e.source);
  });
  const asapLevels = new Map();
  nodes.forEach((n) => asapLevels.set(n.id, 0));
  for (let i = 0; i < 10; i++) {
    let changed = false;
    edges.forEach((edge) => {
      const srcLvl = asapLevels.get(edge.source) || 0;
      const tgtLvl = asapLevels.get(edge.target) || 0;
      if (srcLvl >= tgtLvl) {
        asapLevels.set(edge.target, srcLvl + 1);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const finalLevels = new Map();
  nodes.forEach((n) => {
    if ((adj.get(n.id) || []).length === 0) {
      finalLevels.set(n.id, asapLevels.get(n.id));
    } else {
      finalLevels.set(n.id, -1);
    }
  });
  for (let i = 0; i < 10; i++) {
    let changed = false;
    nodes.forEach((n) => {
      const targets = adj.get(n.id);
      if (targets.length > 0) {
        let minChildLevel = Infinity;
        targets.forEach((tId) => {
          const childLvl = asapLevels.get(tId);
          if (childLvl < minChildLevel) minChildLevel = childLvl;
        });
        const anchorLevel = minChildLevel - 1;
        const baseLevel = asapLevels.get(n.id);
        const bestLevel = Math.max(baseLevel, anchorLevel);
        if (finalLevels.get(n.id) !== bestLevel) {
          finalLevels.set(n.id, bestLevel);
          asapLevels.set(n.id, bestLevel);
          changed = true;
        }
      }
    });
    if (!changed) break;
  }
  const levelGroups = [];
  nodes.forEach((n) => {
    let lvl = finalLevels.get(n.id);
    if (lvl === -1 || lvl === undefined) lvl = asapLevels.get(n.id);
    if (!levelGroups[lvl]) levelGroups[lvl] = [];
    levelGroups[lvl].push(n);
  });
  const compactGroups = levelGroups.filter((g) => g && g.length > 0);
  compactGroups.forEach((group, lvlIndex) => {
    const rowWidth = group.length * GAP_X;
    const startX = canvasWidth / 2 - rowWidth / 2;
    group.forEach((node, colIndex) => {
      node.x = startX + colIndex * GAP_X + (Math.random() - 0.5) * 40;
      node.y = 100 + lvlIndex * GAP_Y;
    });
  });
  return nodes;
}
