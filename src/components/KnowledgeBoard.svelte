<script>
  import {tick} from 'svelte';
  import {t} from 'svelte-i18n';
  import rough from 'roughjs';
  import GraphNode from './GraphNode.svelte';
  import {Sparkles, Loader2, RefreshCw, Maximize2, Minimize2, BrainCircuit, BookOpen, EyeOff} from 'lucide-svelte';
  import {CARD_W, CARD_H, getRandomPaperColor, computeHierarchicalLayout, getClosestPoints} from '../lib/graph-utils';
  export let items = [];
  export let apiConfig = {apiKey: ''};

  export let title = 'Untitled Book';

  export let onJumpToPage = (pageNumber) => {};
  export let onHide = () => {};

  let graphData = {nodes: [], edges: []};

  $: {
    if (items) {
      graphData = {nodes: [], edges: []};
      tick().then(drawWall);
    }
  }
  let isLoading = false;
  let isFullscreen = false;
  let activeNodeId = null;

  let svg;
  let rc;
  let viewportWidth = 0;
  let viewportElement;
  let contentWrapper;

  let canvasWidth = 400;
  let canvasHeight = 400;

  // Zoom and Pan state
  let scale = 1;
  let viewX = 0;
  let viewY = 0;
  let isPanning = false;
  let startPanMouse = {x: 0, y: 0};
  let startPanView = {x: viewX, y: viewY};
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5;

  let dragTarget = null;
  let initialMouse = {x: 0, y: 0};
  let initialNodePos = {x: 0, y: 0};
  let isDragging = false;
  let hasMovedDuringDrag = false;

  const ACTIVE_COLOR = '#60a5fa';

  const ROUGH_OPTS = {roughness: 2.5, bowing: 1.5, stroke: '#2d3436', strokeWidth: 1.5};
  const LINE_DIM = {roughness: 2, bowing: 1, stroke: '#e2e8f0', strokeWidth: 1};
  const LINE_ACTIVE = {roughness: 1, bowing: 1, stroke: ACTIVE_COLOR, strokeWidth: 2.5};

  async function handleGenerateGraph() {
    if (items.length === 0) return;
    isLoading = true;
    activeNodeId = null;

  const simplifiedItems = items.map((item) => ({
      id: item.id,
      title: item.title,
      page: item.to || null,
    }));

    try {
      const response = await fetch('/api/generate-board', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          tocItems: simplifiedItems,
          apiKey: apiConfig.apiKey,
        }),
      });

      if (!response.ok) throw new Error('API Failed');
      const data = await response.json();

      let nodes = data.nodes.map((n) => ({
        ...n,
        bgColor: n.isInferred ? '#f8fafc' : getRandomPaperColor(),
        x: 0,
        y: 0,
        page: n.page || null,
      }));
      let edges = data.edges || [];

      nodes = computeHierarchicalLayout(nodes, edges, canvasWidth);
      graphData = {nodes, edges};

      await tick();
      centerContent();
      updateCanvasSize();
      drawWall();
    } catch (e) {
      console.error(e);
      alert($t('knowledge_board.error_failed'));
    } finally {
      isLoading = false;
    }
  }

  function updateCanvasSize() {
    if (graphData.nodes.length > 0) {
      const minX = Math.min(...graphData.nodes.map((n) => n.x));
      const maxX = Math.max(...graphData.nodes.map((n) => n.x));
      const maxY = Math.max(...graphData.nodes.map((n) => n.y));

      if (minX < 50) {
        const offsetX = 50 - minX;
        graphData.nodes.forEach((n) => (n.x += offsetX));
      }

      canvasWidth = Math.max(maxX + CARD_W + 200, isFullscreen ? window.innerWidth : 400);
      canvasHeight = Math.max(maxY + CARD_H + 200, isFullscreen ? window.innerHeight : 400);
    }
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    tick().then(() => {
      centerContent();
      updateCanvasSize();
      drawWall();
    });
  }

  function handleContainerMouseDown(e) {
    // Check if middle click or left click on background
    // We check if the target is the viewport, the static background, or the transformed wrapper itself (if empty areas clicked)
    const isBackground =
      e.target === e.currentTarget || e.target.classList.contains('bg-grid-pattern') || e.target === contentWrapper;

    if (e.button === 1 || (e.button === 0 && isBackground)) {
      isPanning = true;
      startPanMouse = {x: e.clientX, y: e.clientY};
      startPanView = {x: viewX, y: viewY};
      activeNodeId = null;
      drawWall();
    }
  }

  function handleWheel(e) {
    e.preventDefault();

    // Browser standard: Pinch-to-zoom on trackpads usually fires wheel events with ctrlKey=true
    if (e.ctrlKey) {
      // ZOOM Code
      const rect = viewportElement.getBoundingClientRect();
      const xs = (e.clientX - rect.left - viewX) / scale;
      const ys = (e.clientY - rect.top - viewY) / scale;

      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.05 : 0.95; // Slower zoom for pinch control
      let newScale = scale * factor;

      if (newScale < MIN_SCALE) newScale = MIN_SCALE;
      if (newScale > MAX_SCALE) newScale = MAX_SCALE;

      viewX = e.clientX - rect.left - xs * newScale;
      viewY = e.clientY - rect.top - ys * newScale;
      scale = newScale;
    } else {
      // PAN Code (Trackpad two-finger scroll or regular mouse wheel)
      viewX -= e.deltaX;
      viewY -= e.deltaY;
    }
  }

  function handleNodeMouseDown(e, node) {
    e.stopPropagation(); // prevent panning
    if (e.target.closest('button')) return;

    activeNodeId = node.id;
    drawWall();

    isDragging = true;
    dragTarget = node;
    hasMovedDuringDrag = false;
    initialMouse = {x: e.clientX, y: e.clientY};
    initialNodePos = {x: node.x, y: node.y};
  }

  function handleWindowMouseMove(e) {
    if (isPanning) {
      const dx = e.clientX - startPanMouse.x;
      const dy = e.clientY - startPanMouse.y;
      viewX = startPanView.x + dx;
      viewY = startPanView.y + dy;
      return;
    }

    if (!isDragging || !dragTarget) return;

    // Adjust dx/dy by scale to ensure 1:1 movement relative to mouse pointer *visually*
    const dx = (e.clientX - initialMouse.x) / scale;
    const dy = (e.clientY - initialMouse.y) / scale;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      hasMovedDuringDrag = true;
    }

    dragTarget.x = initialNodePos.x + dx;
    dragTarget.y = initialNodePos.y + dy;

    graphData.nodes = graphData.nodes;

    requestAnimationFrame(drawWall);
  }

  function handleWindowMouseUp() {
    isPanning = false;
    if (isDragging) {
      isDragging = false;
      dragTarget = null;
      updateCanvasSize();
    }
  }

  function handleNodeClick(node) {
    if (!hasMovedDuringDrag) {
      if (node.page && onJumpToPage) {
        onJumpToPage(node.page);
      }
    }
  }

  function drawWall() {
    if (!svg) return;
    svg.innerHTML = '';
    if (!graphData.nodes.length) return;
    rc = rough.svg(svg);

    const inactiveGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const activeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    svg.appendChild(inactiveGroup);
    svg.appendChild(activeGroup);
    svg.appendChild(nodeGroup);
    svg.appendChild(pinGroup);

    const pinsToDraw = new Set();
    const nodesWithPins = new Set();

    const edgesToDraw = graphData.edges
      .map((edge, idx) => {
        const src = graphData.nodes.find((n) => n.id === edge.source);
        const tgt = graphData.nodes.find((n) => n.id === edge.target);
        if (!src || !tgt) return null;

        const isActive = activeNodeId && (edge.source === activeNodeId || edge.target === activeNodeId);
        return {edge, src, tgt, idx, isActive};
      })
      .filter(Boolean);

    edgesToDraw.forEach(({edge, src, tgt, idx, isActive}) => {
      const parentGroup = isActive ? activeGroup : inactiveGroup;
      const options = isActive ? LINE_ACTIVE : LINE_DIM;

      // 1. 计算最近的连接点
      const {start, end} = getClosestPoints(src, tgt);
      const x1 = start.x;
      const y1 = start.y;
      const x2 = end.x;
      const y2 = end.y;

      // 2. 注册钉子位置
      pinsToDraw.add(`${x1},${y1}`);
      pinsToDraw.add(`${x2},${y2}`);
      nodesWithPins.add(src.id);
      nodesWithPins.add(tgt.id);

      // 3. 绘制自然下垂的曲线
      const distY = Math.abs(y2 - y1);
      const distX = Math.abs(x2 - x1);

      // 根据距离动态调整下垂幅度和摆动
      const gravity = 10 + distY * 0.15;
      const curveDir = idx % 2 === 0 ? 1 : -1;
      const swing = (10 + distX * 0.05) * curveDir;

      const midX = (x1 + x2) / 2 + swing;
      const midY = (y1 + y2) / 2 + gravity;

      parentGroup.appendChild(
        rc.curve(
          [
            [x1, y1],
            [midX, midY],
            [x2, y2],
          ],
          options,
        ),
      );

      drawArrowHead(parentGroup, midX, midY, x2, y2, isActive ? ACTIVE_COLOR : '#e2e8f0');

      if (isActive) {
        const labelX = (x1 + x2) / 2 + swing / 2;
        const labelY = midY;
        drawEdgeLabel(parentGroup, edge.label, labelX, labelY);
      }
    });

    // 4. 绘制卡片
    graphData.nodes.forEach((node) => {
      const fillStyle = node.isInferred ? 'zigzag' : 'solid';
      const strokeStyle = node.isInferred ? '#94a3b8' : '#2d3436';

      // 如果当前节点没有连线，我们给它补一个默认顶部的钉子，防止它没钉子
      if (!nodesWithPins.has(node.id)) {
        pinsToDraw.add(`${node.x + CARD_W / 2},${node.y + 4}`);
      }

      nodeGroup.appendChild(
        rc.rectangle(node.x, node.y, CARD_W, CARD_H, {
          ...ROUGH_OPTS,
          fill: node.bgColor,
          fillStyle: fillStyle,
          stroke: strokeStyle,
          fillWeight: 1,
          strokeWidth: node.isInferred ? 1 : 1.5,
        }),
      );
    });

    // 5. 统一绘制所有钉子 (去重后)
    pinsToDraw.forEach((coordStr) => {
      const [px, py] = coordStr.split(',').map(Number);
      drawPin(pinGroup, px, py);
    });
  }

  function centerContent() {
    if (graphData.nodes.length === 0) return;

    const contentMinX = Math.min(...graphData.nodes.map((n) => n.x));
    const contentMaxX = Math.max(...graphData.nodes.map((n) => n.x)) + CARD_W;
    const contentMinY = Math.min(...graphData.nodes.map((n) => n.y));
    const contentMaxY = Math.max(...graphData.nodes.map((n) => n.y)) + CARD_H;

    const contentWidth = contentMaxX - contentMinX;
    const contentHeight = contentMaxY - contentMinY;

    const containerWidth = isFullscreen ? window.innerWidth : viewportWidth || 400;
    const containerHeight = isFullscreen ? window.innerHeight : 400; // approximation

    scale = 1;
    viewX = (containerWidth - contentWidth) / 2 - contentMinX;
    viewY = (containerHeight - contentHeight) / 2 - contentMinY;

    // Ensure we don't start with crazy values if empty
    if (isNaN(viewX)) viewX = 0;
    if (isNaN(viewY)) viewY = 0;

    graphData.nodes = graphData.nodes;
  }

  function drawArrowHead(parent, prevX, prevY, tipX, tipY, color) {
    const angle = Math.atan2(tipY - prevY, tipX - prevX);
    const arrowLen = 14;
    const arrowWid = 0.5;
    const xA = tipX - arrowLen * Math.cos(angle - arrowWid);
    const yA = tipY - arrowLen * Math.sin(angle - arrowWid);
    const xB = tipX - arrowLen * Math.cos(angle + arrowWid);
    const yB = tipY - arrowLen * Math.sin(angle + arrowWid);

    parent.appendChild(
      rc.polygon(
        [
          [tipX, tipY],
          [xA, yA],
          [xB, yB],
        ],
        {
          fill: color,
          stroke: 'none',
          fillStyle: 'solid',
          roughness: 0.5,
        },
      ),
    );
  }

  function drawEdgeLabel(parent, text, x, y) {
    if (!text) return;

    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y + 5);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-family', 'HuiwenMincho, serif');
    t.setAttribute('font-size', '14');
    t.setAttribute('fill', ACTIVE_COLOR);
    t.setAttribute('font-weight', 'bold');
    // translate(10px, 10px)
    t.setAttribute('transform', `translate(-15, -15)`);
    t.textContent = text;
    parent.appendChild(t);
  }

  function drawPin(parent, x, y) {
    parent.appendChild(rc.circle(x, y, 10, {fill: ACTIVE_COLOR, fillStyle: 'solid', stroke: 'none'}));
  }
