#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook — logs each prompt to Nexus.
 *
 * STANDALONE: reads/writes ~/.nexus/nexus.json directly (no server needed).
 * Must be FAST (<500ms) — runs before Claude starts responding.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const NEXUS_DB = process.env.NEXUS_DB_PATH || join(homedir(), '.nexus', 'nexus.json');

function main() {
  // Read hook payload from stdin
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf-8').trim());
  } catch {
    return;
  }

  // Extract the latest user message from the transcript
  let promptText = '';
  try {
    if (payload.transcript_path) {
      const lines = readFileSync(payload.transcript_path, 'utf-8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'human' || entry.role === 'user') {
            if (typeof entry.message === 'string') promptText = entry.message;
            else if (typeof entry.content === 'string') promptText = entry.content;
            else if (Array.isArray(entry.message?.content)) {
              promptText = entry.message.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
            }
            if (promptText) break;
          }
        } catch {}
      }
    }
  } catch {}

  if (!promptText || promptText.length < 3) return;

  // Read store directly
  if (!existsSync(NEXUS_DB)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(NEXUS_DB, 'utf-8'));
  } catch {
    return;
  }

  // Log activity
  if (!data.activity) data.activity = [];
  const maxId = data.activity.length > 0 ? Math.max(...data.activity.map(a => a.id)) : 0;
  const summary = promptText.slice(0, 200) + (promptText.length > 200 ? '...' : '');
  data.activity.push({
    id: maxId + 1,
    type: 'prompt',
    message: `User: ${summary}`,
    meta: '{}',
    created_at: new Date().toISOString(),
  });
  if (data.activity.length > 500) data.activity = data.activity.slice(-500);

  // Quick write (not atomic — speed matters here)
  try {
    writeFileSync(NEXUS_DB, JSON.stringify(data, null, 2));
  } catch {}
}

try { main(); } catch {}
