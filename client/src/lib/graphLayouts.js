/**
 * Graph layout algorithms for the Visual decision graph (Graph.jsx VisualView).
 *
 * Each layout takes `{ nodes, edges, width, height }` and returns the same
 * shape `{ positions, degree, components, nodeComponent }` so VisualView can
 * swap between them without changing render code.
 *
 * Extracted from Graph.jsx in v4.6.6 (#332). Pure functions — no React, no DOM.
 */

const HEIGHT_DEFAULT = 400;

// Deterministic per-node seed for reproducible initial positions.
function seededPos(id, width, height) {
  const seed = id * 9301 + 49297;
  const r1 = ((seed % 233280) / 233280);
  const r2 = (((seed * 13) % 233280) / 233280);
  return {
    x: width / 2 + (r1 - 0.5) * width * 0.7,
    y: height / 2 + (r2 - 0.5) * height * 0.7,
  };
}

function computeDegree(nodes, edges) {
  const degree = {};
  for (const n of nodes) degree[n.id] = 0;
  for (const e of edges) {
    if (degree[e.from] !== undefined) degree[e.from]++;
    if (degree[e.to] !== undefined) degree[e.to]++;
  }
  return degree;
}

// Union-find over (nodes, edges) → connected components.
function computeComponents(nodes, edges) {
  const parent = {};
  for (const n of nodes) parent[n.id] = n.id;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const e of edges) {
    if (parent[e.from] !== undefined && parent[e.to] !== undefined) {
      union(e.from, e.to);
    }
  }
  const roots = new Set();
  const nodeComponent = {};
  for (const n of nodes) {
    const root = find(n.id);
    roots.add(root);
    nodeComponent[n.id] = root;
  }
  return { components: roots.size, nodeComponent };
}

function emptyResult() {
  return { positions: {}, degree: {}, components: 0, nodeComponent: {} };
}

/**
 * Spring-embedder force-directed layout. Connected nodes pull together,
 * all nodes repel. Ported as-is from VisualView v4.4.x.
 */
export function forceDirectedLayout({ nodes, edges = [], width, height = HEIGHT_DEFAULT, iterations = 100 }) {
  if (!nodes || nodes.length === 0) return emptyResult();

  const positions = {};
  for (const n of nodes) positions[n.id] = seededPos(n.id, width, height);

  const degree = computeDegree(nodes, edges);

  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.6;
  const repel = k * k;
  const cooling = (i) => Math.max(0.01, 1 - i / iterations) * 6;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = {};
    for (const n of nodes) disp[n.id] = { x: 0, y: 0 };

    // Repulsion between every pair
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const na = nodes[a];
        const nb = nodes[b];
        const dx = positions[na.id].x - positions[nb.id].x;
        const dy = positions[na.id].y - positions[nb.id].y;
        const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const force = repel / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[na.id].x += fx; disp[na.id].y += fy;
        disp[nb.id].x -= fx; disp[nb.id].y -= fy;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const pa = positions[e.from];
      const pb = positions[e.to];
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[e.from].x -= fx; disp[e.from].y -= fy;
      disp[e.to].x += fx;   disp[e.to].y += fy;
    }

    // Apply with cooling + clamp into the canvas
    const temp = cooling(iter);
    for (const n of nodes) {
      const d = disp[n.id];
      const len = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
      const limited = Math.min(len, temp);
      positions[n.id].x += (d.x / len) * limited;
      positions[n.id].y += (d.y / len) * limited;
      positions[n.id].x = Math.max(20, Math.min(width - 20, positions[n.id].x));
      positions[n.id].y = Math.max(20, Math.min(height - 20, positions[n.id].y));
    }
  }

  const { components, nodeComponent } = computeComponents(nodes, edges);
  return { positions, degree, components, nodeComponent };
}

/**
 * Circular layout — all nodes evenly spaced on a single ring centered in the
 * canvas, sorted by id for determinism. Reuses the `theta = (i/size) * 2π - π/2`
 * pattern from ClusterMiniViz so the first node lands at the top.
 */
