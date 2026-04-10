#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — logs each user prompt to Nexus.
 *
 * Claude Code pipes a JSON object via stdin with:
 *   { session_id, transcript_path, cwd, ... }
 *
 * We read the transcript to get the latest user message, then log it
 * as an activity entry so the activity stream shows what's being worked on.
 *
 * Must be FAST (<500ms) — runs before Claude starts responding.
 */

import { readFileSync } from 'node:fs';

const BASE = process.env.NEXUS_URL || 'http://localhost:3001';

async function main() {
  // Read hook payload from stdin
  let payload;
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  // Extract the latest user message from the transcript
  let promptText = '';
  try {
    if (payload.transcript_path) {
      const lines = readFileSync(payload.transcript_path, 'utf-8').trim().split('\n');
      // Read from the end — find the last human/user message
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'human' || entry.role === 'user') {
            // Message might be a string or array of content blocks
            if (typeof entry.message === 'string') {
              promptText = entry.message;
            } else if (typeof entry.content === 'string') {
              promptText = entry.content;
            } else if (Array.isArray(entry.message?.content)) {
              promptText = entry.message.content
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join(' ');
            }
            if (promptText) break;
          }
        } catch {}
      }
    }
  } catch {}

  if (!promptText || promptText.length < 3) return;

  // Truncate for logging
  const summary = promptText.slice(0, 200) + (promptText.length > 200 ? '...' : '');

  // Log as activity
  try {
    await fetch(`${BASE}/api/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'prompt',
        message: `User: ${summary}`,
      }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {}
}

main().catch(() => {});
