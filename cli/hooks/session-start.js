#!/usr/bin/env node
/**
 * Claude Code SessionStart hook — injects Nexus metabrain context.
 *
 * STANDALONE: reads directly from ~/.nexus/nexus.json (no server needed).
 *
 * Output goes to stdout → becomes system context for the new conversation.
 * Fails silently if no data exists yet — Claude starts cold, no crash.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, totalmem, freemem } from 'node:os';
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

  // Fuel (latest usage reading) — v4.4.0-alpha #368: includes age stamp + stale warning.
  // Stale reads silently mislead downstream decisions; the banner nudges a re-read.
  const usage = (data.usage || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (usage.length > 0) {
    const latest = usage[0];
    const ageMin = Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 60000);
    const ageStr = ageMin >= 60
      ? `${Math.floor(ageMin / 60)}h${ageMin % 60 > 0 ? ` ${ageMin % 60}m` : ''}`
      : `${ageMin}m`;
    const staleSuffix = ageMin >= 120 ? ' ⚠ STALE — re-read fuel before pacing decisions'
      : ageMin >= 60 ? ' (reading aging)'
      : '';
    lines.push(`Fuel: session ${latest.session_percent ?? '?'}% | weekly ${latest.weekly_percent ?? '?'}% (read ${ageStr} ago${staleSuffix})`);
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

  // Active thoughts — auto-pop the top one as recovery context
  const thoughts = (data.thoughts || []).filter(t => t.status === 'active');
  let resumedThought = null;
  if (thoughts.length > 0) {
    // Auto-pop the most recent thought (LIFO) and inject as recovery instruction
    const sorted = [...thoughts].sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
    const top = sorted[0];
    resumedThought = top;
    lines.push(`◈ RESUME: ${top.text}`);
    if (top.context) lines.push(`  Context: ${top.context}`);
    if (top.project) lines.push(`  Project: ${top.project}`);
    // Auto-pop: mark as resolved so next session gets a fresh stack
    top.status = 'resolved';
    top.popped_at = new Date().toISOString();
    try { writeFileSync(NEXUS_DB, JSON.stringify(data, null, 2)); } catch {}
    // Show remaining thoughts if any
    if (sorted.length > 1) {
      lines.push(`Thought Stack (${sorted.length - 1} remaining):`);
      for (const t of sorted.slice(1, 3)) {
        lines.push(`  > ${t.text.slice(0, 80)}${t.context ? ` [${t.context.slice(0, 40)}]` : ''}`);
      }
    }
  }

  // Git status + v4.4.0-alpha extensions (#372 delta since last session, #378 diff stat)
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 }).trim();
    const status = execSync('git status --porcelain', { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 }).trim();
    const uncommitted = status ? status.split('\n').length : 0;
    lines.push(`Git: ${branch}${uncommitted > 0 ? `, ${uncommitted} uncommitted` : ', clean'}`);

    // #378 — working-tree diff summary: scale of pending work visible at a glance.
    if (uncommitted > 0) {
      try {
        const shortstat = execSync('git diff --shortstat HEAD 2>nul', { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 }).trim();
        if (shortstat) lines.push(`  Working tree: ${shortstat}`);
      } catch {}
    }

    // #372 — commits landed on this branch since the most-recent Nexus session.
    // Catches cross-instance work (another Claude worked here, or you did manually on the road).
    const lastSession = (data.sessions || [])
      .filter(s => !project || s.project?.toLowerCase() === project.toLowerCase())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (lastSession?.created_at) {
      try {
        const since = lastSession.created_at;
        const delta = execSync(`git log --oneline --since="${since}" 2>nul`, { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 }).trim();
        if (delta) {
          const commits = delta.split('\n');
          lines.push(`Git delta since last session: ${commits.length} commit${commits.length !== 1 ? 's' : ''}`);
          for (const line of commits.slice(0, 3)) lines.push(`  ${line}`);
          if (commits.length > 3) lines.push(`  … +${commits.length - 3} more`);
        }
      } catch {}
    }
  } catch {}

  // #376 — system memory pressure. Local-AI workloads (LM Studio embeddings, Ollama)
  // hit this hard; the warning flags reality before heavy work swaps or OOMs.
  try {
    const memPct = Math.round(((totalmem() - freemem()) / totalmem()) * 100);
    if (memPct >= 95) lines.push(`⚠ Memory CRITICAL: ${memPct}% — heavy work will swap or OOM`);
    else if (memPct >= 85) lines.push(`⚠ Memory elevated: ${memPct}% — consider closing apps`);
  } catch {}

  // #377 — nexus.json size + backup freshness. Makes store growth and backup age visible
  // before they become problems (e.g. forgetting backups when disk gets tight).
  try {
    const mainStat = statSync(NEXUS_DB);
    const sizeMB = (mainStat.size / 1048576).toFixed(1);
    let bakStr = '';
    const bakPath = NEXUS_DB + '.bak';
    if (existsSync(bakPath)) {
      const bakStat = statSync(bakPath);
      const bakAgeMin = Math.floor((Date.now() - bakStat.mtime.getTime()) / 60000);
      const bakAgeStr = bakAgeMin >= 60
        ? `${Math.floor(bakAgeMin / 60)}h`
        : `${bakAgeMin}m`;
      bakStr = ` · backup ${bakAgeStr} ago`;
    }
    lines.push(`Store: nexus.json ${sizeMB}MB${bakStr}`);
  } catch {}

  // Chapter title suggestion — the Cartographer nudges Claude to anchor the
  // CC transcript TOC via mcp__ccd_session__mark_chapter. Claude chooses whether
  // to honor the suggestion. (#191 Chapter Narrator — pragmatic form.)
  // Priority: resumed thought > in-progress task > default project setting course.
  let chapterTitle;
  if (resumedThought) {
    const excerpt = resumedThought.text.slice(0, 32).replace(/[\n"]/g, ' ').trim();
    chapterTitle = `Resume: ${excerpt}${resumedThought.text.length > 32 ? '…' : ''}`;
  } else if (inProgress.length > 0) {
    const excerpt = inProgress[0].title.slice(0, 34).replace(/[\n"]/g, ' ').trim();
    chapterTitle = `Continuing: ${excerpt}${inProgress[0].title.length > 34 ? '…' : ''}`;
  } else {
    chapterTitle = `Setting course on ${project}`;
  }
  lines.push(`◈ Chapter: mark_chapter("${chapterTitle}")`);

  lines.push(`[/Nexus Metabrain]`);
  console.log(lines.join('\n'));
}

try { main(); } catch {}
