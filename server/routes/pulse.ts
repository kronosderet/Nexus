import { Router, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import os from 'os';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

export function createPulseRoutes(store: NexusStore) {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const pulse = {
      system: getSystemInfo(),
      gpu: getGpuInfo(),
      projects: scanProjects(),
      git: getGitInfo(),
      timestamp: new Date().toISOString(),
    };
    res.json(pulse);
  });

  // Dedicated GPU endpoint for detailed/live polling
  router.get('/gpu', (req: Request, res: Response) => {
    const gpu = getGpuInfo();
    const processes = getGpuProcesses();
    res.json({ ...gpu, processes });
  });

  // GPU history (timeline data)
  router.get('/gpu/history', (req: Request, res: Response) => {
    const hours = parseFloat(req.query.hours as string) || 1;
    res.json(store ? store.getGpuHistory(hours) : []);
  });

  // Project health cards
  router.get('/projects', (req: Request, res: Response) => {
    const projects = scanProjects();
    const activity = store ? store.getActivity(200) : [];
    const tasks = store ? store.getAllTasks() : [];
    const sessions = store ? store.getSessions({ limit: 100 }) : [];
    const decisions = store ? store.getActiveDecisions() : [];
    const now = Date.now();
    const DAY = 86400000;

    const enriched = projects.map(p => {
      const name = p.name.toLowerCase();
      // Count activity per project (by [ProjectName] tag)
      const projActivity = activity.filter((a: any) => a.message.toLowerCase().includes(`[${name}]`));
      const activity7d = projActivity.filter((a: any) => now - new Date(a.created_at).getTime() < 7 * DAY).length;
      const activityToday = projActivity.filter((a: any) => now - new Date(a.created_at).getTime() < DAY).length;
      const lastActivity = projActivity[0]?.created_at || null;

      // Tasks referencing this project
      const projTasks = tasks.filter((t: any) => t.title.toLowerCase().includes(name));
      const openTasks = projTasks.filter((t: any) => t.status !== 'done').length;
      const doneTasks = projTasks.filter((t: any) => t.status === 'done').length;

      // Sessions
      const projSessions = sessions.filter((s: any) => s.project.toLowerCase() === name);
      const lastSession = projSessions[0]?.created_at || null;

      // Git info per project
      let git: any = { isRepo: false };
      if (p.hasGit) {
        try {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: p.path, encoding: 'utf-8' }).trim();
          const lastCommitDate = execSync('git log -1 --format=%aI 2>nul', { cwd: p.path, encoding: 'utf-8' }).trim();
          const lastCommitMsg = execSync('git log -1 --format=%s 2>nul', { cwd: p.path, encoding: 'utf-8' }).trim();
          const uncommitted = execSync('git status --porcelain', { cwd: p.path, encoding: 'utf-8' }).trim();
          git = {
            isRepo: true,
            branch,
            lastCommitDate,
            lastCommitMsg,
            uncommittedChanges: uncommitted ? uncommitted.split('\n').length : 0,
          };
        } catch {}
      }

      // Heat level
      let heat = 'cold';
      if (activityToday > 0 || (git.lastCommitDate && now - new Date(git.lastCommitDate).getTime() < DAY)) heat = 'hot';
      else if (activity7d > 0 || (git.lastCommitDate && now - new Date(git.lastCommitDate).getTime() < 7 * DAY)) heat = 'warm';

      return {
        ...p,
        git,
        activity: { today: activityToday, week: activity7d, last: lastActivity },
        tasks: { open: openTasks, done: doneTasks },
        sessions: { count: projSessions.length, last: lastSession },
        decisions: decisions.filter((d: any) => d.project.toLowerCase() === name).length,
        heat,
      };
    });

    // Sort: hot first, then warm, then cold
    const heatOrder: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
    enriched.sort((a, b) => heatOrder[a.heat] - heatOrder[b.heat]);

    res.json(enriched);
  });

  return router;
}

function getSystemInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    platform: os.platform(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    cpus: os.cpus().length,
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
  };
}

function scanProjects() {
  const projectsDir = PROJECTS_DIR;
  try {
    return readdirSync(projectsDir)
      .filter(name => {
        try {
          return statSync(join(projectsDir, name)).isDirectory() && !name.startsWith('.');
        } catch { return false; }
      })
      .map(name => {
        const fullPath = join(projectsDir, name);
        const hasGit = (() => {
          try { statSync(join(fullPath, '.git')); return true; } catch { return false; }
        })();
        return { name, path: fullPath, hasGit };
      });
  } catch {
    return [];
  }
}

function getGpuInfo() {
  try {
    const csv = execSync(
      'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.max_limit,driver_version,clocks.gr,clocks.mem,clocks.max.gr,clocks.max.mem,fan.speed,pstate --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    const fields = csv.split(', ').map(s => s.trim());
    return {
      available: true,
      name: fields[0],
      vram: {
        total: parseInt(fields[1]),       // MiB
        used: parseInt(fields[2]),
        free: parseInt(fields[3]),
        percent: Math.round((parseInt(fields[2]) / parseInt(fields[1])) * 100),
      },
      utilization: {
        gpu: parseInt(fields[4]),          // %
        memory: parseInt(fields[5]),       // %
      },
      temperature: parseInt(fields[6]),    // C
      power: {
        draw: parseFloat(fields[7]),       // W
        limit: parseFloat(fields[8]),      // W
        percent: Math.round((parseFloat(fields[7]) / parseFloat(fields[8])) * 100),
      },
      driver: fields[9],
      clocks: {
        graphics: parseInt(fields[10]),    // MHz
        memory: parseInt(fields[11]),
        maxGraphics: parseInt(fields[12]),
        maxMemory: parseInt(fields[13]),
      },
      fan: parseInt(fields[14]),           // %
      pstate: fields[15],
    };
  } catch {
    return { available: false };
  }
}

function getGpuProcesses() {
  try {
    const csv = execSync(
      'nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (!csv) return [];
    return csv.split('\n').map(line => {
      const [pid, name, mem] = line.split(', ').map(s => s.trim());
      return {
        pid: parseInt(pid),
        name: name.split(/[/\\]/).pop(),  // just the exe name
        vram: parseInt(mem) || 0,
      };
    }).filter(p => p.name !== '[Insufficient Permissions]');
  } catch {
    return [];
  }
}

function getGitInfo() {
  try {
    const cwd = process.cwd();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
    const lastCommit = execSync('git log -1 --format="%h %s" 2>nul', { cwd, encoding: 'utf-8' }).trim();
    return {
      branch,
      uncommittedChanges: status ? status.split('\n').length : 0,
      lastCommit,
      isRepo: true,
    };
  } catch {
    return { isRepo: false };
  }
}
