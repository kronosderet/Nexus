#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — logs each user prompt to Nexus.
 *
 * When the user sends a message, this hook:
 * 1. Logs the prompt as an activity entry (so the activity stream shows what's being worked on)
 * 2. Checks if there's a matching backlog task and suggests moving it to in_progress
 *
 * The prompt text comes via stdin from Claude Code.
 * Must be FAST (<200ms) — this runs before Claude starts responding.
 *
 * Install via: nexus hooks install
 */

import { readFileSync } from 'node:fs';

const BASE = process.env.NEXUS_URL || 'http://localhost:3001';

async function main() {
  // Read prompt from stdin (Claude Code pipes it)
  let prompt = '';
  try {
    prompt = readFileSync(0, 'utf-8').trim();
  } catch {
    return; // No input — skip silently
  }

  if (!prompt || prompt.length < 5) return; // Skip tiny inputs

  // Truncate for logging (don't store massive prompts)
  const summary = prompt.slice(0, 200) + (prompt.length > 200 ? '...' : '');

  // Log as activity (fast, non-blocking)
  try {
    await fetch(`${BASE}/api/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'prompt',
        message: `User prompt: ${summary}`,
      }),
      signal: AbortSignal.timeout(1000), // Hard 1s limit — must not block CC
    });
  } catch {
    // Server down or slow — skip silently, never block Claude Code
  }
}

main().catch(() => {});
