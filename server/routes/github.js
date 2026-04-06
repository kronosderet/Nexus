import { Router } from 'express';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECTS_DIR = 'C:/Projects';

export function createGitHubRoutes(store, broadcast) {
  const router = Router();

  // Get git overview across all repos
  router.get('/repos', (req, res) => {
    const repos = scanGitRepos();
    res.json(repos);
  });

  // Fetch recent commits across all repos
  router.get('/commits', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    const commits = getAllCommits(days);
    res.json(commits);
  });

  // Fetch recent commits for a specific project
  router.get('/commits/:project', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const projectPath = join(PROJECTS_DIR, req.params.project);
    try {
      const commits = getProjectCommits(projectPath, req.params.project, limit);
      res.json(commits);
    } catch {
      res.status(404).json({ error: 'Nothing on the charts.' });
    }
  });

  // Sync: pull latest from all remotes and log new commits
  router.post('/sync', (req, res) => {
    const results = syncAllRepos(store, broadcast);
    res.json(results);
  });

  // Commit all changes in a project
  router.post('/commit', (req, res) => {
    const { project, message = 'Nexus auto-commit' } = req.body;
    if (!project) return res.status(400).json({ error: 'Project name required.' });

    const cwd = join(PROJECTS_DIR, project);
    try {
      // Stage all
      execSync('git add -A', { cwd, encoding: 'utf-8' });
      // Check if anything staged
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
      if (!status) return res.json({ success: true, files: 0, message: 'Nothing to commit' });

      const files = status.split('\n').length;
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf-8' });

      const entry = store.addActivity('git_commit', `Fleet commit -- [${project}] ${files} files: ${message.slice(0, 60)}`);
      broadcast({ type: 'activity', payload: entry });

      res.json({ success: true, files, project });
    } catch (err) {
      res.json({ success: false, project, error: err.message?.slice(0, 200) });
    }
  });

  return router;
}

function scanGitRepos() {
  const repos = [];
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
        let github = null;
        const ghMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (ghMatch) github = { owner: ghMatch[1], repo: ghMatch[2], url: `https://github.com/${ghMatch[1]}/${ghMatch[2]}` };

        // Count ahead/behind if tracking remote
        let ahead = 0, behind = 0;
        try {
          const ab = execSync('git rev-list --left-right --count HEAD...@{u} 2>nul', { cwd: fullPath, encoding: 'utf-8' }).trim();
          [ahead, behind] = ab.split('\t').map(Number);
        } catch {}

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
      } catch {}
    }
  } catch {}

  return repos.sort((a, b) => {
    const da = a.lastCommit?.date ? new Date(a.lastCommit.date) : new Date(0);
    const db = b.lastCommit?.date ? new Date(b.lastCommit.date) : new Date(0);
    return db - da;
  });
}

function getProjectCommits(cwd, projectName, limit = 20) {
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

function getAllCommits(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const allCommits = [];

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
      } catch {}
    }
  } catch {}

  return allCommits.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function syncAllRepos(store, broadcast) {
  const results = [];

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
        } catch {}

        if (newCommits > 0) {
          const entry = store.addActivity('git_fetch', `Signal received -- [${name}] ${newCommits} new commit${newCommits !== 1 ? 's' : ''} on remote`);
          broadcast({ type: 'activity', payload: entry });
        }

        results.push({ project: name, newCommits, status: 'ok' });
      } catch (err) {
        results.push({ project: name, status: 'error', error: err.message });
      }
    }
  } catch {}

  return results;
}
