import { Router } from 'express';

export function createTaskRoutes(store, broadcast) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(store.getAllTasks());
  });

  router.post('/', (req, res) => {
    const { title, description, status, priority } = req.body;
    const task = store.createTask({ title, description, status, priority });
    const entry = store.addActivity('task_created', `Plotted -- "${title}"`);
    broadcast({ type: 'task_update', payload: task });
    broadcast({ type: 'activity', payload: entry });
    res.status(201).json(task);
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const result = store.updateTask(id, req.body);
    if (!result) return res.status(404).json({ error: 'Nothing on the charts.' });

    const { task, old } = result;
    if (old.status !== task.status && task.status === 'done') {
      const entry = store.addActivity('task_done', `Landmark reached -- "${task.title}"`);
      broadcast({ type: 'activity', payload: entry });
    } else if (old.status !== task.status) {
      const entry = store.addActivity('task_moved', `Course adjusted -- "${task.title}" -> ${task.status}`);
      broadcast({ type: 'activity', payload: entry });
    }

    broadcast({ type: 'task_update', payload: task });
    res.json(task);
  });

  router.delete('/:id', (req, res) => {
    const task = store.deleteTask(Number(req.params.id));
    if (!task) return res.status(404).json({ error: 'Nothing on the charts.' });
    const entry = store.addActivity('task_deleted', `Removed from charts -- "${task.title}"`);
    broadcast({ type: 'task_deleted', payload: { id: task.id } });
    broadcast({ type: 'activity', payload: entry });
    res.json({ success: true });
  });

  return router;
}
