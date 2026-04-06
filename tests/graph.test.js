import { describe, it, expect, beforeEach } from 'vitest';

// ── GraphStore: focused test harness for knowledge graph ops ──────────
// Mirrors NexusStore graph + ledger methods for isolated testing.

class GraphStore {
  constructor() {
    this.ledger = [];
    this.graph_edges = [];
  }
  _now() { return new Date().toISOString(); }

  recordDecision({ decision, context = '', project = 'general', alternatives = [], tags = [] }) {
    const entry = {
      id: (this.ledger.length > 0 ? Math.max(...this.ledger.map(e => e.id)) : 0) + 1,
      decision, context, project, alternatives, tags, created_at: this._now(),
    };
    this.ledger.push(entry);
    return entry;
  }

  addEdge(fromId, toId, rel = 'related', note = '') {
    const exists = this.graph_edges.find(e => e.from === fromId && e.to === toId && e.rel === rel);
    if (exists) return exists;
    const edge = { id: this.graph_edges.length + 1, from: fromId, to: toId, rel, note, created_at: this._now() };
    this.graph_edges.push(edge);
    return edge;
  }

  removeEdge(id) {
    const idx = this.graph_edges.findIndex(e => e.id === id);
    if (idx === -1) return null;
    return this.graph_edges.splice(idx, 1)[0];
  }

  getEdgesFrom(id) { return this.graph_edges.filter(e => e.from === id); }
  getEdgesTo(id) { return this.graph_edges.filter(e => e.to === id); }
  getEdgesFor(id) { return this.graph_edges.filter(e => e.from === id || e.to === id); }

  traverse(startId, maxDepth = 3) {
    const visited = new Set();
    const result = [];
    const queue = [{ id: startId, depth: 0, path: [] }];
    while (queue.length > 0) {
      const { id, depth, path } = queue.shift();
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      const decision = this.ledger.find(d => d.id === id);
      if (decision) result.push({ ...decision, depth, path });
      for (const edge of this.getEdgesFor(id)) {
        const nextId = edge.from === id ? edge.to : edge.from;
        if (!visited.has(nextId)) queue.push({ id: nextId, depth: depth + 1, path: [...path, { edge: edge.rel, from: id, to: nextId }] });
      }
    }
    return result;
  }

  getGraph() {
    return {
      nodes: this.ledger.map(d => ({ id: d.id, label: d.decision.slice(0, 50), project: d.project, tags: d.tags || [] })),
      edges: this.graph_edges.map(e => ({ id: e.id, from: e.from, to: e.to, rel: e.rel, note: e.note })),
    };
  }

  // ── Derived analysis functions (tested here) ──────────

  /** Find the most connected node (highest degree centrality) */
  getMostConnected() {
    const degrees = {};
    for (const e of this.graph_edges) {
      degrees[e.from] = (degrees[e.from] || 0) + 1;
      degrees[e.to] = (degrees[e.to] || 0) + 1;
    }
    let maxId = null, maxDeg = 0;
    for (const [id, deg] of Object.entries(degrees)) {
      if (deg > maxDeg) { maxDeg = deg; maxId = Number(id); }
    }
    return maxId ? { id: maxId, degree: maxDeg } : null;
  }

  /** Count downstream impact: how many nodes reachable from startId via outbound edges */
  blastRadius(startId) {
    const visited = new Set();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of this.getEdgesFrom(id)) {
        if (!visited.has(edge.to)) queue.push(edge.to);
      }
    }
    visited.delete(startId); // don't count self
    return visited.size;
  }

  /** Find orphan decisions (no edges at all) */
  getOrphans() {
    const connected = new Set();
    for (const e of this.graph_edges) {
      connected.add(e.from);
      connected.add(e.to);
    }
    return this.ledger.filter(d => !connected.has(d.id));
  }

  /** Simple keyword overlap auto-link: find decisions sharing 2+ non-trivial words */
  findAutoLinks(minOverlap = 2) {
    const stopWords = new Set(['the', 'a', 'an', 'to', 'for', 'and', 'or', 'in', 'on', 'of', 'use', 'with']);
    const tokenize = (text) => text.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
    const links = [];

    for (let i = 0; i < this.ledger.length; i++) {
      const tokensA = new Set(tokenize(this.ledger[i].decision + ' ' + this.ledger[i].context));
      for (let j = i + 1; j < this.ledger.length; j++) {
        const tokensB = new Set(tokenize(this.ledger[j].decision + ' ' + this.ledger[j].context));
        const overlap = [...tokensA].filter(t => tokensB.has(t));
        if (overlap.length >= minOverlap) {
          links.push({ from: this.ledger[i].id, to: this.ledger[j].id, overlap });
        }
      }
    }
    return links;
  }
}


// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════

describe('Knowledge Graph Operations', () => {
  let g;
  beforeEach(() => { g = new GraphStore(); });

  describe('BFS Traversal', () => {
    it('traverses a linear chain at correct depths', () => {
      g.recordDecision({ decision: 'A' }); // id 1
      g.recordDecision({ decision: 'B' }); // id 2
      g.recordDecision({ decision: 'C' }); // id 3
      g.recordDecision({ decision: 'D' }); // id 4
      g.addEdge(1, 2, 'led_to');
      g.addEdge(2, 3, 'led_to');
      g.addEdge(3, 4, 'led_to');

      const result = g.traverse(1);
      expect(result.length).toBe(4);
      expect(result.map(r => r.depth)).toEqual([0, 1, 2, 3]);
    });

    it('respects maxDepth and stops early', () => {
      g.recordDecision({ decision: 'Root' });
      g.recordDecision({ decision: 'L1' });
      g.recordDecision({ decision: 'L2' });
      g.recordDecision({ decision: 'L3' });
      g.addEdge(1, 2, 'led_to');
      g.addEdge(2, 3, 'led_to');
      g.addEdge(3, 4, 'led_to');

      const result = g.traverse(1, 2);
      expect(result.length).toBe(3); // depth 0, 1, 2
      expect(result.every(r => r.depth <= 2)).toBe(true);
    });

    it('handles cycles without infinite loop', () => {
      g.recordDecision({ decision: 'A' });
      g.recordDecision({ decision: 'B' });
      g.recordDecision({ decision: 'C' });
      g.addEdge(1, 2, 'related');
      g.addEdge(2, 3, 'related');
      g.addEdge(3, 1, 'related');

      const result = g.traverse(1);
      expect(result.length).toBe(3);
      const ids = result.map(r => r.id);
      expect(new Set(ids).size).toBe(3); // all unique
    });

    it('returns path information for each visited node', () => {
      g.recordDecision({ decision: 'Root' });
      g.recordDecision({ decision: 'Child' });
      g.addEdge(1, 2, 'depends_on');

      const result = g.traverse(1);
      expect(result[0].path).toEqual([]); // root has empty path
      expect(result[1].path.length).toBe(1);
      expect(result[1].path[0].edge).toBe('depends_on');
    });

    it('returns only start node when no edges exist', () => {
      g.recordDecision({ decision: 'Isolated' });
      const result = g.traverse(1);
      expect(result.length).toBe(1);
      expect(result[0].decision).toBe('Isolated');
    });

    it('returns empty when start id has no matching decision', () => {
      const result = g.traverse(999);
      expect(result.length).toBe(0);
    });
  });

  describe('Centrality (most connected node)', () => {
    it('identifies the hub node', () => {
      g.recordDecision({ decision: 'Hub' });
      g.recordDecision({ decision: 'Spoke1' });
      g.recordDecision({ decision: 'Spoke2' });
      g.recordDecision({ decision: 'Spoke3' });
      g.addEdge(1, 2, 'related');
      g.addEdge(1, 3, 'related');
      g.addEdge(1, 4, 'related');

      const hub = g.getMostConnected();
      expect(hub.id).toBe(1);
      expect(hub.degree).toBe(3);
    });

    it('returns null on empty graph', () => {
      expect(g.getMostConnected()).toBeNull();
    });

    it('counts both inbound and outbound edges', () => {
      g.recordDecision({ decision: 'A' });
      g.recordDecision({ decision: 'B' });
      g.recordDecision({ decision: 'C' });
      g.addEdge(1, 2, 'led_to');
      g.addEdge(3, 2, 'depends_on');
      // Node 2 has degree 2 (one in, one out)
      const hub = g.getMostConnected();
      expect(hub.id).toBe(2);
      expect(hub.degree).toBe(2);
    });
  });

  describe('Blast radius (downstream impact)', () => {
    it('counts all downstream nodes via outbound edges', () => {
      g.recordDecision({ decision: 'Root' });
      g.recordDecision({ decision: 'A' });
      g.recordDecision({ decision: 'B' });
      g.recordDecision({ decision: 'C' });
      g.addEdge(1, 2, 'led_to');
      g.addEdge(1, 3, 'led_to');
      g.addEdge(2, 4, 'led_to');

      expect(g.blastRadius(1)).toBe(3); // A, B, C
    });

    it('returns 0 for leaf node', () => {
      g.recordDecision({ decision: 'Leaf' });
      expect(g.blastRadius(1)).toBe(0);
    });

    it('does not count upstream nodes', () => {
      g.recordDecision({ decision: 'Parent' });
      g.recordDecision({ decision: 'Child' });
      g.addEdge(1, 2, 'led_to');

      expect(g.blastRadius(2)).toBe(0); // child has no outbound
    });

    it('handles diamond dependencies without double counting', () => {
      // 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
      g.recordDecision({ decision: 'Root' });
      g.recordDecision({ decision: 'Left' });
      g.recordDecision({ decision: 'Right' });
      g.recordDecision({ decision: 'Merge' });
      g.addEdge(1, 2, 'led_to');
      g.addEdge(1, 3, 'led_to');
      g.addEdge(2, 4, 'led_to');
      g.addEdge(3, 4, 'led_to');

      expect(g.blastRadius(1)).toBe(3); // 2, 3, 4 (4 counted once)
    });
  });

  describe('Orphan detection', () => {
    it('finds decisions with no edges', () => {
      g.recordDecision({ decision: 'Connected A' });
      g.recordDecision({ decision: 'Connected B' });
      g.recordDecision({ decision: 'Orphan C' });
      g.addEdge(1, 2, 'related');

      const orphans = g.getOrphans();
      expect(orphans.length).toBe(1);
      expect(orphans[0].decision).toBe('Orphan C');
    });

    it('returns all decisions when no edges exist', () => {
      g.recordDecision({ decision: 'A' });
      g.recordDecision({ decision: 'B' });
      expect(g.getOrphans().length).toBe(2);
    });

    it('returns empty when all decisions are connected', () => {
      g.recordDecision({ decision: 'A' });
      g.recordDecision({ decision: 'B' });
      g.addEdge(1, 2, 'related');
      expect(g.getOrphans().length).toBe(0);
    });
  });

  describe('Auto-link keyword overlap', () => {
    it('finds links between decisions sharing keywords', () => {
      g.recordDecision({ decision: 'Use Express router for API', context: 'server architecture' });
      g.recordDecision({ decision: 'Express middleware for auth', context: 'server security' });
      g.recordDecision({ decision: 'React dashboard layout', context: 'client interface' });

      const links = g.findAutoLinks(2);
      // Decisions 1 and 2 share "express" and "server"
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links.some(l => l.from === 1 && l.to === 2)).toBe(true);
    });

    it('returns empty when no keyword overlap', () => {
      g.recordDecision({ decision: 'Alpha beta gamma' });
      g.recordDecision({ decision: 'Delta epsilon zeta' });

      const links = g.findAutoLinks(2);
      expect(links.length).toBe(0);
    });

    it('filters out stop words from overlap', () => {
      g.recordDecision({ decision: 'Use the system for the task' });
      g.recordDecision({ decision: 'Use the tool for the job' });

      // "the", "use", "for" are stop words -- only shared non-stop word check
      const links = g.findAutoLinks(2);
      // Should NOT match because shared words are stop words
      expect(links.length).toBe(0);
    });

    it('respects minOverlap threshold', () => {
      g.recordDecision({ decision: 'Redis caching layer optimization' });
      g.recordDecision({ decision: 'Redis performance tuning' });

      // Share only "redis" (1 word) -- minOverlap=2 should reject
      expect(g.findAutoLinks(2).length).toBe(0);
      // minOverlap=1 should find it
      expect(g.findAutoLinks(1).length).toBe(1);
    });
  });

  describe('getGraph structure', () => {
    it('returns correct node and edge counts', () => {
      g.recordDecision({ decision: 'Node A', project: 'P1', tags: ['t1'] });
      g.recordDecision({ decision: 'Node B', project: 'P2', tags: [] });
      g.addEdge(1, 2, 'depends_on', 'because');

      const graph = g.getGraph();
      expect(graph.nodes.length).toBe(2);
      expect(graph.edges.length).toBe(1);
      expect(graph.nodes[0].project).toBe('P1');
      expect(graph.edges[0].note).toBe('because');
    });

    it('truncates long decision labels to 50 chars', () => {
      const longDecision = 'A'.repeat(100);
      g.recordDecision({ decision: longDecision });
      const graph = g.getGraph();
      expect(graph.nodes[0].label.length).toBe(50);
    });
  });
});
