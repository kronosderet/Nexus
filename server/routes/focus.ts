import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import { join } from 'path';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

export function createFocusRoutes(store: NexusStore): Router {
  const router = Router();

  // Get full focus view for a project
  router.get('/:project', (req: Request, res: Response) => {
    const project = String(req.params.project);
    const p = project.toLowerCase();
    const projectPath = join(PROJECTS_DIR, project);

    // Tasks
    const allTasks = store.getAllTasks();
    const tasks = allTasks.filter(t => t.title.toLowerCase().includes(p));
    const otherTasks = allTasks.filter(t => !t.title.toLowerCase().includes(p) && t.status !== 'done');

    // Sessions
    const sessions = store.getSessions({ project, limit: 10 });

    // Activity
    const activity = store.getActivity(200).filter(a => a.message.toLowerCase().includes(`[${p}]`));

    // Git
    let git: any = null;
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim();
      const log = execSync('git log --oneline -10 --format="%h|%s|%ar" 2>nul', { cwd: projectPath, encoding: 'utf-8' }).trim();
      const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8' }).trim();
      const diff = execSync('git diff --stat 2>nul', { cwd: projectPath, encoding: 'utf-8' }).trim();

      git = {
        branch,
        commits: log ? log.split('\n').map(l => {
          const [hash, msg, when] = l.split('|');
          return { hash, message: msg, when };
        }) : [],
        uncommitted: status ? status.split('\n').length : 0,
        diffStat: diff || null,
      };
    } catch {}

    // Blockers from sessions
    const blockers = sessions.flatMap(s => (s.blockers || []).map(b => ({ text: b, from: s.created_at }))).slice(0, 5);

    // Decisions from sessions
    const decisions = sessions.flatMap(s => (s.decisions || []).map(d => ({ text: d, from: s.created_at }))).slice(0, 10);

    res.json({
      project,
      tasks: { project: tasks, other: otherTasks },
      sessions,
      activity: activity.slice(0, 30),
      git,
      blockers,
      decisions,
    });
  });

  return router;
}
