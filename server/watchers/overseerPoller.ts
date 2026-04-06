import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: any) => void;

const PROJECTS_DIR = 'C:/Projects';

/**
 * Overseer auto-scan: runs periodically, broadcasts risk alerts.
 * No AI needed -- pure logic risk detection.
 */
export function startOverseerPoller(store: NexusStore, broadcast: BroadcastFn, intervalMs = 300000) {
  function scan() {
    const risks = detectRisks(store);
    const critical = risks.filter(r => r.level === 'critical');
    const warnings = risks.filter(r => r.level === 'warning');

    // Only broadcast if there are new critical risks
    if (critical.length > 0) {
      for (const r of critical) {
        broadcast({ type: 'notification', payload: {
          title: 'Overseer Alert',
          message: r.message,
        }});
      }
      const entry = store.addActivity('overseer_alert', `Overseer detected ${critical.length} critical risk${critical.length !== 1 ? 's' : ''}`);
      broadcast({ type: 'activity', payload: entry });
    }

    // Store latest scan result for brief command
    store._lastRiskScan = {
      risks,
      scannedAt: new Date().toISOString(),
      critical: critical.length,
      warnings: warnings.length,
    };
  }

  // Initial scan at startup (delayed 10s to let everything settle)
  setTimeout(scan, 10000);

  // Periodic scan every 5 minutes
  const interval = setInterval(scan, intervalMs);
  console.log('  ◈ Overseer auto-scan active. Scanning every 5m...');
  return interval;
}

function detectRisks(store: NexusStore) {
  const risks: any[] = [];
  const tasks = store.getAllTasks();
  const sessions = store.getSessions({ limit: 15 });
  const usage = store.getLatestUsage();

  // Git risks
  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      const p = join(PROJECTS_DIR, name);
      try { statSync(join(p, '.git')); } catch { continue; }
      try {
        const status = execSync('git status --porcelain', { cwd: p, encoding: 'utf-8' }).trim();
        const uncommitted = status ? status.split('\n').length : 0;
        const lastDate = execSync('git log -1 --format=%aI 2>nul', { cwd: p, encoding: 'utf-8' }).trim();
        const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);

        if (uncommitted > 10) {
          risks.push({ level: uncommitted > 20 ? 'critical' : 'warning', category: 'uncommitted', project: name, message: `${name}: ${uncommitted} uncommitted changes at risk` });
        }
        if (daysSince > 14) {
          risks.push({ level: 'warning', category: 'stale', project: name, message: `${name} has gone cold (${daysSince}d since last commit)` });
        }
      } catch {}
    }
  } catch {}

  // Task risks
  for (const t of tasks) {
    if (t.status === 'in_progress') {
      const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
      if (age > 3) {
        risks.push({ level: 'info', category: 'stuck', message: `Task "${t.title}" stuck in progress for ${age}d` });
      }
    }
  }

  // Blocker risks from sessions
  for (const s of sessions.slice(0, 10)) {
    for (const b of (s.blockers || [])) {
      risks.push({ level: 'warning', category: 'blocker', project: s.project, message: `[${s.project}] Blocker: ${b}` });
    }
  }

  // Usage risks
  if (usage?.weekly_percent != null && usage.weekly_percent <= 15) {
    risks.push({ level: 'critical', category: 'fuel', message: `Weekly Claude fuel at ${usage.weekly_percent}% -- ration carefully, Captain` });
  }
  if (usage?.session_percent != null && usage.session_percent <= 10) {
    risks.push({ level: 'critical', category: 'fuel', message: `Session fuel critical: ${usage.session_percent}% -- log session summary now` });
  }

  return risks;
}
