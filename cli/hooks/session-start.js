#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — injects Nexus metabrain context.
 *
 * Output goes to stdout and becomes visible system context for the new
 * Claude Code conversation. Every session starts pre-briefed.
 *
 * Fails silently if Nexus server is down — Claude starts cold, no crash.
 * Install via: nexus hooks install
 */

const BASE = process.env.NEXUS_URL || 'http://localhost:3001';
const project = process.cwd().split(/[/\\]/).pop() || 'unknown';

async function api(path) {
  const res = await fetch(`${BASE}/api${path}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function main() {
  // Parallel fetch — all endpoints, fail independently
  const [tasks, sessions, decisions, fuel, risks] = await Promise.all([
    api('/tasks').catch(() => []),
    api(`/sessions?project=${encodeURIComponent(project)}&limit=3`).catch(() => []),
    api(`/ledger?project=${encodeURIComponent(project)}&limit=5`).catch(() => []),
    api('/estimator').catch(() => null),
    api('/overseer/risks').catch(() => ({ risks: [] })),
  ]);

  const active = (tasks || []).filter(t => t.status !== 'done');
  const inProgress = active.filter(t => t.status === 'in_progress');
  const backlog = active.filter(t => t.status === 'backlog');

  const lines = [];
  lines.push(`[Nexus Metabrain] Project: ${project}`);

  // Fuel
  if (fuel?.estimated) {
    lines.push(`Fuel: session ${fuel.estimated.session}% | weekly ${fuel.estimated.weekly}%`);
  }

  // Active tasks
  if (inProgress.length > 0) {
    lines.push(`In progress (${inProgress.length}):`);
    for (const t of inProgress.slice(0, 5)) lines.push(`  #${t.id} ${t.title}`);
  }
  if (backlog.length > 0) {
    lines.push(`Backlog: ${backlog.length} tasks queued`);
  }

  // Recent sessions
  if (sessions.length > 0) {
    lines.push(`Recent sessions:`);
    for (const s of sessions.slice(0, 3)) {
      const date = new Date(s.created_at).toLocaleDateString();
      lines.push(`  ${date}: ${s.summary.slice(0, 100)}`);
    }
  }

  // Key decisions
  if (decisions.length > 0) {
    lines.push(`Key decisions:`);
    for (const d of decisions.slice(0, 5)) {
      lines.push(`  - ${d.decision.slice(0, 100)}`);
    }
  }

  // Risks
  const riskList = (risks?.risks || []).filter(r => r.level === 'critical' || r.level === 'warning');
  if (riskList.length > 0) {
    lines.push(`Risks:`);
    for (const r of riskList.slice(0, 3)) lines.push(`  ! ${r.message}`);
  }

  lines.push(`[/Nexus Metabrain]`);
  console.log(lines.join('\n'));
}

main().catch(() => {
  // Complete silence on failure — Claude starts cold, no harm done.
});
