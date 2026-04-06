import { Router } from 'express';

export function createLedgerRoutes(store, broadcast) {
  const router = Router();

  // List decisions
  router.get('/', (req, res) => {
    const { project, tag, limit } = req.query;
    res.json(store.getLedger({ project, tag, limit: parseInt(limit) || 50 }));
  });

  // Record a decision
  router.post('/', (req, res) => {
    const { decision, context, project, alternatives, tags } = req.body;
    if (!decision) return res.status(400).json({ error: 'Decision text required.' });

    const entry = store.recordDecision({
      decision,
      context: context || '',
      project: project || 'general',
      alternatives: alternatives || [],
      tags: tags || [],
    });

    const actEntry = store.addActivity('decision', `Decision recorded -- [${entry.project}] ${decision.slice(0, 60)}`);
    broadcast({ type: 'activity', payload: actEntry });
    res.status(201).json(entry);
  });

  // Auto-extract decisions from all sessions
  router.post('/extract', (req, res) => {
    const sessions = store.getSessions({ limit: 100 });
    const existing = new Set((store.data.ledger || []).map(l => l.decision.toLowerCase().slice(0, 60)));
    let added = 0;

    for (const s of sessions) {
      for (const d of (s.decisions || [])) {
        const key = d.toLowerCase().slice(0, 60);
        if (existing.has(key)) continue;
        store.recordDecision({
          decision: d,
          context: s.summary.slice(0, 200),
          project: s.project,
          alternatives: [],
          tags: s.tags || [],
        });
        existing.add(key);
        added++;
      }
    }

    res.json({ extracted: added, total: (store.data.ledger || []).length });
  });

  // Auto-link: use AI to find relationships between decisions
  router.post('/auto-link', async (req, res) => {
    const decisions = store.getLedger({ limit: 60 });
    if (decisions.length < 2) return res.json({ linked: 0 });

    // Group by project for intra-project linking
    const byProject = {};
    for (const d of decisions) {
      if (!byProject[d.project]) byProject[d.project] = [];
      byProject[d.project].push(d);
    }

    let linked = 0;
    const existingEdges = new Set(store.data.graph_edges.map(e => `${e.from}-${e.to}`));

    for (const [project, decs] of Object.entries(byProject)) {
      // Link sequential decisions in same project (temporal chain)
      const sorted = [...decs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      for (let i = 0; i < sorted.length - 1; i++) {
        const key = `${sorted[i].id}-${sorted[i+1].id}`;
        const keyRev = `${sorted[i+1].id}-${sorted[i].id}`;
        if (!existingEdges.has(key) && !existingEdges.has(keyRev)) {
          store.addEdge(sorted[i].id, sorted[i + 1].id, 'led_to', `Sequential in ${project}`);
          existingEdges.add(key);
          linked++;
        }
      }

      // Link decisions that share keywords (semantic similarity via text overlap)
      for (let i = 0; i < decs.length; i++) {
        for (let j = i + 1; j < decs.length; j++) {
          const key = `${decs[i].id}-${decs[j].id}`;
          const keyRev = `${decs[j].id}-${decs[i].id}`;
          if (existingEdges.has(key) || existingEdges.has(keyRev)) continue;

          const wordsA = new Set(decs[i].decision.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const wordsB = new Set(decs[j].decision.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const overlap = [...wordsA].filter(w => wordsB.has(w)).length;

          if (overlap >= 2) {
            store.addEdge(decs[i].id, decs[j].id, 'related', `Shared terms: ${[...wordsA].filter(w => wordsB.has(w)).join(', ')}`);
            existingEdges.add(key);
            linked++;
          }
        }
      }
    }

    // Cross-project: link decisions with same tags
    const byTag = {};
    for (const d of decisions) {
      for (const t of (d.tags || [])) {
        if (!byTag[t]) byTag[t] = [];
        byTag[t].push(d);
      }
    }
    for (const [tag, decs] of Object.entries(byTag)) {
      for (let i = 0; i < decs.length; i++) {
        for (let j = i + 1; j < decs.length; j++) {
          if (decs[i].project === decs[j].project) continue; // already linked above
          const key = `${decs[i].id}-${decs[j].id}`;
          const keyRev = `${decs[j].id}-${decs[i].id}`;
          if (existingEdges.has(key) || existingEdges.has(keyRev)) continue;
          store.addEdge(decs[i].id, decs[j].id, 'related', `Shared tag: ${tag}`);
          existingEdges.add(key);
          linked++;
        }
      }
    }

    const entry = store.addActivity('graph', `Knowledge Graph: auto-linked ${linked} connections`);
    broadcast({ type: 'activity', payload: entry });
    res.json({ linked, totalEdges: store.data.graph_edges.length });
  });

  // ── Knowledge Graph edges ──────────────

  // Link two decisions
  router.post('/link', (req, res) => {
    const { from, to, rel = 'related', note = '' } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to decision IDs required.' });
    const edge = store.addEdge(Number(from), Number(to), rel, note);
    res.status(201).json(edge);
  });

  // Remove a link
  router.delete('/link/:id', (req, res) => {
    const removed = store.removeEdge(Number(req.params.id));
    if (!removed) return res.status(404).json({ error: 'Edge not found.' });
    res.json({ success: true });
  });

  // Get all connections for a decision
  router.get('/:id/connections', (req, res) => {
    const id = Number(req.params.id);
    const decision = store.data.ledger.find(d => d.id === id);
    if (!decision) return res.status(404).json({ error: 'Decision not found.' });

    const edges = store.getEdgesFor(id);
    const connected = edges.map(e => {
      const otherId = e.from === id ? e.to : e.from;
      const other = store.data.ledger.find(d => d.id === otherId);
      return { edge: e, decision: other };
    }).filter(c => c.decision);

    res.json({ decision, connected });
  });

  // Traverse the graph from a starting decision
  router.get('/:id/traverse', (req, res) => {
    const id = Number(req.params.id);
    const depth = parseInt(req.query.depth) || 3;
    const chain = store.traverse(id, depth);
    res.json({ startId: id, depth, chain });
  });

  // Full graph for visualization
  router.get('/graph/full', (req, res) => {
    res.json(store.getGraph());
  });

  return router;
}
