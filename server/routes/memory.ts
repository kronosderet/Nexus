import { Router, type Request, type Response } from 'express';
import { scanCCMemories } from '../lib/memoryIndex.ts';

/**
 * GET /api/cc-memory
 *   Query params:
 *     limit — max entries to return (default 50, max 200)
 *     type  — optional filter by memory type (user / feedback / project / reference / plan)
 *
 *   Returns MemoriesIndex from lib/memoryIndex.ts.
 *
 * Reads ~/.claude/projects/<cwd-hash>/memory/*.md (or NEXUS_CC_PROJECTS_DIR).
 * Never writes in v4.3 Phase A — write path is a follow-up task.
 */
export function createMemoryRoutes() {
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

  return router;
}
