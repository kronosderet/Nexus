import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * The Advice Journal
 *
 * Records every recommendation the Overseer makes, tracks whether
 * it was accepted, and measures outcome. Feeds the history back
 * into future Overseer prompts — the self-improving loop.
 */
export function createAdviceRoutes(store: NexusStore) {
  const router = Router();

  // List recent advice (optionally filtered)
  router.get('/', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const onlyUnjudged = req.query.unjudged === 'true' || req.query.unjudged === '1';
    res.json(store.getAdvice({ limit, source, onlyUnjudged }));
  });

  // Aggregate patterns: accuracy, acceptance rate, by source
  router.get('/patterns', (_req: Request, res: Response) => {
    res.json(store.getAdvicePatterns());
  });

  // Get a single advice entry
  router.get('/:id', (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const entry = (store.data.advice || []).find(a => a.id === id);
    if (!entry) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(entry);
  });

  // Record advice manually (most are auto-logged from Overseer routes)
  router.post('/', (req: Request, res: Response) => {
    const { source = 'overseer', question = '', recommendation } = req.body;
    if (!recommendation) return res.status(400).json({ error: 'Recommendation text required.' });
    const entry = store.recordAdvice({ source, question, recommendation });
    if (!entry) return res.json({ deduped: true, message: 'Recent duplicate, not recorded.' });
    res.status(201).json(entry);
  });

  // Record user verdict on advice
  router.patch('/:id/verdict', (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const { accepted, outcome, notes, measured_fuel_cost } = req.body;
    const updated = store.updateAdviceVerdict(id, { accepted, outcome, notes, measured_fuel_cost });
    if (!updated) return res.status(404).json({ error: 'Advice not found.' });
    res.json(updated);
  });

  return router;
}
