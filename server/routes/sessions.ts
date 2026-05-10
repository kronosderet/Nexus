import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import { validateBody } from '../lib/validate.ts';
import { NewSessionSchema } from '../lib/validators.ts';

type BroadcastFn = (data: unknown) => void;

export function createSessionRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
    res.json(store.getSessions({ project, limit }));
  });

  router.get('/context/:project', (req: Request, res: Response) => {
    const context = store.getSessionContext(String(req.params.project));
    res.json(context);
  });

  router.get('/:id', (req: Request, res: Response) => {
    const session = store.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(session);
  });

  router.post('/', (req: Request, res: Response) => {
    // v4.8.0 #219 — Zod validation. project + summary required (non-empty after
    // trim); arrays must be string[] not arbitrary shapes.
    const body = validateBody(NewSessionSchema, req, res);
    if (!body) return;

    // completed_task_ids isn't on the schema but the store accepts it; pass
    // through from raw body so existing callers keep working.
    const completed_task_ids = req.body?.completed_task_ids;
    const session = store.createSession({
      project: body.project,
      summary: body.summary,
      decisions: body.decisions,
      blockers: body.blockers,
      files_touched: body.files_touched,
      tags: body.tags,
      completed_task_ids,
    });
    const entry = store.addActivity('session', `Session logged -- [${body.project}] ${body.summary.slice(0, 60)}${body.summary.length > 60 ? '...' : ''}`);
    broadcast({ type: 'activity', payload: entry });
    broadcast({ type: 'session_created', payload: session });
    res.status(201).json(session);
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const session = store.getSession(id);
    if (!session) return res.status(404).json({ error: 'Nothing on the charts.' });
    // Explicit allowlist — don't let arbitrary body fields poison the session object
    const { summary, decisions, blockers, tags, files_touched } = req.body;
    if (summary !== undefined) session.summary = summary;
    if (decisions !== undefined) session.decisions = decisions;
    if (blockers !== undefined) session.blockers = blockers;
    if (tags !== undefined) session.tags = tags;
    if (files_touched !== undefined) session.files_touched = files_touched;
    store._flush();
    res.json(session);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const idx = store.data.sessions.findIndex(s => s.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Nothing on the charts.' });
    store.data.sessions.splice(idx, 1);
    store._flush();
    res.json({ success: true });
  });

  return router;
}
