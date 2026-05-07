/**
 * Memory Bridge — indexes CC's auto-memory files.
 *
 * v4.6.5 and earlier: scanned a single hardcoded path
 * (~/.claude/projects/<cwd-hash>/memory/, configurable via NEXUS_CC_PROJECTS_DIR).
 *
 * v4.7.0-M1: multi-source. Pulls from every source in `MemoryBridgeConfig.sources[]`,
 * with optional content-hash dedup so the same file content reaching the bridge
 * over two paths (e.g. shared persona memory across machines) is one Decision
 * but tracks both source paths.
 *
 * Pure FS read, no store dependency — same adapter pattern as planIndex.ts.
 * Skips MEMORY.md (per-project index file, not a memory entry).
 */

import { readFileSync, statSync } from 'fs';
import { basename, dirname } from 'path';
import { createHash } from 'crypto';
import { tryClassifyProject } from './projectConfig.ts';
import { expandGlob, getDefaultMemorySources } from './memoryBridge.ts';
import type { MemorySource } from '../types.ts';

export interface MemoryEntry {
  filename: string;          // e.g. "feedback_fuel_display.md"
  path: string;              // absolute path (canonical / first-seen when content-hash dedup)
  encodedProject: string;    // e.g. "C--Projects" — the CC dir identifier (or sandbox id)
  project: string | null;    // inferred project name; null if no hint matched
  type: string;              // "user" / "feedback" / "project" / "reference" / "plan" / other
  name: string;              // from frontmatter `name:`, or file stem fallback
  description: string;       // from frontmatter `description:`
  snippet: string;           // ~200 chars of body preview
  mtime: string;             // ISO timestamp
  ageDays: number;
  // v4.7.0-M1 — provenance fields
  source: string;            // source `name` from MemoryBridgeConfig.sources[]
  machineHint?: string;      // optional informational label, e.g. "domaci-pc"
  contentHash?: string;      // sha256 (16 hex chars) — populated when dedup is content-hash
  allSources?: Array<{       // populated when dedup=content-hash AND trackAllSources=true
    source: string;
    path: string;
    machineHint?: string;
  }>;
}

export interface MemoriesIndex {
  available: boolean;
  memories: MemoryEntry[];
  totalFiles: number;        // total .md files scanned (excl. MEMORY.md), pre-dedup
  uniqueFiles: number;       // post-dedup count (same as totalFiles when dedup=path)
  projectDirs: number;       // number of distinct memory-containing dirs seen across all sources
  memoriesDir: string;       // legacy field — set to first source path for back-compat
  // v4.7.0-M1
  sourcesScanned: number;    // count of enabled sources actually iterated
  sourceErrors: Array<{ source: string; error: string }>;  // per-source failures (e.g. unreachable sandbox)
}

export interface ScanOptions {
  limit?: number;
  sources?: MemorySource[];                       // overrides config; default = getDefaultMemorySources()
  sourceFilter?: string;                          // limit to one source by name
  dedupStrategy?: 'path' | 'content-hash';        // default 'path'
  trackAllSources?: boolean;                      // only meaningful with content-hash
}

/** Parse a minimal YAML frontmatter block from the top of a markdown file. */
function parseFrontmatter(content: string): { fields: Record<string, string>; bodyStart: number } {
  const fields: Record<string, string> = {};
  if (!content.startsWith('---')) return { fields, bodyStart: 0 };

  const closeIdx = content.indexOf('\n---', 3);
  if (closeIdx < 0) return { fields, bodyStart: 0 };

  const raw = content.slice(3, closeIdx).trim();
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, bodyStart: closeIdx + 4 };
}

/** Infer `type` from filename stem when frontmatter is missing/malformed. */
function typeFromFilename(filename: string): string {
  const stem = filename.replace(/\.md$/, '');
  const prefix = stem.split('_')[0];
  const known = ['user', 'feedback', 'project', 'reference', 'plan', 'system', 'persona'];
  return known.includes(prefix) ? prefix : 'other';
}

const DIR_HINTS: Array<{ project: string; patterns: RegExp[] }> = [
  { project: 'Nexus', patterns: [
    /C--Projects$/i,
    /Claude-MD/i,
  ] },
];

function inferProject(encodedDir: string, content: string): string | null {
  for (const h of DIR_HINTS) {
    if (h.patterns.some((p) => p.test(encodedDir))) return h.project;
  }
  return tryClassifyProject(content);
}

