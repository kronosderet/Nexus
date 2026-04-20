// v4.5.3 — user-editable project-classification config.
//
// Earlier builds hardcoded project names + detection patterns inside
// store.ts, memoryIndex.ts, planIndex.ts, plan.ts, and pulse.ts. Those names
// reflected ONE developer's projects, which worked for that developer but
// produced weird results for anyone else who cloned Nexus.
//
// This module centralizes three things:
//   (1) DEFAULT_PROJECT_PATTERNS — a minimal default (just "Nexus" with the
//       obvious self-match pattern) that every first-time user gets.
//   (2) getProjectPatterns() — merges the default with an optional user config
//       at $NEXUS_HOME/projects.json (or the path in NEXUS_PROJECTS_CONFIG).
//   (3) getExtraProjects() — extra NAS/outside-PROJECTS_DIR project dirs, also
//       loaded from config. Defaults to empty.
//
// User config shape (projects.json):
//   {
//     "patterns": [
//       { "name": "MyGame",   "patterns": ["\\bmygame\\b", "\\bP1A\\b"] },
//       { "name": "my-other", "patterns": ["\\bmyother\\b"] }
//     ],
//     "extra": [
//       { "name": "family-share", "path": "D:/shared/projects" }
//     ]
//   }
//
// Regexes are stored as strings (no `/.../ ` delimiters) and compiled with the
// `i` flag at load time. Invalid regexes are dropped with a warning.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ProjectPattern {
  name: string;
  patterns: RegExp[];
}

export interface ExtraProject {
  name: string;
  path: string;
}

// The out-of-the-box default — only matches Nexus itself. Everything else
// falls through and gets classified as the default project (see getDefaultProjectName).
export const DEFAULT_PROJECT_PATTERNS: ProjectPattern[] = [
  { name: 'Nexus', patterns: [/\bnexus\b/i, /\bmcp\b/i, /\bmcpb\b/i] },
];

export const DEFAULT_PROJECT_NAME = 'Nexus';

function resolveConfigPath(): string {
  if (process.env.NEXUS_PROJECTS_CONFIG) return process.env.NEXUS_PROJECTS_CONFIG;
  const home = process.env.NEXUS_HOME || join(homedir(), '.nexus');
  return join(home, 'projects.json');
}

interface RawPattern { name?: unknown; patterns?: unknown }
interface RawExtra { name?: unknown; path?: unknown }
interface RawConfig { patterns?: unknown; extra?: unknown }

function loadRawConfig(): RawConfig | null {
  const path = resolveConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as RawConfig;
  } catch (err) {
    console.warn(`[projectConfig] failed to read ${path}: ${(err as Error).message}`);
    return null;
  }
}

function compilePatterns(raw: unknown): ProjectPattern[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ProjectPattern[] = [];
  for (const entry of raw as RawPattern[]) {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;
    if (!Array.isArray(entry.patterns)) continue;
    const compiled: RegExp[] = [];
    for (const pat of entry.patterns) {
      if (typeof pat !== 'string') continue;
      try {
        compiled.push(new RegExp(pat, 'i'));
      } catch (err) {
        console.warn(`[projectConfig] invalid pattern for ${name}: ${pat} — ${(err as Error).message}`);
      }
    }
    if (compiled.length > 0) out.push({ name, patterns: compiled });
  }
  return out.length > 0 ? out : null;
}

// Cached across calls — the config file is only read once per process start.
// Tests can reset with _reset(). Exported for testing.
let patternsCache: ProjectPattern[] | null = null;
let extraCache: ExtraProject[] | null = null;

export function getProjectPatterns(): ProjectPattern[] {
  if (patternsCache) return patternsCache;
  const cfg = loadRawConfig();
  const userPatterns = cfg ? compilePatterns(cfg.patterns) : null;
  // Merge: user patterns take priority (first in detection order), then defaults
  // as fallback so the Nexus self-detection still works. Duplicate names are
  // de-duplicated by keeping the first occurrence (user wins).
  const merged: ProjectPattern[] = [];
  const seen = new Set<string>();
  for (const p of (userPatterns || []).concat(DEFAULT_PROJECT_PATTERNS)) {
    if (seen.has(p.name.toLowerCase())) continue;
    merged.push(p);
    seen.add(p.name.toLowerCase());
  }
  patternsCache = merged;
  return merged;
}

export function getExtraProjects(): ExtraProject[] {
  if (extraCache) return extraCache;
  const cfg = loadRawConfig();
  const list: ExtraProject[] = [];
  if (cfg && Array.isArray(cfg.extra)) {
    for (const entry of cfg.extra as RawExtra[]) {
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      const path = typeof entry.path === 'string' ? entry.path.trim() : '';
      if (name && path) list.push({ name, path });
    }
  }
  extraCache = list;
  return list;
}

// First-match project classifier. Runs through the configured patterns in
// order; falls back to DEFAULT_PROJECT_NAME if nothing matches.
export function classifyProject(text: string): string {
  const patterns = getProjectPatterns();
  for (const p of patterns) {
    if (p.patterns.some(re => re.test(text))) return p.name;
  }
  return DEFAULT_PROJECT_NAME;
}

// Same logic but returns null when no pattern matches, instead of the default.
// Callers that treat "no match" differently from "matched the default project"
// should use this. (Plan-index wants null to preserve the old "unknown" shape.)
export function tryClassifyProject(text: string): string | null {
  const patterns = getProjectPatterns();
  for (const p of patterns) {
    if (p.patterns.some(re => re.test(text))) return p.name;
  }
  return null;
}

// Used only by unit tests that populate + reset the cache.
export function _reset(): void {
  patternsCache = null;
  extraCache = null;
}
