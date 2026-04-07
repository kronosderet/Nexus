import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Self-Critique — pattern detection on task completion times.
 *
 * Surfaces: which tasks took unusually long, which categories are slow,
 * which in-progress tasks are stuck. The goal: turn implicit thrashing
 * into explicit feedback.
 */
export function createCritiqueRoutes(store: NexusStore) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(store.getSelfCritique());
  });

  return router;
}
