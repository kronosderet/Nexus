import { Router } from 'express';

export function createSessionRoutes(store, broadcast) {
  const router = Router();

  // List sessions (optional ?project= filter)
  router.get('/', (req, res) => {
    const { project, limit } = req.query;
    res.json(store.getSessions({ project, limit: parseInt(limit) || 20 }));
  });

  // Get session context for a project (designed for agent startup)
  router.get('/context/:project', (req, res) => {
    const context = store.getSessionContext(req.params.project);
    res.json(context);
  });

  // Get single session
  router.get('/:id', (req, res) => {
    const session = store.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: 'Nothing on the charts.' });
    res.json(session);
  });

  // Create session log
  router.post('/', (req, res) => {
    const { project, summary, decisions, blockers, files_touched, tags } = req.body;
    if (!project || !summary) {
      return res.status(400).json({ error: 'Project and summary required.' });
    }

    const session = store.createSession({ project, summary, decisions, blockers, files_touched, tags });
    const entry = store.addActivity('session', `Session logged -- [${project}] ${summary.slice(0, 60)}${summary.length > 60 ? '...' : ''}`);
    broadcast({ type: 'activity', payload: entry });
    broadcast({ type: 'session_created', payload: session });
    res.status(201).json(session);
  });

  // Update session
  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const session = store.getSession(id);
    if (!session) return res.status(404).json({ error: 'Nothing on the charts.' });
    Object.assign(session, req.body, { id });
    store._flush();
    res.json(session);
  });

  // Delete session
  router.delete('/:id', (req, res) => {
    const idx = store.data.sessions.findIndex(s => s.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Nothing on the charts.' });
    store.data.sessions.splice(idx, 1);
    store._flush();
    res.json({ success: true });
  });

  return router;
}