</script>

<svelte:window
  on:mousemove={handleWindowMouseMove}
  on:mouseup={handleWindowMouseUp}
/>

<div
  class="bg-[#f0f0f0] flex flex-col overflow-hidden mx-auto
{isFullscreen ? ' fixed inset-0 z-[9999] w-screen h-screen rounded-none' : ' relative h-full rounded-xl '}"
>
  <div class="absolute top-4 left-5 z-50 pointer-events-none select-none">
    {#if isFullscreen}
      <div class="flex gap-2 text-gray-500 opacity-80">
        <BookOpen size={32} />
        <span class="font-serif text-xl tracking-wide">{title}</span>
      </div>
    {:else}
      <div class="flex items-center gap-2 text-lg z-50 md:text-2xl font-['HuiwenMincho'] text-gray-400 opacity-60">
        <BrainCircuit size={28} />
        <span>{$t('knowledge_board.title')}</span>

        <span
          title={$t('knowledge_board.beta')}
          class="hover:cursor-help ml-2 px-1 py-0 text-xs bg-yellow-300 text-yellow-900 font-bold rounded-full border-2 border-yellow-900 pointer-events-auto"
        >
          BETA
        </span>
      </div>
    {/if}

  </div>

  {#if !isFullscreen}
    <div class="absolute top-3 right-3 z-50">
      <button
        on:click={onHide}
        class="p-2 backdrop-blur-sm rounded-full transition-transform text-gray-400 hover:scale-110"
        title={$t('knowledge_board.hide_graph', {default: 'Hide Graph'})}
      >
        <EyeOff size={24} />
      </button>
    </div>
  {/if}

  {#if items.length > 0}
    <div class="absolute bottom-5 right-24 z-50 flex gap-2">
      <button
        on:click={handleGenerateGraph}
        disabled={isLoading || items.length === 0}
        class="flex items-center gap-2 text-white px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-400 to-cyan-400 disabled:opacity-50 transition-all active:scale-95 border-2 border-transparent font-['HuiwenMincho'] text-xl shadow-lg"
      >
        {#if isLoading}
          <Loader2
            class="animate-spin"
            size={20}
          />
          <span>{$t('knowledge_board.btn_connecting')}</span>
        {:else}
          <Sparkles size={20} />
          <span>{$t('knowledge_board.btn_investigate')}</span>
        {/if}
      </button>
    </div>
  {/if}

  <div
    bind:clientWidth={viewportWidth}
    bind:this={viewportElement}
    on:mousedown={handleContainerMouseDown}
    on:wheel={handleWheel}
    class="flex-1 overflow-hidden relative w-full h-full bg-[#f0f0f0] cursor-grab active:cursor-grabbing no-scrollbar block select-none"
  >
    <div class="absolute inset-0 z-0 bg-grid-pattern pointer-events-none"></div>

    <div
      bind:this={contentWrapper}
      class="origin-top-left absolute top-0 left-0 z-10"
      style="width: {canvasWidth}px; height: {canvasHeight}px; transform: translate({viewX}px, {viewY}px) scale({scale});"
    >
      <svg
        bind:this={svg}
        width={canvasWidth}
        height={canvasHeight}
        class="absolute inset-0 pointer-events-none z-0"
      ></svg>

      <div class="absolute inset-0 z-10 pointer-events-none">
        {#each graphData.nodes as node (node.id)}
          <GraphNode
            {node}
            {activeNodeId}
            isDragTarget={dragTarget && dragTarget.id === node.id}
            on:mousedown={(e) => handleNodeMouseDown(e, node)}
            on:click={() => handleNodeClick(node)}
          />
        {/each}
      </div>
    </div>
  </div>

  {#if items.length === 0}
    <div
      class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 font-['HuiwenMincho'] opacity-50 pointer-events-none z-0"
    >
      <RefreshCw
        size={64}
        class="mb-6"
      />
      <span class="text-3xl">{$t('knowledge_board.msg_generate_toc')}</span>
    </div>
  {:else if !isLoading && items.length > 0 && graphData.nodes.length === 0}
    <div
      class="absolute max-w-[80%] mx-auto text-center inset-0 flex flex-col items-center justify-center text-gray-400 font-['HuiwenMincho'] opacity-50 pointer-events-none z-0"
    >
      <Sparkles
        size={64}
        class="mb-6"
      />
      <span class="text-3xl">{$t('knowledge_board.msg_investigate')}</span>
    </div>
  {:else if isLoading}
    <div
      class="absolute inset-0 max-w-[80%] mx-auto text-center flex flex-col items-center justify-center text-gray-400 font-['HuiwenMincho'] opacity-50 pointer-events-none z-0"
    >
      <span class="text-3xl animate-bounce">{$t('knowledge_board.msg_generating')}</span>
    </div>
  {/if}

  {#if isFullscreen}
    <div
      class="absolute bottom-4 left-4 font-['HuiwenMincho'] text-2xl text-gray-400 pointer-events-none z-30 opacity-60"
    >
      <div class="flex items-center gap-2">
        <BrainCircuit size={28} />
        <span>{$t('knowledge_board.title')}</span>

        <span
          title={$t('knowledge_board.beta')}
          class="hover:cursor-help ml-2 px-1 py-0 text-xs bg-yellow-300 text-yellow-900 font-bold rounded-full border-2 border-yellow-900 pointer-events-auto"
        >
          BETA
        </span>
      </div>
    </div>
  {/if}

  <button
    on:click={toggleFullscreen}
    class="absolute bottom-4 right-4 z-50 p-3 rounded-full transition-all hover:scale-110 active:scale-95 text-gray-400"
  >
    {#if isFullscreen}
      <Minimize2 size={30} />
    {:else}
      <Maximize2 size={30} />
    {/if}
  </button>
</div>

<style>
  .bg-grid-pattern {
    background-color: #fdfbf7;
    background-image: linear-gradient(#e5e7eb 1px, transparent 1px),
      linear-gradient(90deg, #e5e7eb 1px, transparent 1px);
    background-size: 20px 20px;
  }

  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
