import { describe, it, expect } from 'vitest';
import {
  forceDirectedLayout,
  circularLayout,
  hierarchicalLayout,
  LAYOUT_FNS,
  LAYOUTS,
  DEFAULT_LAYOUT,
} from '../client/src/lib/graphLayouts.js';

// ── Test fixtures ──────────────────────────────────────────────
const W = 800;
const H = 400;

function chain(n) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ id: i + 1, from: i + 1, to: i + 2, rel: 'led_to' }));
  return { nodes, edges };
}

function star(spokes) {
  const nodes = [{ id: 1 }, ...Array.from({ length: spokes }, (_, i) => ({ id: i + 2 }))];
  const edges = Array.from({ length: spokes }, (_, i) => ({ id: i + 1, from: 1, to: i + 2, rel: 'related' }));
  return { nodes, edges };
}

// Two-component fixture: chain {1→2→3} and isolated node {4}
function twoComponents() {
  return {
    nodes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    edges: [
      { id: 1, from: 1, to: 2, rel: 'led_to' },
      { id: 2, from: 2, to: 3, rel: 'led_to' },
    ],
  };
}

const eachLayout = [
  ['force', forceDirectedLayout],
  ['circular', circularLayout],
  ['hierarchical', hierarchicalLayout],
];

// ═════════════════════════════════════════════════════════════════
// Shared shape contract — every layout must return the same shape
// ═════════════════════════════════════════════════════════════════

