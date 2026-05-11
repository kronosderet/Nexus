import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import { validateBody } from '../lib/validate.ts';
import { NewTaskSchema, UpdateTaskSchema } from '../lib/validators.ts';

type BroadcastFn = (data: unknown) => void;

export function createTaskRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    // v4.8.2 — query-param filters so MCP `nexus_list_tasks` (and any other
    // consumer) can pull a scoped slice instead of the full board. All
    // filters are optional; the unfiltered call still returns every task,
    // preserving the dashboard contract.
    const { project, status, priority, limit } = req.query;
    let tasks = store.getAllTasks();
    if (typeof project === 'string' && project) {
      const p = project.toLowerCase();
      tasks = tasks.filter(t => (t.project || '').toLowerCase() === p);
    }
    if (typeof status === 'string' && status) {
      tasks = tasks.filter(t => t.status === status);
    }
    if (typeof priority === 'string' && priority) {
      const n = Number(priority);
      if (Number.isFinite(n)) tasks = tasks.filter(t => (t.priority ?? 0) === n);
    }
    if (typeof limit === 'string' && limit) {
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) tasks = tasks.slice(0, n);
    }
    res.json(tasks);
  });

  router.post('/', (req: Request, res: Response) => {
    // v4.8.0 #219 — Zod validation at the boundary. Catches missing title,
    // wrong status enum, non-integer priority, etc. before the store sees them.
    const body = validateBody(NewTaskSchema, req, res);
    if (!body) return;
    const task = store.createTask({
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      decision_ids: body.decision_ids,
      project: body.project,
    });
    const entry = store.addActivity('task_created', `Plotted -- "${body.title}"`);
    broadcast({ type: 'task_update', payload: task });
    broadcast({ type: 'activity', payload: entry });
    res.status(201).json(task);
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    // v4.8.0 #219 — patches accept any subset of the task fields; reject
    // unknown shapes (e.g. status='archived') at the boundary.
    const body = validateBody(UpdateTaskSchema, req, res);
    if (!body) return;
    const result = store.updateTask(id, body);
    if (!result) return res.status(404).json({ error: 'Nothing on the charts.' });

    const { task, old, resolvedThoughts } = result;
    if (old.status !== task.status && task.status === 'done') {
      store.recordTaskCompletion(task.id);
      const entry = store.addActivity('task_done', `Landmark reached -- "${task.title}"${resolvedThoughts ? ` (auto-resolved ${resolvedThoughts} thought${resolvedThoughts > 1 ? 's' : ''})` : ''}`);
      broadcast({ type: 'activity', payload: entry });
    } else if (old.status !== task.status) {
      const entry = store.addActivity('task_moved', `Course adjusted -- "${task.title}" -> ${task.status}`);
      broadcast({ type: 'activity', payload: entry });
    }

    broadcast({ type: 'task_update', payload: task });
    res.json({ ...task, resolvedThoughts: resolvedThoughts || 0 });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const task = store.deleteTask(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Nothing on the charts.' });
    const entry = store.addActivity('task_deleted', `Removed from charts -- "${task.title}"`);
    broadcast({ type: 'task_deleted', payload: { id: task.id } });
    broadcast({ type: 'activity', payload: entry });
    res.json({ success: true });
  });

  return router;
}
