#!/usr/bin/env node
// Claude Code UserPromptSubmit hook — reserved stub (v4.3+).
//
// CHANGED in v4.3 (task #190): This hook used to log every user prompt to
// Nexus's activity stream as "User: <first 200 chars>". That was redundant:
//
//   1. CC's session JSONL under ~/.claude/projects/ already captures the full
//      transcript verbatim — the raw log IS the transcript.
//   2. Nexus's activity stream is meant for SEMANTIC events (deploys, fixes,
//      decisions, task state changes) — not every "ok" and "next" a user types.
//   3. 500-entry cap meant genuine events got rotated out by prompt noise.
//
// The v4.3 philosophy pivot (Decision #144): Nexus reads from CC's scaffolding
// rather than duplicating it. The session JSONL IS the prompt log.
//
// This stub is kept wired in settings.json so future work can reuse the hook
// slot for semantic classification — e.g. only log prompts that match patterns
// like "commit", "deploy", "remember this decision", or cross a confidence
// threshold for being a significant intent. Until that exists, this is a no-op.
//
// STANDALONE: no store access needed.
// Must still be FAST (<50ms) — runs before Claude starts responding.

import { readFileSync } from 'node:fs';

function main() {
  // Drain stdin and discard — CC's transcript is the truth.
  // Reading prevents a dangling pipe warning from the parent process.
  try { readFileSync(0, 'utf-8'); } catch {}
  // No-op. Future: semantic classification gate.
}

try { main(); } catch {}