function sha256short(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Build a `MemoryEntry` from one absolute file path. Returns null if the file
 * is unreadable or is `MEMORY.md` (per-project index, not an entry).
 */
function buildEntry(filePath: string, source: MemorySource): MemoryEntry | null {
  const filename = basename(filePath);
  if (filename === 'MEMORY.md') return null;
  if (!filename.endsWith('.md')) return null;

  let stat;
  try { stat = statSync(filePath); } catch { return null; }
  if (!stat.isFile()) return null;

  let content = '';
  try { content = readFileSync(filePath, 'utf-8').slice(0, 6000); } catch { return null; }

  const { fields, bodyStart } = parseFrontmatter(content);
  const type = fields.type || typeFromFilename(filename);
  const name = (fields.name || filename.replace(/^[a-z]+_/, '').replace(/\.md$/, '').replace(/_/g, ' ')).slice(0, 80);
  const description = (fields.description || '').slice(0, 200);
  const body = content.slice(bodyStart).replace(/\s+/g, ' ').trim();
  const snippet = body.slice(0, 220);

  // The "encoded project" identifies the owning project. Layout depends on the
  // source:
  //   CC dev:         ~/.claude/projects/<encoded>/memory/file.md   → <encoded>
  //   Cowork sandbox: /sessions/<id>/mnt/.auto-memory/file.md       → <id>
  // The CC-dev shape needs one dirname() walk-up; the Cowork shape needs two
  // because `mnt` sits between the sandbox id and the dot-prefixed memory dir.
  // We detect the sandbox shape by spotting the dot-prefixed memoryDir name
  // (e.g. `.auto-memory`) and the literal `mnt` parent — anything else falls
  // through to the v4.6.5 single-walk-up path. v4.7.2 #591 fix.
  const memoryDir = dirname(filePath);                 // .../memory  OR  .../.auto-memory
  const memoryDirName = basename(memoryDir);
  let encodedProject = basename(dirname(memoryDir));   // CC dev → <encoded>; sandbox → 'mnt' (raw)
  if (memoryDirName.startsWith('.') && encodedProject === 'mnt') {
    encodedProject = basename(dirname(dirname(memoryDir)));  // sandbox → <id>
  }

  const project = inferProject(encodedProject, content);
  const mtime = stat.mtime.toISOString();
  const ageDays = Math.max(0, Math.round((Date.now() - stat.mtime.getTime()) / 86400000));

  return {
    filename,
    path: filePath,
    encodedProject,
    project,
    type,
    name,
    description,
    snippet,
    mtime,
    ageDays,
    source: source.name,
    machineHint: source.machineHint,
  };
}

/**
 * Multi-source scan. The legacy single-arg form `scanCCMemories(50)` still
 * works (treated as `{ limit: 50 }`) — keeps existing callers in
 * /api/cc-memory and the brief-injection path compiling.
 */
export function scanCCMemories(optsOrLimit: number | ScanOptions = 50): MemoriesIndex {
  const opts: ScanOptions = typeof optsOrLimit === 'number' ? { limit: optsOrLimit } : optsOrLimit;
  const limit = opts.limit ?? 50;
  const dedupStrategy = opts.dedupStrategy ?? 'path';
  const trackAllSources = opts.trackAllSources ?? false;
  const sourceFilter = opts.sourceFilter;

  const allSources = (opts.sources ?? getDefaultMemorySources()).filter((s) => s.enabled);
  const sources = sourceFilter ? allSources.filter((s) => s.name === sourceFilter) : allSources;

  const allEntries: MemoryEntry[] = [];
  const sourceErrors: Array<{ source: string; error: string }> = [];
  const seenDirs = new Set<string>();
  let totalFiles = 0;
  let sourcesScanned = 0;

  for (const src of sources) {
    sourcesScanned++;
    let files: string[] = [];
    try {
      files = expandGlob(src.path);
    } catch (err) {
      sourceErrors.push({ source: src.name, error: (err as Error).message });
      continue;
    }

    for (const filePath of files) {
      const entry = buildEntry(filePath, src);
      if (!entry) continue;
      totalFiles++;
      seenDirs.add(dirname(filePath));
      if (dedupStrategy === 'content-hash') {
        try {
          // For dedup, hash the FULL file (not the truncated 6 KB read used for the snippet).
          // Same content across machines should always hash identically.
          entry.contentHash = sha256short(readFileSync(filePath, 'utf-8'));
        } catch {
          // Fall back to path-based identity if the hash read fails
          entry.contentHash = sha256short(filePath);
        }
      }
      allEntries.push(entry);
    }
  }

  // Dedup
  const deduped = dedupEntries(allEntries, dedupStrategy, trackAllSources);

  deduped.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

  return {
    available: sources.length > 0,
    memories: deduped.slice(0, Math.max(1, limit)),
    totalFiles,
    uniqueFiles: deduped.length,
    projectDirs: seenDirs.size,
    memoriesDir: sources[0]?.path ?? '',  // legacy field; first source for back-compat
    sourcesScanned,
    sourceErrors,
  };
}

function dedupEntries(
  entries: MemoryEntry[],
  strategy: 'path' | 'content-hash',
  trackAllSources: boolean
): MemoryEntry[] {
  const seen = new Map<string, MemoryEntry>();
  for (const entry of entries) {
    const key = strategy === 'content-hash' ? (entry.contentHash || entry.path) : entry.path;
    const existing = seen.get(key);
    if (!existing) {
      const merged: MemoryEntry = trackAllSources && strategy === 'content-hash'
        ? { ...entry, allSources: [{ source: entry.source, path: entry.path, machineHint: entry.machineHint }] }
        : entry;
      seen.set(key, merged);
    } else if (trackAllSources && strategy === 'content-hash') {
      // Already seen this content; record the additional source path.
      if (!existing.allSources) existing.allSources = [];
      existing.allSources.push({ source: entry.source, path: entry.path, machineHint: entry.machineHint });
      // Keep the newest mtime so listings still reflect the latest write
      if (new Date(entry.mtime).getTime() > new Date(existing.mtime).getTime()) {
        existing.mtime = entry.mtime;
        existing.ageDays = entry.ageDays;
      }
    }
    // If !trackAllSources, additional duplicates are silently dropped.
  }
  return Array.from(seen.values());
}