describe('graphLayouts — shared contract', () => {
  for (const [name, fn] of eachLayout) {
    describe(`${name}`, () => {
      it('returns positions for every node', () => {
        const { nodes, edges } = chain(5);
        const out = fn({ nodes, edges, width: W, height: H });
        for (const n of nodes) {
          expect(out.positions[n.id]).toBeDefined();
          expect(typeof out.positions[n.id].x).toBe('number');
          expect(typeof out.positions[n.id].y).toBe('number');
        }
      });

      it('keeps positions inside the canvas bounds', () => {
        const { nodes, edges } = chain(8);
        const out = fn({ nodes, edges, width: W, height: H });
        for (const id of Object.keys(out.positions)) {
          const p = out.positions[id];
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(W);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(H);
        }
      });

      it('returns degree for every node', () => {
        const { nodes, edges } = star(4);
        const out = fn({ nodes, edges, width: W, height: H });
        // Hub has degree 4, each spoke has degree 1
        expect(out.degree[1]).toBe(4);
        expect(out.degree[2]).toBe(1);
        expect(out.degree[3]).toBe(1);
        expect(out.degree[4]).toBe(1);
        expect(out.degree[5]).toBe(1);
      });

      it('counts connected components', () => {
        const out = fn({ ...twoComponents(), width: W, height: H });
        expect(out.components).toBe(2);
        // Same component for the chain nodes
        expect(out.nodeComponent[1]).toBe(out.nodeComponent[2]);
        expect(out.nodeComponent[2]).toBe(out.nodeComponent[3]);
        // Isolated node has its own component
        expect(out.nodeComponent[4]).not.toBe(out.nodeComponent[1]);
      });

      it('handles empty graph gracefully', () => {
        const out = fn({ nodes: [], edges: [], width: W, height: H });
        expect(out.positions).toEqual({});
        expect(out.components).toBe(0);
      });

      it('handles a single node', () => {
        const out = fn({ nodes: [{ id: 1 }], edges: [], width: W, height: H });
        expect(out.positions[1]).toBeDefined();
        expect(out.components).toBe(1);
        expect(out.degree[1]).toBe(0);
      });

      it('is deterministic — same input twice gives identical positions', () => {
        const a = fn({ ...chain(6), width: W, height: H });
        const b = fn({ ...chain(6), width: W, height: H });
        expect(a.positions).toEqual(b.positions);
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════
// Circular layout — geometric properties
// ═════════════════════════════════════════════════════════════════

describe('circularLayout — geometry', () => {
  it('places all nodes equidistant from the center', () => {
    const { nodes, edges } = chain(8);
    const out = circularLayout({ nodes, edges, width: W, height: H });
    const cx = W / 2;
    const cy = H / 2;
    const distances = Object.values(out.positions).map(p =>
      Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
    );
    const first = distances[0];
    for (const d of distances) {
      // All radii within a hair of each other (floating-point slack only)
      expect(Math.abs(d - first)).toBeLessThan(0.01);
    }
  });

  it('places the lowest-id node at the top of the ring', () => {
    const { nodes, edges } = chain(6);
    const out = circularLayout({ nodes, edges, width: W, height: H });
    // Node 1 should have the smallest y (top of canvas)
    const p1 = out.positions[1];
    for (const id of Object.keys(out.positions)) {
      if (Number(id) === 1) continue;
      expect(p1.y).toBeLessThanOrEqual(out.positions[id].y + 0.01);
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// Hierarchical layout — layering properties
// ═════════════════════════════════════════════════════════════════

describe('hierarchicalLayout — layering', () => {
  it('stacks a chain top-to-bottom by BFS depth', () => {
    // Chain 1→2→3→4. Highest-degree node ties at degree 1 for the endpoints
    // and degree 2 for the middle nodes. Tiebreak by lowest id picks node 2.
    // BFS from 2: depth 0 = {2}, depth 1 = {1, 3}, depth 2 = {4}.
    // So y(2) < y(1) ≈ y(3) < y(4).
    const { nodes, edges } = chain(4);
    const out = hierarchicalLayout({ nodes, edges, width: W, height: H });
    expect(out.positions[2].y).toBeLessThan(out.positions[1].y);
    expect(out.positions[2].y).toBeLessThan(out.positions[3].y);
    expect(out.positions[1].y).toBeLessThan(out.positions[4].y);
    expect(out.positions[3].y).toBeLessThan(out.positions[4].y);
  });

  it('places the highest-degree node at the top in a star', () => {
    const { nodes, edges } = star(5);
    const out = hierarchicalLayout({ nodes, edges, width: W, height: H });
    // Hub is node 1 with degree 5; spokes are nodes 2-6 with degree 1.
    // Hub goes to depth 0 (top), spokes to depth 1.
    const hubY = out.positions[1].y;
    for (let id = 2; id <= 6; id++) {
      expect(out.positions[id].y).toBeGreaterThan(hubY);
    }
  });

  it('separates components into horizontal slabs', () => {
    // Two components: chain 1→2→3 and isolated node 4.
    // Each slab is allocated proportional width; the isolated node should not
    // share an x with the chain nodes.
    const out = hierarchicalLayout({ ...twoComponents(), width: W, height: H });
    const chainXs = [out.positions[1].x, out.positions[2].x, out.positions[3].x];
    const isoX = out.positions[4].x;
    // Isolated node's x must lie outside the [min, max] of the chain xs.
    const minChainX = Math.min(...chainXs);
    const maxChainX = Math.max(...chainXs);
    const inSlab = isoX >= minChainX - 1 && isoX <= maxChainX + 1;
    expect(inSlab).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// Force-directed — preserved behavior from the v4.4.x inline impl
// ═════════════════════════════════════════════════════════════════

describe('forceDirectedLayout — physics', () => {
  it('pulls connected nodes closer than disconnected pairs (on average)', () => {
    // Star with 5 spokes connected to a hub, plus 2 isolated nodes.
    // Mean edge length should be smaller than mean hub-to-isolated distance.
    const nodes = [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, // hub + spokes
      { id: 7 }, { id: 8 },                                              // isolated
    ];
    const edges = [
      { id: 1, from: 1, to: 2, rel: 'related' },
      { id: 2, from: 1, to: 3, rel: 'related' },
      { id: 3, from: 1, to: 4, rel: 'related' },
      { id: 4, from: 1, to: 5, rel: 'related' },
      { id: 5, from: 1, to: 6, rel: 'related' },
    ];
    const out = forceDirectedLayout({ nodes, edges, width: W, height: H });
    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const edgeLen = edges.reduce((s, e) => s + dist(out.positions[e.from], out.positions[e.to]), 0) / edges.length;
    const isolatedToHub = (dist(out.positions[7], out.positions[1]) + dist(out.positions[8], out.positions[1])) / 2;
    expect(edgeLen).toBeLessThan(isolatedToHub);
  });

  it('respects a custom iteration count (smoke check — runs without throwing)', () => {
    const { nodes, edges } = chain(3);
    expect(() =>
      forceDirectedLayout({ nodes, edges, width: W, height: H, iterations: 5 })
    ).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════
// Registry sanity
// ═════════════════════════════════════════════════════════════════

describe('LAYOUT_FNS registry', () => {
  it('exposes one function per LAYOUTS entry', () => {
    expect(Object.keys(LAYOUT_FNS).sort()).toEqual(LAYOUTS.map(l => l.id).sort());
    for (const l of LAYOUTS) {
      expect(typeof LAYOUT_FNS[l.id]).toBe('function');
    }
  });

  it('DEFAULT_LAYOUT is a registered layout id', () => {
    expect(LAYOUTS.some(l => l.id === DEFAULT_LAYOUT)).toBe(true);
  });

  it('every layout entry has a tooltip explaining when to use it', () => {
    for (const l of LAYOUTS) {
      expect(l.tooltip).toBeTruthy();
      expect(l.tooltip.length).toBeGreaterThan(20);
    }
  });
});
