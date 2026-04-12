#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — injects Nexus metabrain context.
 *
 * STANDALONE: reads directly from ~/.nexus/nexus.json (no server needed).
 *
 * Output goes to stdout → becomes system context for the new conversation.
 * Fails silently if no data exists yet — Claude starts cold, no crash.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const NEXUS_DB = process.env.NEXUS_DB_PATH || join(homedir(), '.nexus', 'nexus.json');

function detectProject() {
  const cwd = process.cwd();
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const name = (pkg.name || '').replace(/^@[^/]+\//, '');
      if (name.length > 1) return name;
    }
  } catch {}
  try {
    const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', timeout: 2000 }).trim();
    const match = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
    if (match?.[1]) return match[1];
  } catch {}
  return cwd.split(/[/\\]/).pop() || 'unknown';
}

function main() {
  const project = detectProject();

  // Read store directly — no server dependency
  if (!existsSync(NEXUS_DB)) return; // Fresh install, no data yet

  let data;
  try {
    data = JSON.parse(readFileSync(NEXUS_DB, 'utf-8'));
  } catch {
    return; // Corrupt or unreadable
  }

  const lines = [];
  lines.push(`[Nexus Metabrain] Project: ${project}`);

  // Fuel (latest usage reading)
  const usage = (data.usage || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (usage.length > 0) {
    const latest = usage[0];
    lines.push(`Fuel: session ${latest.session_percent ?? '?'}% | weekly ${latest.weekly_percent ?? '?'}%`);
  }

  // Tasks
  const tasks = data.tasks || [];
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const backlog = tasks.filter(t => t.status === 'backlog');
  if (inProgress.length > 0) {
    lines.push(`In progress (${inProgress.length}):`);
    for (const t of inProgress.slice(0, 5)) lines.push(`  #${t.id} ${t.title}`);
  }
  if (backlog.length > 0) {
    lines.push(`Backlog: ${backlog.length} tasks queued`);
  }

  // Recent sessions (filtered by project)
  const sessions = (data.sessions || [])
    .filter(s => !project || s.project?.toLowerCase() === project.toLowerCase())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);
  if (sessions.length > 0) {
    lines.push(`Recent sessions:`);
    for (const s of sessions) {
      const date = new Date(s.created_at).toLocaleDateString();
      lines.push(`  ${date}: ${s.summary.slice(0, 100)}`);
    }
  }

  // Key decisions
  const decisions = (data.ledger || [])
    .filter(d => !d.deprecated && (!project || d.project?.toLowerCase() === project.toLowerCase()))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  if (decisions.length > 0) {
    lines.push(`Key decisions:`);
    for (const d of decisions) lines.push(`  - ${d.decision.slice(0, 100)}`);
  }

  // Active thoughts
  const thoughts = (data.thoughts || []).filter(t => t.status === 'active');
  if (thoughts.length > 0) {
    lines.push(`Thought Stack (${thoughts.length}):`);
    for (const t of thoughts.slice(0, 3)) {
      lines.push(`  > ${t.text.slice(0, 80)}${t.context ? ` [${t.context.slice(0, 40)}]` : ''}`);
    }
  }

  // Git status
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 }).trim();
    const status = execSync('git status --porcelain', { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 }).trim();
    const uncommitted = status ? status.split('\n').length : 0;
    lines.push(`Git: ${branch}${uncommitted > 0 ? `, ${uncommitted} uncommitted` : ', clean'}`);
  } catch {}

  lines.push(`[/Nexus Metabrain]`);
  console.log(lines.join('\n'));
}

try { main(); } catch {}
