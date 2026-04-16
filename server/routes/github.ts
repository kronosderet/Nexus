import { Router, type Request, type Response } from 'express';
import { execSync, execFileSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import type { NexusStore } from '../db/store.ts';
import { PROJECTS_DIR } from '../lib/config.ts';

// v4.3.6 C1 — guard against path traversal when a project name comes from the wire.
// Must be a simple basename (no separators, no parent refs, non-empty).
function safeProject(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  if (name !== basename(name)) return null;
  if (name === '..' || name === '.' || name.includes('\0')) return null;
  return name;
}

type BroadcastFn = (data: unknown) => void;

// v4.3.5 P1 — git repo + commit shapes.
interface GitHubInfo { owner: string; repo: string; url: string }
interface GitCommit {
  project: string;
  hash: string;
  short: string;
  message: string;
  author: string;
  date: string;
}
interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  remote: string;
  github: GitHubInfo | null;
  uncommitted: number;
  ahead: number;
  behind: number;
  lastCommit: { hash: string; short: string; message: string; author: string; date: string };
}
interface SyncResult {
  project: string;
  newCommits?: number;
  status: 'ok' | 'error';
  error?: string;
}

export function createGitHubRoutes(store: NexusStore, broadcast: BroadcastFn) {
  const router = Router();

  // Get git overview across all repos
  router.get('/repos', (req: Request, res: Response) => {
    const repos = scanGitRepos();
    res.json(repos);
  });

  // Fetch recent commits across all repos
  router.get('/commits', (req: Request, res: Response) => {
    const days = Math.min(parseInt(req.query.days as string) || 7, 365);
    const commits = getAllCommits(days);
    res.json(commits);
  });

  // Fetch recent commits for a specific project
  router.get('/commits/:project', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const project = safeProject(req.params.project);
    if (!project) return res.status(400).json({ error: 'Invalid project name.' });
    const projectPath = join(PROJECTS_DIR, project);
    try {
      const commits = getProjectCommits(projectPath, project, limit);
      res.json(commits);
    } catch (err) {
      console.error('[github] getProjectCommits failed:', (err as Error).message);
      res.status(404).json({ error: 'Nothing on the charts.' });
    }
  });

  // Sync: pull latest from all remotes and log new commits
  router.post('/sync', (req: Request, res: Response) => {
    const results = syncAllRepos(store, broadcast);
    res.json(results);
  });

  // Commit all changes in a project
  router.post('/commit', (req: Request, res: Response) => {
    const { project: rawProject, message: rawMessage = 'Nexus auto-commit' } = req.body ?? {};
    const project = safeProject(rawProject);
    if (!project) return res.status(400).json({ error: 'Project name required (must be a simple basename).' });
    // v4.3.6 C1 — message is user-controlled; coerce to string and reject control chars so it can't
    // smuggle ANSI/terminal escapes through the activity log, and clip to a reasonable length.
    const message = String(rawMessage ?? '').replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').slice(0, 500) || 'Nexus auto-commit';

    const cwd = join(PROJECTS_DIR, project);
    try {
      // Stage all
      execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8' });
      // Check if anything staged
      const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' }).trim();
      if (!status) return res.json({ success: true, files: 0, message: 'Nothing to commit' });

      const files = status.split('\n').length;
      // v4.3.6 C1 — execFileSync with argv prevents shell interpolation. Previous execSync with
      // quote-only escaping allowed $() and backtick injection via the message body.
      execFileSync('git', ['commit', '-m', message], { cwd, encoding: 'utf-8' });

      const entry = store.addActivity('git_commit', `Fleet commit -- [${project}] ${files} files: ${message.slice(0, 60)}`);
      broadcast({ type: 'activity', payload: entry });

      res.json({ success: true, files, project });
    } catch (err) {
      console.error(`[github] commit failed for ${project}:`, (err as Error).message);
      res.json({ success: false, project, error: (err as Error).message?.slice(0, 200) });
    }
  });

  return router;
}

