import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: unknown) => void;

/**
 * /api/handover routes — v4.6.0 #398 Continuous Handover.
 *
 * GET  /                  → list all per-project handovers
 * GET  /:project          → read one project's handover
 * PUT  /:project          → write/replace one project's handover (body: { content, updated_by? })
 * DELETE /:project        → remove one project's handover
 *
 * Replaces the dated HANDOVER-YYYY-MM-DD.md workflow. Each instance updates
 * before docking; next instance reads via nexus_brief / Handover dashboard tab.
 */
export function createHandoverRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({ handovers: store.getAllHandovers() });
  });

  router.get('/:project', (req: Request, res: Response) => {
    const project = String(req.params.project || '').trim();
    if (!project) return res.status(400).json({ error: 'project required' });
    const entry = store.getHandover(project);
    if (!entry) return res.status(404).json({ error: 'no handover for this project yet', project });
    res.json({ project, ...entry });
  });

  router.put('/:project', (req: Request, res: Response) => {
    const project = String(req.params.project || '').trim();
    if (!project) return res.status(400).json({ error: 'project required' });
    const { content, updated_by } = req.body ?? {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) required' });
    const entry = store.setHandover(project, content, typeof updated_by === 'string' ? updated_by : undefined);
    const act = store.addActivity('system', `[${project}] Handover updated (${content.length} chars)`);
    broadcast({ type: 'activity', payload: act });
    broadcast({ type: 'handover_update', payload: { project, ...entry } });
    res.json({ project, ...entry });
  });

  router.delete('/:project', (req: Request, res: Response) => {
    const project = String(req.params.project || '').trim();
    if (!project) return res.status(400).json({ error: 'project required' });
    const removed = store.deleteHandover(project);
    if (!removed) return res.status(404).json({ error: 'no handover for this project', project });
    res.json({ success: true, project });
  });

  return router;
}
