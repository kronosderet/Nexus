import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Thought Stack — interrupt-recovery working memory.
 *
 * Different from tasks (work units) and notes (passive log).
 * It's a LIFO stack: push when interrupted mid-thought,
 * pop when returning to recover what you were doing.
 */
export function createThoughtRoutes(store: NexusStore, broadcast: (data: any) => void) {
  const router = Router();

  // GET /api/thoughts — list active thoughts (or all with ?all=true)
  router.get('/', (req: Request, res: Response) => {
    const all = req.query.all === 'true' || req.query.all === '1';
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status as any : undefined;

    if (all) {
      res.json(store.getAllThoughts({ project, status, limit: 50 }));
    } else {
      res.json(store.getActiveThoughts(project));
    }
  });

  // POST /api/thoughts — push a new thought onto the stack
  router.post('/', (req: Request, res: Response) => {
    const { text, context, project, related_task_id } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Thought text required.' });
    const thought = store.pushThought({ text, context, project, related_task_id });

    const entry = store.addActivity('thought', `Pushed thought: ${text.slice(0, 60)}`);
    broadcast({ type: 'activity', payload: entry });
    res.status(201).json(thought);
  });

  // POST /api/thoughts/pop — pop most recent (or specific id)
  router.post('/pop', (req: Request, res: Response) => {
    const { id } = req.body || {};
    const thought = store.popThought(id);
    if (!thought) return res.status(404).json({ error: 'No active thoughts to pop.' });
    const entry = store.addActivity('thought', `Popped thought #${thought.id}: ${thought.text.slice(0, 60)}`);
    broadcast({ type: 'activity', payload: entry });
    res.json(thought);
  });

  // PATCH /api/thoughts/:id/abandon — abandon a thought (didn't matter)
  router.patch('/:id/abandon', (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const reason = req.body?.reason || '';
    const thought = store.abandonThought(id, reason);
    if (!thought) return res.status(404).json({ error: 'Thought not found.' });
    res.json(thought);
  });

  return router;
}
