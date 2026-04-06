import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

export function createSearchRoutes(store: NexusStore) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q required.' });
    res.json(store.search(q as string, parseInt(limit as string) || 30));
  });

  return router;
}
