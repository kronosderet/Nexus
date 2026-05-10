import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import { validateBody } from '../lib/validate.ts';
import { NewActivitySchema } from '../lib/validators.ts';

export function createActivityRoutes(store: NexusStore) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    res.json(store.getActivity(limit));
  });

  router.post('/', (req: Request, res: Response) => {
    // v4.8.0 #219 — Zod validation. message required; meta is free-form so it
    // stays out of the schema and gets parsed below as before.
    const body = validateBody(NewActivitySchema, req, res);
    if (!body) return;
    const meta = req.body?.meta ?? '{}';
    let parsed = {};
    if (typeof meta === 'string') {
      try { parsed = JSON.parse(meta); } catch { parsed = {}; }
    } else {
      parsed = meta || {};
    }
    const entry = store.addActivity(body.type || 'system', body.message, parsed);
    res.status(201).json(entry);
  });

  return router;
}
