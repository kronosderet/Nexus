/**
 * Memory Bridge — indexes CC's auto-memory files at ~/.claude/projects/<cwd-hash>/memory/
 *
 * CC's auto-memory system writes typed markdown files (user / feedback / project /
 * reference / plan) per-project with YAML frontmatter. Nexus READS them (never
 * writes in Phase A) and stitches them into its view.
 *
 * Design notes:
 * - Pure FS read, no store dependency — same adapter pattern as planIndex.ts.
 * - Skips MEMORY.md (that's the per-project index, not a memory entry).
 * - Project inference chains two sources: (1) the encoded CWD path in the dir
 *   name, (2) content-based keyword match. Null fallback when nothing matches —
 *   don't lie about attribution.
 *
 * Configure via NEXUS_CC_PROJECTS_DIR env var
 * (defaults to ~/.claude/projects).
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { tryClassifyProject } from './projectConfig.ts';

export interface MemoryEntry {
  filename: string;          // e.g. "feedback_fuel_display.md"
  path: string;              // absolute path
  encodedProject: string;    // e.g. "C--Projects" — the CC dir identifier
  project: string | null;    // inferred project name; null if no hint matched
  type: string;              // "user" / "feedback" / "project" / "reference" / "plan" / other
  name: string;              // from frontmatter `name:`, or file stem fallback
  description: string;       // from frontmatter `description:`
  snippet: string;           // ~200 chars of body preview
  mtime: string;             // ISO timestamp
  ageDays: number;
}

export interface MemoriesIndex {
  available: boolean;
  memories: MemoryEntry[];
  totalFiles: number;        // total .md files scanned (excl. MEMORY.md)
  projectDirs: number;       // number of project memory dirs seen
  memoriesDir: string;       // resolved root, useful for debugging
}

const PROJECTS_ROOT = process.env.NEXUS_CC_PROJECTS_DIR || join(homedir(), '.claude', 'projects');

// v4.5.3 — project inference deferred to the user-configurable patterns in
// projectConfig.ts. Directory/content hints previously baked one developer's
// project names into the module; now we scan the encoded dir + content through
// the same pattern set the rest of Nexus uses.
const DIR_HINTS: Array<{ project: string; patterns: RegExp[] }> = [
  { project: 'Nexus', patterns: [
    /C--Projects$/i,    // Windows-encoded C:\Projects path
    /Claude-MD/i,       // v4.6.2 — was 'claude-md' (synthetic project leak); maps to Nexus
                        // since the Claude-MD memories function as Nexus reference notes.
                        // Older imports landed under 'claude-md' before; v4.6.2-D1 migrates them.
  ] },
];

function inferProject(encodedDir: string, content: string): string | null {
  for (const h of DIR_HINTS) {
    if (h.patterns.some(p => p.test(encodedDir))) return h.project;
  }
  // Delegate content-based inference to the shared classifier so users can
  // extend via ~/.nexus/projects.json instead of editing this file.
  return tryClassifyProject(content);
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
  const known = ['user', 'feedback', 'project', 'reference', 'plan', 'system'];
  return known.includes(prefix) ? prefix : 'other';
}

export function scanCCMemories(limit = 50): MemoriesIndex {
  if (!existsSync(PROJECTS_ROOT)) {
    return { available: false, memories: [], totalFiles: 0, projectDirs: 0, memoriesDir: PROJECTS_ROOT };
  }

  const now = Date.now();
  const entries: MemoryEntry[] = [];
  let totalFiles = 0;
  let projectDirs = 0;

  let projectDirNames: string[] = [];
  try { projectDirNames = readdirSync(PROJECTS_ROOT); } catch { return { available: false, memories: [], totalFiles: 0, projectDirs: 0, memoriesDir: PROJECTS_ROOT }; }

  for (const dirName of projectDirNames) {
    const memoryDir = join(PROJECTS_ROOT, dirName, 'memory');
    let dirStat;
    try { dirStat = statSync(memoryDir); } catch { continue; }
    if (!dirStat.isDirectory()) continue;
    projectDirs++;

    let files: string[] = [];
    try { files = readdirSync(memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md'); } catch { continue; }

    for (const file of files) {
      totalFiles++;
      const fullPath = join(memoryDir, file);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      let content = '';
      try { content = readFileSync(fullPath, 'utf-8').slice(0, 6000); } catch {}

      const { fields, bodyStart } = parseFrontmatter(content);
      const type = fields.type || typeFromFilename(file);
      const name = (fields.name || file.replace(/^[a-z]+_/, '').replace(/\.md$/, '').replace(/_/g, ' ')).slice(0, 80);
      const description = (fields.description || '').slice(0, 200);
      const body = content.slice(bodyStart).replace(/\s+/g, ' ').trim();
      const snippet = body.slice(0, 220);

      const project = inferProject(dirName, content);
      const mtime = stat.mtime.toISOString();
      const ageDays = Math.max(0, Math.round((now - stat.mtime.getTime()) / 86400000));

      entries.push({
        filename: file,
        path: fullPath,
        encodedProject: dirName,
        project,
        type,
        name,
        description,
        snippet,
        mtime,
        ageDays,
      });
    }
  }

  entries.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

  return {
    available: true,
    memories: entries.slice(0, Math.max(1, limit)),
    totalFiles,
    projectDirs,
    memoriesDir: PROJECTS_ROOT,
  };
}
