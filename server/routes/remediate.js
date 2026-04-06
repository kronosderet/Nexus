import { Router } from 'express';
import { execSync } from 'child_process';
import { join } from 'path';

const PROJECTS_DIR = 'C:/Projects';

// Whitelisted safe commands that Nexus can auto-execute
const SAFE_COMMANDS = {
  'git-status': (project) => ({ cmd: 'git status', cwd: join(PROJECTS_DIR, project) }),
  'git-stash': (project) => ({ cmd: 'git stash', cwd: join(PROJECTS_DIR, project) }),
  'git-diff-stat': (project) => ({ cmd: 'git diff --stat', cwd: join(PROJECTS_DIR, project) }),
  'git-log': (project) => ({ cmd: 'git log --oneline -10', cwd: join(PROJECTS_DIR, project) }),
  'git-fetch': (project) => ({ cmd: 'git fetch --quiet', cwd: join(PROJECTS_DIR, project) }),
  'nexus-task-done': (_, id) => ({ cmd: `node C:/Projects/Nexus/cli/nexus.js done ${id}`, cwd: PROJECTS_DIR }),
  'nexus-log': (_, msg) => ({ cmd: `node C:/Projects/Nexus/cli/nexus.js log "${msg}"`, cwd: PROJECTS_DIR }),
};

export function createRemediateRoutes(store, broadcast) {
  const router = Router();

  // List available remediation actions
  router.get('/actions', (req, res) => {
    res.json(Object.keys(SAFE_COMMANDS));
  });

  // Execute a safe remediation action
  router.post('/execute', (req, res) => {
    const { action, project, param } = req.body;

    if (!action || !SAFE_COMMANDS[action]) {
      return res.status(400).json({ error: `Unknown action. Available: ${Object.keys(SAFE_COMMANDS).join(', ')}` });
    }

    const { cmd, cwd } = SAFE_COMMANDS[action](project, param);

    try {
      const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 15000 }).trim();
      const entry = store.addActivity('remediation', `Auto-fix executed: ${action}${project ? ` on ${project}` : ''}`);
      broadcast({ type: 'activity', payload: entry });
      res.json({ success: true, action, project, output });
    } catch (err) {
      res.json({ success: false, action, project, error: err.message });
    }
  });

  // Scan risks and return with executable fix actions
  router.get('/scan', (req, res) => {
    const risks = [];

    try {
      const { readdirSync, statSync } = require('fs');
      for (const name of readdirSync(PROJECTS_DIR)) {
        const p = join(PROJECTS_DIR, name);
        try { statSync(join(p, '.git')); } catch { continue; }
        try {
          const status = execSync('git status --porcelain', { cwd: p, encoding: 'utf-8' }).trim();
          const uncommitted = status ? status.split('\n').length : 0;
          if (uncommitted > 5) {
            risks.push({
              level: uncommitted > 20 ? 'critical' : 'warning',
              message: `${name}: ${uncommitted} uncommitted changes`,
              actions: [
                { action: 'git-status', project: name, label: 'View status' },
                { action: 'git-diff-stat', project: name, label: 'View changes' },
                { action: 'git-stash', project: name, label: 'Stash changes' },
              ],
            });
          }
        } catch {}
      }
    } catch {}

    // Usage risk
    const usage = store.getLatestUsage();
    if (usage?.session_percent != null && usage.session_percent <= 15) {
      risks.push({
        level: 'critical',
        message: `Session fuel at ${usage.session_percent}%`,
        actions: [
          { action: 'nexus-log', param: 'Low fuel -- wrapping up session', label: 'Log wrap-up' },
        ],
      });
    }

    res.json({ risks, scannedAt: new Date().toISOString() });
  });

  return router;
}
