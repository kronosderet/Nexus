import { Router, type Request, type Response } from 'express';
import { scanCCMemories } from '../lib/memoryIndex.ts';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: unknown) => void;

/**
 * /api/cc-memory routes
 *
 * GET /
 *   Query params:
 *     limit — max entries to return (default 50, max 200)
 *     type  — optional filter by memory type (user / feedback / project / reference / plan)
 *   Returns MemoriesIndex from lib/memoryIndex.ts.
 *
 * POST /import  (v4.3.8 #200)
 *   Body: { project?: string, dry_run?: boolean, force?: boolean }
 *   Imports scanned CC memories as lifecycle='reference' decisions. Idempotent.
 *   See NexusStore.importAllCCMemories.
 *
 * Reads ~/.claude/projects/<cwd-hash>/memory/*.md (or NEXUS_CC_PROJECTS_DIR).
 */
export function createMemoryRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const rawLimit = parseInt(req.query.limit as string);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const typeFilter = (req.query.type as string) || undefined;

    const index = scanCCMemories(limit * 2); // fetch extra so type filter has room
    const filtered = typeFilter
      ? { ...index, memories: index.memories.filter(m => m.type === typeFilter).slice(0, limit) }
      : { ...index, memories: index.memories.slice(0, limit) };

    res.json(filtered);
  });

  // v4.3.8 #200 — Memory Bridge import endpoint.
  router.post('/import', (req: Request, res: Response) => {
    const { project, dry_run, force } = req.body ?? {};
    const result = store.importAllCCMemories({
      project: typeof project === 'string' ? project : undefined,
      dryRun: !!dry_run,
      force: !!force,
    });
    // Only log to activity on actual writes (skip for dry_run)
    if (!result.dryRun && (result.imported > 0 || result.updated > 0)) {
      const entry = store.addActivity(
        'memory_import',
        `Memory Bridge -- imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}`
      );
      broadcast({ type: 'activity', payload: entry });
    }
    res.json(result);
  });

  return router;
}
