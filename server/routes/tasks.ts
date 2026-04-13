import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: any) => void;

export function createTaskRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json(store.getAllTasks());
  });

  router.post('/', (req: Request, res: Response) => {
    const { title, description, status, priority } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Task title required.' });
    const task = store.createTask({ title: title.trim(), description, status, priority });
    const entry = store.addActivity('task_created', `Plotted -- "${title}"`);
    broadcast({ type: 'task_update', payload: task });
    broadcast({ type: 'activity', payload: entry });
    res.status(201).json(task);
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = store.updateTask(id, req.body);
    if (!result) return res.status(404).json({ error: 'Nothing on the charts.' });

    const { task, old, resolvedThoughts } = result;
    if (old.status !== task.status && task.status === 'done') {
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
