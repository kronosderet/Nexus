import { Router, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

type BroadcastFn = (data: any) => void;

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
    const action = actions.find((a: any) => a.id === String(req.params.id));
    if (!action) return res.status(404).json({ error: 'Unknown action.' });

    const result = executeAction(action.command, store);
    const entry = store.addActivity('action', `Quick action -- ${action.label}`);
    broadcast({ type: 'activity', payload: entry });
    res.json({ success: true, action: action.label, result });
  });

  return router;
}

function executeAction(command: string, store: NexusStore): any {
  switch (command) {
    case 'git-summary': return gitSummary();
    case 'system-check': return systemCheck();
    case 'clear-done': return clearDone(store);
    default: return { error: 'Unknown command' };
  }
}

function gitSummary() {
  const projectsDir = PROJECTS_DIR;
  const results: any[] = [];

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

  let gpu: any = null;
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
