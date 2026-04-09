import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

export function createActivityRoutes(store: NexusStore) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    res.json(store.getActivity(limit));
  });

  router.post('/', (req: Request, res: Response) => {
    const { type, message, meta = '{}' } = req.body;
    let parsed = {};
    if (typeof meta === 'string') {
      try { parsed = JSON.parse(meta); } catch { parsed = {}; }
    } else {
      parsed = meta || {};
    }
    const entry = store.addActivity(type, message, parsed);
    res.status(201).json(entry);
  });

  return router;
}
