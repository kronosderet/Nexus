/**
 * Centrality algorithm correctness — Brandes' betweenness + power-iter
 * eigenvector. Exercised via the `_centralityInternals` export rather than
 * the HTTP route so the algorithm contract is testable on tiny synthetic
 * graphs without spinning up an Express harness.
 *
 * Introduced in v4.7.9 (#301). Closes the Tier-3 deferred item: alternative
 * centrality ranking metrics. The point of these tests is structural
 * correctness on known shapes (path, star, two-node) — exact numeric values
 * cross-check against textbook results.
 */
import { describe, it, expect } from 'vitest';
import type { Decision, GraphEdge } from '../server/types.ts';
import { _centralityInternals } from '../server/routes/impact.ts';

const { computeBetweennessCentrality, computeEigenvectorCentrality, buildUndirectedAdjacency } = _centralityInternals;

// Helper: build N decisions with sequential ids 1..N. We don't care about
// timestamps for these tests — algorithms only read id + project off Decision.
function makeDecisions(n: number): Decision[] {
  const out: Decision[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: i,
      decision: `Decision ${i}`,
      project: 'test',
      created_at: new Date().toISOString(),
    } as Decision);
  }
  return out;
}

// Helper: minimal edge — algorithms only read from/to, not rel/created_at.
function makeEdge(from: number, to: number, id = from * 1000 + to): GraphEdge {
  return {
    id,
    from,
    to,
    rel: 'related',
    note: '',
    created_at: new Date().toISOString(),
  } as GraphEdge;
}

describe('buildUndirectedAdjacency', () => {
  it('produces symmetric adjacency for each edge', () => {
    const decisions = makeDecisions(3);
    const edges = [makeEdge(1, 2), makeEdge(2, 3)];
    const adj = buildUndirectedAdjacency(decisions, edges);
    expect(adj.get(1)).toContain(2);
    expect(adj.get(2)).toContain(1);
    expect(adj.get(2)).toContain(3);
    expect(adj.get(3)).toContain(2);
  });

  it('returns empty arrays for nodes with no edges', () => {
    const decisions = makeDecisions(3);
    const edges: GraphEdge[] = [makeEdge(1, 2)];
    const adj = buildUndirectedAdjacency(decisions, edges);
    expect(adj.get(3)).toEqual([]);
  });

  it('handles an empty graph', () => {
    const adj = buildUndirectedAdjacency([], []);
    expect(adj.size).toBe(0);
  });
});

describe('computeBetweennessCentrality', () => {
  it('returns 0 for every node in an empty graph', () => {
    const result = computeBetweennessCentrality([], []);
    expect(result).toEqual({});
  });

  it('returns 0 for every node when there are no edges', () => {
    const decisions = makeDecisions(3);
    const result = computeBetweennessCentrality(decisions, []);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
  });

  it('returns 0 for both endpoints of a two-node graph', () => {
    // No path passes through either — there are only two nodes.
    const decisions = makeDecisions(2);
    const edges = [makeEdge(1, 2)];
    const result = computeBetweennessCentrality(decisions, edges);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('star graph: center has high betweenness, leaves have zero', () => {
    // Center = 1; leaves = 2,3,4,5. Every leaf-to-leaf shortest path goes
    // through the center. Leaves are dead-ends — no path passes through them.
    const decisions = makeDecisions(5);
    const edges = [
      makeEdge(1, 2),
      makeEdge(1, 3),
      makeEdge(1, 4),
      makeEdge(1, 5),
    ];
    const result = computeBetweennessCentrality(decisions, edges);
    expect(result[1]).toBeGreaterThan(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
    expect(result[4]).toBe(0);
    expect(result[5]).toBe(0);
    // Star with 4 leaves has C(4,2) = 6 shortest paths through center.
    expect(result[1]).toBe(6);
  });

  it('path graph: middle nodes have higher betweenness than endpoints', () => {
    // Path 1 - 2 - 3 - 4 - 5. Endpoints (1, 5) sit on no shortest path.
    // Node 3 (the dead center) sits on the most paths.
    const decisions = makeDecisions(5);
    const edges = [
      makeEdge(1, 2),
      makeEdge(2, 3),
      makeEdge(3, 4),
      makeEdge(4, 5),
    ];
    const result = computeBetweennessCentrality(decisions, edges);
    expect(result[1]).toBe(0);
    expect(result[5]).toBe(0);
    expect(result[3]).toBeGreaterThan(result[2]);
    expect(result[3]).toBeGreaterThan(result[4]);
    // Textbook value for a 5-path: middle node has betweenness 6
    // (paths 1-3, 1-4, 1-5, 2-4, 2-5, 3-5 all go through node 3 — wait, no:
    // path 1-3 ends at 3, doesn't pass through it. The paths *through* node 3
    // are: 1-4, 1-5, 2-4, 2-5 = 4 paths, but 1-5 also passes through 2,3,4.
    // Brandes counts each "through" once per shortest path. For 5-path, node
    // 3 betweenness = 4 (the 4 cross-pair paths that strictly go through it).
    expect(result[3]).toBe(4);
  });

  it('handles disconnected components without crashing', () => {
    // Two separate edges — components {1,2} and {3,4}. No paths cross.
    const decisions = makeDecisions(4);
    const edges = [makeEdge(1, 2), makeEdge(3, 4)];
    const result = computeBetweennessCentrality(decisions, edges);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
    expect(result[4]).toBe(0);
  });
});

describe('computeEigenvectorCentrality', () => {
  it('returns empty for an empty graph', () => {
    const result = computeEigenvectorCentrality([], []);
    expect(result).toEqual({});
  });

  it('returns 0 for every node when there are no edges', () => {
    // Power iteration on a zero matrix collapses to the zero vector after the
    // first multiplication — every node's score becomes 0.
    const decisions = makeDecisions(3);
    const result = computeEigenvectorCentrality(decisions, []);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(0);
  });

  it('two-node graph: both nodes have equal eigenvector centrality', () => {
    const decisions = makeDecisions(2);
    const edges = [makeEdge(1, 2)];
    const result = computeEigenvectorCentrality(decisions, edges);
    expect(result[1]).toBeCloseTo(result[2], 4);
    expect(result[1]).toBeGreaterThan(0);
  });

  it('star graph: center has higher eigenvector centrality than leaves', () => {
    // Center = 1; leaves = 2..6. Center is connected to everyone influential
    // (recursively); leaves are only connected to the center.
    const decisions = makeDecisions(6);
    const edges = [
      makeEdge(1, 2),
      makeEdge(1, 3),
      makeEdge(1, 4),
      makeEdge(1, 5),
      makeEdge(1, 6),
    ];
    const result = computeEigenvectorCentrality(decisions, edges);
    expect(result[1]).toBeGreaterThan(result[2]);
    expect(result[1]).toBeGreaterThan(result[3]);
    // All leaves have equal eigenvector by symmetry
    expect(result[2]).toBeCloseTo(result[3], 4);
    expect(result[3]).toBeCloseTo(result[4], 4);
  });

  it('values are L2-normalized — sum of squares ≈ 1 for the connected component', () => {
    const decisions = makeDecisions(4);
    const edges = [
      makeEdge(1, 2),
      makeEdge(2, 3),
      makeEdge(3, 4),
      makeEdge(4, 1),
    ]; // 4-cycle
    const result = computeEigenvectorCentrality(decisions, edges);
    let sumSq = 0;
    for (const id of [1, 2, 3, 4]) sumSq += (result[id] || 0) ** 2;
    expect(sumSq).toBeCloseTo(1, 3);
  });
});
