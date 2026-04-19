import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { Decision, GraphEdge } from '../types.ts';

type BroadcastFn = (data: unknown) => void;

export function createLedgerRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  // List decisions
  router.get('/', (req: Request, res: Response) => {
    const { project, tag, limit } = req.query;
    res.json(store.getLedger({ project: project as string, tag: tag as string, limit: parseInt(limit as string) || 50 }));
  });

  // Record a decision
  router.post('/', (req: Request, res: Response) => {
    const { decision, context, project, alternatives, tags } = req.body;
    if (!decision?.trim()) return res.status(400).json({ error: 'Decision text required.' });

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

  // Deprecate a decision
  router.patch('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { deprecated, decision: text, context, alternatives, tags, project, lifecycle, confidence, last_reviewed_at } = req.body;
    const existing = store.getDecisionById(id);
    if (!existing) return res.status(404).json({ error: 'Decision not found.' });
    if (deprecated !== undefined) { existing.deprecated = !!deprecated; store._flush(); }
    const updates: Partial<Decision> = {};
    if (text !== undefined) updates.decision = text;
    if (context !== undefined) updates.context = context;
    if (alternatives !== undefined) updates.alternatives = alternatives;
    if (tags !== undefined) updates.tags = tags;
    if (project !== undefined) updates.project = project;
    if (lifecycle !== undefined) updates.lifecycle = lifecycle;
    if (confidence !== undefined) updates.confidence = confidence;
    if (last_reviewed_at !== undefined) updates.last_reviewed_at = last_reviewed_at;
    if (Object.keys(updates).length > 0) store.updateDecision(id, updates);
    broadcast({ type: 'decision_update', payload: store.getDecisionById(id) });
    res.json(store.getDecisionById(id));
  });

  // Auto-extract decisions from all sessions
  router.post('/extract', (req: Request, res: Response) => {
    const sessions = store.getSessions({ limit: 100 });
    const existing = new Set((store.getAllDecisions()).map((l: Decision) => l.decision.toLowerCase().slice(0, 60)));
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

    res.json({ extracted: added, total: (store.getAllDecisions()).length });
  });

  // Auto-link: find relationships between decisions via temporal + keyword + tag heuristics.
  // v4.3.10 #272 — supports ?dry_run=true (or body.dry_run=true) which returns the counts +
  // up to 10 sample proposed edges without writing. Lets the UI preview scope before committing.
  router.post('/auto-link', async (req: Request, res: Response) => {
    const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === true;
    const decisions = store.getLedger({ limit: 60 });
    if (decisions.length < 2) return res.json({ linked: 0, dryRun, samples: [] });

    // Group by project for intra-project linking
    const byProject: Record<string, Decision[]> = {};
    for (const d of decisions) {
      if (!byProject[d.project]) byProject[d.project] = [];
      byProject[d.project].push(d);
    }

    let linked = 0;
    const samples: Array<{ from: number; to: number; rel: string; note: string }> = [];
    const existingEdges = new Set(store.getAllEdges().map((e: GraphEdge) => `${e.from}-${e.to}`));
    const commit = (from: number, to: number, rel: GraphEdge['rel'], note: string) => {
      if (dryRun) {
        if (samples.length < 10) samples.push({ from, to, rel, note });
      } else {
        store.addEdge(from, to, rel, note);
      }
      const key = `${from}-${to}`;
      existingEdges.add(key);
      linked++;
    };

    for (const [project, decs] of Object.entries(byProject)) {
      // Link sequential decisions in same project (temporal chain)
      const sorted = [...decs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (let i = 0; i < sorted.length - 1; i++) {
        const key = `${sorted[i].id}-${sorted[i+1].id}`;
        const keyRev = `${sorted[i+1].id}-${sorted[i].id}`;
        if (!existingEdges.has(key) && !existingEdges.has(keyRev)) {
          commit(sorted[i].id, sorted[i + 1].id, 'led_to', `Sequential in ${project}`);
        }
      }

      // Link decisions that share keywords (text overlap)
      for (let i = 0; i < decs.length; i++) {
        for (let j = i + 1; j < decs.length; j++) {
          const key = `${decs[i].id}-${decs[j].id}`;
          const keyRev = `${decs[j].id}-${decs[i].id}`;
          if (existingEdges.has(key) || existingEdges.has(keyRev)) continue;

          const wordsA = new Set(decs[i].decision.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
          const wordsB = new Set(decs[j].decision.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
          const shared = [...wordsA].filter(w => wordsB.has(w));

          if (shared.length >= 2) {
            commit(decs[i].id, decs[j].id, 'related', `Shared terms: ${shared.join(', ')}`);
          }
        }
      }
    }

    // Cross-project: link decisions with same tags.
    // v4.4.1 #314 — blacklist generic tags that every project uses as metadata. Without this
    // guard, `milestone` (52 edges) + `github` (16 edges) dominated the Nexus ↔ Firewall-Godot
    // cross-project graph with 68/77 false positives. These tags label "version shipping" and
    // "github repo created" which every project does; shared values don't imply coupling.
    const GENERIC_TAGS = new Set([
      'milestone', 'shipped', 'released', 'release', 'audit', 'polish',
      'github', 'git', 'hygiene-migration', 'version', 'versioning',
    ]);
    const isGenericTag = (t: string) => GENERIC_TAGS.has(t.toLowerCase()) || /^v\d/i.test(t);

    const byTag: Record<string, Decision[]> = {};
    for (const d of decisions) {
      for (const t of (d.tags || [])) {
        if (isGenericTag(t)) continue;
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
          commit(decs[i].id, decs[j].id, 'related', `Shared tag: ${tag}`);
        }
      }
    }

    if (!dryRun && linked > 0) {
      const entry = store.addActivity('graph', `Knowledge Graph: auto-linked ${linked} connections`);
      broadcast({ type: 'activity', payload: entry });
    }
    res.json({ linked, totalEdges: store.getAllEdges().length, dryRun, samples });
  });

  // ── Knowledge Graph edges ──────────────

  // Link two decisions
  router.post('/link', (req: Request, res: Response) => {
    const { from, to, rel = 'related', note = '' } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to decision IDs required.' });
    const edge = store.addEdge(Number(from), Number(to), rel, note);
    res.status(201).json(edge);
  });

  // Remove a link
  router.delete('/link/:id', (req: Request, res: Response) => {
    const removed = store.removeEdge(Number(req.params.id));
    if (!removed) return res.status(404).json({ error: 'Edge not found.' });
    res.json({ success: true });
  });

  // Get all connections for a decision
  router.get('/:id/connections', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const decision = store.getDecisionById( id);
    if (!decision) return res.status(404).json({ error: 'Decision not found.' });

    const edges = store.getEdgesFor(id);
    const connected = edges.map((e: GraphEdge) => {
      const otherId = e.from === id ? e.to : e.from;
      const other = store.getDecisionById(otherId);
      return { edge: e, decision: other };
    }).filter((c): c is { edge: GraphEdge; decision: Decision } => Boolean(c.decision));

    res.json({ decision, connected });
  });

  // Traverse the graph from a starting decision
  router.get('/:id/traverse', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const depth = Math.min(parseInt(req.query.depth as string) || 3, 10);
    const chain = store.traverse(id, depth);
    res.json({ startId: id, depth, chain });
  });

  // Full graph for visualization
  router.get('/graph/full', (req: Request, res: Response) => {
    res.json(store.getGraph());
  });

  return router;
}
