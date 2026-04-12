#!/usr/bin/env node
/**
 * Claude Code Stop hook — auto-logs session end to Nexus.
 *
 * STANDALONE: reads/writes ~/.nexus/nexus.json directly (no server needed).
 * Falls back gracefully — a failed stop hook must NEVER block Claude from exiting.
 *
 * 1. Logs a "session ended" activity entry
 * 2. Pushes a handoff thought if tasks are in-progress (with dedup)
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const NEXUS_DIR = process.env.NEXUS_HOME || join(homedir(), '.nexus');
const NEXUS_DB = process.env.NEXUS_DB_PATH || join(NEXUS_DIR, 'nexus.json');

function detectProject() {
  const cwd = process.cwd();
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const name = JSON.parse(readFileSync(pkgPath, 'utf-8')).name?.replace(/^@[^/]+\//, '');
      if (name?.length > 1) return name;
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
  if (!existsSync(NEXUS_DB)) return; // No data yet

  let data;
  try {
    data = JSON.parse(readFileSync(NEXUS_DB, 'utf-8'));
  } catch {
    return;
  }

  const project = detectProject();
  const now = new Date().toISOString();

  // 1. Log activity
  if (!data.activity) data.activity = [];
  const maxId = data.activity.length > 0 ? Math.max(...data.activity.map(a => a.id)) : 0;
  data.activity.push({
    id: maxId + 1,
    type: 'system',
    message: `Session ended (${project})`,
    meta: '{}',
    created_at: now,
  });
  // Cap at 500
  if (data.activity.length > 500) data.activity = data.activity.slice(-500);

  // 2. Push handoff thought for in-progress tasks (with dedup)
  const tasks = data.tasks || [];
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  if (inProgress.length > 0 && data.thoughts) {
    const existing = (data.thoughts || []).filter(t => t.status === 'active');
    const alreadyTracked = existing.some(th =>
      inProgress.some(t => th.text.includes(`#${t.id}`))
    );
    if (!alreadyTracked) {
      const maxThoughtId = data.thoughts.length > 0 ? Math.max(...data.thoughts.map(t => t.id)) : 0;
      const taskList = inProgress.map(t => `#${t.id} ${t.title}`).join(', ');
      data.thoughts.push({
        id: maxThoughtId + 1,
        text: `Session ended with ${inProgress.length} task(s) still in progress: ${taskList}`,
        context: `auto-pushed by session-stop hook for ${project}`,
        project,
        status: 'active',
        created_at: now,
      });
    }
  }

  // Atomic write
  try {
    const json = JSON.stringify(data, null, 2);
    const tmp = NEXUS_DB + '.tmp';
    writeFileSync(tmp, json);
    try { if (existsSync(NEXUS_DB + '.bak')) renameSync(NEXUS_DB + '.bak', NEXUS_DB + '.bak.2'); } catch {}
    try { if (existsSync(NEXUS_DB)) renameSync(NEXUS_DB, NEXUS_DB + '.bak'); } catch {}
    renameSync(tmp, NEXUS_DB);
  } catch {}
}

try { main(); } catch {}
