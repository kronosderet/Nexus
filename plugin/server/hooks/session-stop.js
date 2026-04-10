#!/usr/bin/env node
/**
 * Claude Code Stop hook — auto-bridges the session into the metabrain.
 *
 * When a conversation ends, this hook:
 * 1. Tries to generate an AI session summary via /api/auto-summary
 * 2. If AI is available: commits the summary as a real session entry
 * 3. If AI is down: logs a minimal "session ended" activity entry
 * 4. Checks for in-progress tasks and pushes a handoff thought
 *
 * All errors are swallowed — a failed stop hook must NEVER prevent
 * Claude Code from exiting cleanly.
 *
 * Install via: nexus hooks install
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const BASE = process.env.NEXUS_URL || 'http://localhost:3001';

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

const project = detectProject();

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000), // 120s — AI summary via local model can be slow
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function main() {
  let sessionLogged = false;

  // Step 1: Try AI-powered auto-summary → commit as real session
  try {
    const summary = await api('/auto-summary', {
      method: 'POST',
      body: JSON.stringify({ project }),
    });

    if (summary?.id) {
      // Auto-summary was generated AND committed (POST does both)
      sessionLogged = true;
    }
  } catch {
    // AI unavailable or summary failed — graceful degradation below
  }

  // Step 2: Fallback — log a minimal activity entry if summary failed
  if (!sessionLogged) {
    try {
      await api('/activity', {
        method: 'POST',
        body: JSON.stringify({
          type: 'system',
          message: `Session ended (${project}) — auto-summary unavailable, logged via stop hook`,
        }),
      });
    } catch {
      // Even activity logging failed — server probably down. Nothing to do.
    }
  }

  // Step 3: Check for in-progress tasks and push a handoff thought
  try {
    const tasks = await api('/tasks');
    const inProgress = (tasks || []).filter(t => t.status === 'in_progress');
    if (inProgress.length > 0) {
      const taskList = inProgress.map(t => `#${t.id} ${t.title}`).join(', ');
      await api('/thoughts', {
        method: 'POST',
        body: JSON.stringify({
          text: `Session ended with ${inProgress.length} task(s) still in progress: ${taskList}`,
          context: `auto-pushed by session-stop hook for ${project}`,
          project,
        }),
      });
    }
  } catch {
    // Non-critical — thoughts are a bonus, not a requirement
  }
}

main().catch(() => {
  // Absolute silence. Exit cleanly no matter what.
});
