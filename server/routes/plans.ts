import { Router, type Request, type Response } from 'express';
import { scanPlans } from '../lib/planIndex.ts';

/**
 * GET /api/plans
 *   Query params:
 *     limit  — max plans to return (default 30)
 *
 *   Returns: PlansIndex from lib/planIndex.ts
 *
 * Reads ~/.claude/plans/*.md (or NEXUS_CC_PLANS_DIR). Never writes.
 */
export function createPlansRoutes() {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const raw = parseInt(req.query.limit as string);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 30;
    res.json(scanPlans(limit));
  });

  return router;
}
