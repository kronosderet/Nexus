import { Router, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

type BroadcastFn = (data: unknown) => void;

// v4.3.5 P1 — action definition + result shapes.
interface ActionDef {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  command: string;
}
interface ActionParams { taskId?: number }
interface GpuInfo { name: string; utilization: string; temperature: string; vram: string }

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', '..', 'nexus-actions.json');

const DEFAULT_ACTIONS = [
  {
    id: 'git-summary',
    label: 'Git Summary',
    icon: 'git-branch',
    description: 'Recent commits across all repos',
    command: 'git-summary',
  },
  {
    id: 'system-check',
    label: 'Full Health',
    icon: 'activity',
    description: 'Combined pulse + GPU report',
    command: 'system-check',
  },
  {
    id: 'clear-done',
    label: 'Archive Done',
    icon: 'check-circle',
    description: 'Remove completed tasks from board',
    command: 'clear-done',
  },
];

function loadActions() {
  if (existsSync(CONFIG_PATH)) {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_ACTIONS, null, 2));
  return DEFAULT_ACTIONS;
}

export function createActionRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  // List available actions
  router.get('/', (req: Request, res: Response) => {
    res.json(loadActions());
  });

  // Execute an action
  router.post('/:id/run', (req: Request, res: Response) => {
    const actions = loadActions();
    const action = actions.find((a: ActionDef) => a.id === String(req.params.id));
    if (!action) return res.status(404).json({ error: 'Unknown action.' });

    const result = executeAction(action.command, store, req.body);
    const entry = store.addActivity('action', `Quick action -- ${action.label}`);
    broadcast({ type: 'activity', payload: entry });
    broadcast({ type: 'reload', payload: {} }); // Trigger full UI refresh for composite actions
    res.json({ success: true, action: action.label, result });
  });

  // Direct workflow endpoints (no action config needed)
  router.post('/workflow/start/:taskId', (req: Request, res: Response) => {
    const result = startTask(store, Number(req.params.taskId));
    if (result.error) return res.status(400).json(result);
    broadcast({ type: 'reload', payload: {} });
    res.json(result);
  });
  router.post('/workflow/ship/:taskId', (req: Request, res: Response) => {
    const result = shipTask(store, Number(req.params.taskId));
    if (result.error) return res.status(400).json(result);
    broadcast({ type: 'reload', payload: {} });
    res.json(result);
  });
  router.post('/workflow/park/:taskId', (req: Request, res: Response) => {
    const result = parkTask(store, Number(req.params.taskId));
    if (result.error) return res.status(400).json(result);
    broadcast({ type: 'reload', payload: {} });
    res.json(result);
  });

  return router;
}

function executeAction(command: string, store: NexusStore, params?: ActionParams): unknown {
  switch (command) {
    case 'git-summary': return gitSummary();
    case 'system-check': return systemCheck();
    case 'clear-done': return clearDone(store);
    case 'start-task': return startTask(store, params?.taskId);
    case 'ship-task': return shipTask(store, params?.taskId);
    case 'park-task': return parkTask(store, params?.taskId);
    default: return { error: 'Unknown command' };
  }
}

function startTask(store: NexusStore, taskId?: number) {
  if (!taskId) return { error: 'taskId required' };
  const result = store.updateTask(taskId, { status: 'in_progress' });
  if (!result) return { error: 'Task not found' };
  store.pushThought({ text: `Working on: ${result.task.title}`, context: `task #${taskId}`, related_task_id: taskId });
  store.addActivity('task_started', `Set course for #${taskId} — "${result.task.title}"`);
  return { task: result.task, thoughtPushed: true };
}

function shipTask(store: NexusStore, taskId?: number) {
  if (!taskId) return { error: 'taskId required' };
  const result = store.updateTask(taskId, { status: 'done' });
  if (!result) return { error: 'Task not found' };
  // resolvedThoughts is now returned by updateTask
  return { task: result.task, resolvedThoughts: result.resolvedThoughts || 0 };
}

function parkTask(store: NexusStore, taskId?: number) {
  if (!taskId) return { error: 'taskId required' };
  const result = store.updateTask(taskId, { status: 'backlog' });
  if (!result) return { error: 'Task not found' };
  store.pushThought({ text: `Parked: ${result.task.title}`, context: `task #${taskId} returned to backlog`, related_task_id: taskId });
  store.addActivity('task_parked', `Charted for later — #${taskId} "${result.task.title}"`);
  return { task: result.task, thoughtPushed: true };
}

function gitSummary() {
  const projectsDir = PROJECTS_DIR;
  const results: Array<{ project: string; commits: string[] }> = [];

  for (const name of readdirSync(projectsDir)) {
    const fullPath = join(projectsDir, name);
    try {
      if (!statSync(join(fullPath, '.git')).isDirectory()) continue;
    } catch { continue; }

    try {
      const log = execSync(
        'git log --oneline -3 --format="%h %s (%ar)" 2>nul',
        { cwd: fullPath, encoding: 'utf-8' }
      ).trim();
      if (log) results.push({ project: name, commits: log.split('\n') });
    } catch {}
  }

  return { projects: results };
}

function systemCheck() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let gpu: GpuInfo | null = null;
  try {
    const csv = execSync(
      'nvidia-smi --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    const [name, util, temp, memUsed, memTotal] = csv.split(', ');
    gpu = { name, utilization: `${util}%`, temperature: `${temp}°C`, vram: `${memUsed}/${memTotal} MiB` };
  } catch {}

  return {
    memory: `${Math.round(((totalMem - freeMem) / totalMem) * 100)}%`,
    cpus: os.cpus().length,
    uptime: `${Math.floor(os.uptime() / 3600)}h`,
    gpu,
  };
}

function clearDone(store: NexusStore) {
  const done = store.getAllTasks().filter(t => t.status === 'done');
  let removed = 0;
  for (const t of done) {
    store.deleteTask(t.id);
    removed++;
  }
  return { removed };
}
