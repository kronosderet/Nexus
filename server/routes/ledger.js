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

  return router;
}
