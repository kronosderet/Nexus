import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import os from 'os';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';
import { SERVER_VERSION } from '../lib/version.ts';

/**
 * Initialization / health check endpoint.
 * Run at startup and on-demand. Returns full system readiness.
 */
export function createInitRoutes(store: NexusStore): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const checks = await runHealthChecks(store);
    res.json(checks);
  });

  return router;
}

// v4.3.5 P1 — health check result shapes.
interface CheckResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}
interface HealthResults {
  timestamp: string;
  version: string;
  status: 'operational' | 'degraded';
  message?: string;
  checks: Record<string, CheckResult>;
}

async function runHealthChecks(store: NexusStore): Promise<HealthResults> {
  const results: HealthResults = {
    timestamp: new Date().toISOString(),
    version: SERVER_VERSION,
    status: 'operational',
    checks: {},
  };

  // 1. System
  results.checks.system = {
    ok: true,
    hostname: os.hostname(),
    platform: os.platform(),
    cpus: os.cpus().length,
    memoryPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
  };

  // 2. Database
  try {
    const tasks = store.getAllTasks();
    const allSessions = store.getSessions({ limit: 200 });
    const decisions = store.data.ledger?.length || 0;
    const graphEdges = store.data.graph_edges?.length || 0;
    results.checks.database = { ok: true, tasks: tasks.length, sessions: allSessions.length, decisions, graphEdges };
  } catch (err) {
    results.checks.database = { ok: false, error: (err as Error).message };
  }

  // 3. GPU
  try {
    const csv = execSync(
      'nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    const [name, memUsed, memTotal, temp] = csv.split(', ');
    results.checks.gpu = { ok: true, name: name.trim(), vram: `${memUsed.trim()}/${memTotal.trim()} MiB`, temp: `${temp.trim()}°C` };
  } catch {
    results.checks.gpu = { ok: false, error: 'No CUDA device' };
  }

  // 4. Local AI
  try {
    const endpoints = [
      { name: 'LM Studio', url: 'http://localhost:1234/v1/models' },
      { name: 'Ollama', url: 'http://localhost:11434/api/tags' },
    ];
    let found = false;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data: { data?: Array<{ id: string }>; models?: Array<{ name: string }> } = await res.json();
          const models = data.data?.map((m) => m.id) || data.models?.map((m) => m.name) || [];
          const chatModels = models.filter((m: string) => !m.includes('embed'));
          results.checks.ai = { ok: true, provider: ep.name, models: chatModels };
          found = true;
          break;
        }
      } catch {}
    }
    if (!found) results.checks.ai = { ok: false, error: 'No local AI detected' };
  } catch {
    results.checks.ai = { ok: false, error: 'Check failed' };
  }

  // 5. Git repos
  try {
    let repoCount = 0;
    let totalUncommitted = 0;
    for (const name of readdirSync(PROJECTS_DIR)) {
      try {
        statSync(join(PROJECTS_DIR, name, '.git'));
        repoCount++;
        const status = execSync('git status --porcelain', { cwd: join(PROJECTS_DIR, name), encoding: 'utf-8' }).trim();
        if (status) totalUncommitted += status.split('\n').length;
      } catch {}
    }
    results.checks.git = { ok: true, repos: repoCount, totalUncommitted };
  } catch {
    results.checks.git = { ok: false, error: 'Scan failed' };
  }

  // 6. Projects
  try {
    const dirs = readdirSync(PROJECTS_DIR).filter(n => {
      try { return statSync(join(PROJECTS_DIR, n)).isDirectory() && !n.startsWith('.'); } catch { return false; }
    });
    results.checks.projects = { ok: true, count: dirs.length, names: dirs };
  } catch {
    results.checks.projects = { ok: false };
  }

  // 7. Usage
  const usage = store.getLatestUsage();
  results.checks.usage = usage
    ? { ok: true, session: usage.session_percent, weekly: usage.weekly_percent }
    : { ok: true, tracked: false };

  // Overall status
  const allOk = Object.values(results.checks).every((c) => c.ok);
  results.status = allOk ? 'operational' : 'degraded';
  results.message = allOk ? 'All instruments nominal, Captain.' : 'Some systems need attention.';

  return results;
}
