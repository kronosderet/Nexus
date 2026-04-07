import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Decision Guard — warn before creating redundant work.
 *
 * Given a proposed task title, returns similar existing tasks,
 * related decisions in The Ledger, and past sessions on the topic.
 * Lets the agent see if they're about to duplicate work.
 */
export function createGuardRoutes(store: NexusStore) {
  const router = Router();

  // GET /api/guard?title=... — check redundancy
  router.get('/', (req: Request, res: Response) => {
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    if (!title) return res.status(400).json({ error: 'Query parameter "title" required.' });
    res.json(store.checkForRedundancy(title));
  });

  return router;
}