export function circularLayout({ nodes, edges = [], width, height = HEIGHT_DEFAULT }) {
  if (!nodes || nodes.length === 0) return emptyResult();

  const positions = {};
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(20, Math.min(width, height) / 2 - 30);
  const sorted = [...nodes].sort((a, b) => a.id - b.id);
  const size = sorted.length;
  for (let i = 0; i < size; i++) {
    const theta = (i / size) * Math.PI * 2 - Math.PI / 2;
    positions[sorted[i].id] = {
      x: cx + Math.cos(theta) * r,
      y: cy + Math.sin(theta) * r,
    };
  }

  const degree = computeDegree(nodes, edges);
  const { components, nodeComponent } = computeComponents(nodes, edges);
  return { positions, degree, components, nodeComponent };
}

/**
 * Hierarchical (BFS-layered) layout. For each connected component, picks the
 * highest-degree node as the root, runs BFS, and stacks nodes by BFS depth
 * (top-to-bottom). Multiple components share the canvas horizontally,
 * proportional to their size.
 */
export function hierarchicalLayout({ nodes, edges = [], width, height = HEIGHT_DEFAULT }) {
  if (!nodes || nodes.length === 0) return emptyResult();

  const degree = computeDegree(nodes, edges);
  const { components, nodeComponent } = computeComponents(nodes, edges);

  // Undirected adjacency for BFS — direction doesn't matter for layering.
  const adj = {};
  for (const n of nodes) adj[n.id] = [];
  for (const e of edges) {
    if (adj[e.from]) adj[e.from].push(e.to);
    if (adj[e.to]) adj[e.to].push(e.from);
  }

  // Group node ids by their component root.
  const byComponent = {};
  for (const n of nodes) {
    const root = nodeComponent[n.id];
    if (!byComponent[root]) byComponent[root] = [];
    byComponent[root].push(n);
  }

  const positions = {};
  const componentList = Object.values(byComponent);
  const totalNodes = nodes.length;
  let xOffset = 0;

  for (const compNodes of componentList) {
    const slabWidth = Math.max(80, width * (compNodes.length / totalNodes));

    // Pick highest-degree node as root for stable layering across renders;
    // tiebreak by lowest id so the shape doesn't flip on a degree tie.
    const root = compNodes.reduce((best, n) => {
      const dn = degree[n.id], db = degree[best.id];
      if (dn > db) return n;
      if (dn === db && n.id < best.id) return n;
      return best;
    }, compNodes[0]);

    // BFS to assign depth.
    const layer = {};
    const visited = new Set();
    const queue = [{ id: root.id, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      layer[id] = depth;
      for (const neighbor of (adj[id] || [])) {
        if (!visited.has(neighbor)) queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
    // Any node in this component not reached by BFS (shouldn't happen for a
    // truly-connected component, but guard against malformed adjacency).
    for (const n of compNodes) {
      if (!(n.id in layer)) layer[n.id] = 0;
    }

    // Group within the slab by depth.
    const layerNodes = {};
    for (const n of compNodes) {
      const d = layer[n.id];
      if (!layerNodes[d]) layerNodes[d] = [];
      layerNodes[d].push(n);
    }

    const maxDepth = Math.max(0, ...Object.keys(layerNodes).map(Number));
    const top = 30;
    const bottom = height - 30;
    const verticalSpan = Math.max(20, bottom - top);
    const layerY = (d) => maxDepth === 0 ? height / 2 : top + (d / maxDepth) * verticalSpan;

    for (const dStr of Object.keys(layerNodes)) {
      const d = Number(dStr);
      const layerN = layerNodes[d].sort((a, b) => a.id - b.id);
      const stride = slabWidth / (layerN.length + 1);
      for (let i = 0; i < layerN.length; i++) {
        positions[layerN[i].id] = {
          x: xOffset + (i + 1) * stride,
          y: layerY(d),
        };
      }
    }

    xOffset += slabWidth;
  }

  return { positions, degree, components, nodeComponent };
}

export const LAYOUT_FNS = {
  force: forceDirectedLayout,
  circular: circularLayout,
  hierarchical: hierarchicalLayout,
};

export const LAYOUTS = [
  { id: 'force', label: 'Force',
    tooltip: 'Spring-embedder. Connected nodes pull together, all nodes repel. Best for general structure (default).' },
  { id: 'circular', label: 'Circular',
    tooltip: 'All nodes evenly spaced on a ring, ordered by id. Best for seeing the full set at a glance.' },
  { id: 'hierarchical', label: 'Hierarchical',
    tooltip: 'BFS-layered top-to-bottom from the highest-degree node per component. Best for tracing causal/dependency chains.' },
];

export const DEFAULT_LAYOUT = 'force';