function scanGitRepos(): RepoInfo[] {
  const repos: RepoInfo[] = [];
  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      const fullPath = join(PROJECTS_DIR, name);
      try {
        statSync(join(fullPath, '.git'));
      } catch { continue; }

      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: fullPath, encoding: 'utf-8' }).trim();
        const remote = execSync('git remote get-url origin 2>nul', { cwd: fullPath, encoding: 'utf-8' }).trim();
        const status = execSync('git status --porcelain', { cwd: fullPath, encoding: 'utf-8' }).trim();
        const lastCommit = execSync('git log -1 --format="%H|%h|%s|%an|%aI" 2>nul', { cwd: fullPath, encoding: 'utf-8' }).trim();
        const [hash, short, message, author, date] = lastCommit.split('|');

        // Parse GitHub info from remote URL
        let github: GitHubInfo | null = null;
        const ghMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (ghMatch) github = { owner: ghMatch[1], repo: ghMatch[2], url: `https://github.com/${ghMatch[1]}/${ghMatch[2]}` };

        // Count ahead/behind if tracking remote
        let ahead = 0, behind = 0;
        try {
          const ab = execSync('git rev-list --left-right --count HEAD...@{u} 2>nul', { cwd: fullPath, encoding: 'utf-8' }).trim();
          [ahead, behind] = ab.split('\t').map(Number);
        } catch (err) {
          // v4.3.6 H5 — common case: no upstream configured. Log at debug-ish level so operators
          // can see it without the route lying by returning ahead=0/behind=0 for a real failure.
          if (process.env.NEXUS_DEBUG) console.warn(`[github] ahead/behind unavailable for ${name}:`, (err as Error).message);
        }

        repos.push({
          name,
          path: fullPath,
          branch,
          remote,
          github,
          uncommitted: status ? status.split('\n').length : 0,
          ahead,
          behind,
          lastCommit: { hash, short, message, author, date },
        });
      } catch (err) {
        if (process.env.NEXUS_DEBUG) console.warn(`[github] scanGitRepos skipped ${name}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[github] scanGitRepos failed to read PROJECTS_DIR:', (err as Error).message);
  }

  return repos.sort((a, b) => {
    const da = a.lastCommit?.date ? new Date(a.lastCommit.date) : new Date(0);
    const db = b.lastCommit?.date ? new Date(b.lastCommit.date) : new Date(0);
    return db.getTime() - da.getTime();
  });
}

function getProjectCommits(cwd: string, projectName: string, limit = 20) {
  const log = execSync(
    `git log --format="%H|%h|%s|%an|%aI" -${limit} 2>nul`,
    { cwd, encoding: 'utf-8' }
  ).trim();

  if (!log) return [];
  return log.split('\n').map(line => {
    const [hash, short, message, author, date] = line.split('|');
    return { project: projectName, hash, short, message, author, date };
  });
}

function getAllCommits(days: number): GitCommit[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const allCommits: GitCommit[] = [];

  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      const fullPath = join(PROJECTS_DIR, name);
      try { statSync(join(fullPath, '.git')); } catch { continue; }
      try {
        const log = execSync(
          `git log --format="%H|%h|%s|%an|%aI" --since="${since}" 2>nul`,
          { cwd: fullPath, encoding: 'utf-8' }
        ).trim();
        if (!log) continue;
        for (const line of log.split('\n')) {
          const [hash, short, message, author, date] = line.split('|');
          allCommits.push({ project: name, hash, short, message, author, date });
        }
      } catch (err) {
        if (process.env.NEXUS_DEBUG) console.warn(`[github] getAllCommits skipped ${name}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[github] getAllCommits failed to read PROJECTS_DIR:', (err as Error).message);
  }

  return allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function syncAllRepos(store: NexusStore, broadcast: BroadcastFn): SyncResult[] {
  const results: SyncResult[] = [];

  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      const fullPath = join(PROJECTS_DIR, name);
      try { statSync(join(fullPath, '.git')); } catch { continue; }

      try {
        // Get current HEAD before fetch
        const beforeHead = execSync('git rev-parse HEAD 2>nul', { cwd: fullPath, encoding: 'utf-8' }).trim();

        // Fetch (don't pull -- just see what's new)
        execSync('git fetch --quiet 2>nul', { cwd: fullPath, encoding: 'utf-8', timeout: 15000 });

        // Check for new remote commits
        let newCommits = 0;
        try {
          const ab = execSync('git rev-list --count HEAD..@{u} 2>nul', { cwd: fullPath, encoding: 'utf-8' }).trim();
          newCommits = parseInt(ab) || 0;
        } catch (err) {
          // No upstream tracking branch — common, stay quiet unless debugging.
          if (process.env.NEXUS_DEBUG) console.warn(`[github] rev-list HEAD..@{u} failed for ${name}:`, (err as Error).message);
        }

        if (newCommits > 0) {
          const entry = store.addActivity('git_fetch', `Signal received -- [${name}] ${newCommits} new commit${newCommits !== 1 ? 's' : ''} on remote`);
          broadcast({ type: 'activity', payload: entry });
        }

        results.push({ project: name, newCommits, status: 'ok' });
      } catch (err) {
        console.error(`[github] syncAllRepos failed for ${name}:`, (err as Error).message);
        results.push({ project: name, status: 'error', error: (err as Error).message });
      }
    }
  } catch (err) {
    console.error('[github] syncAllRepos failed to read PROJECTS_DIR:', (err as Error).message);
  }

  return results;
}
