/**
 * v4.7.0-M1 — Multi-source CC memory bridge.
 *
 * The pre-v4.7 bridge scanned a single hardcoded path:
 *   ~/.claude/projects/*\/memory/*.md
 *
 * This worked for a developer using Claude Code on one machine. But the same
 * user with a Cowork sandbox running on a school laptop has memories at a
 * completely different path (typically `/sessions/<sandbox>/mnt/.auto-memory/`),
 * and v4.6 had no way to teach the bridge about it. Result: 19 TUL-project
 * memories never reached the Ledger; all 9 imported memories came from the
 * single CC-dev source.
 *
 * v4.7.0-M1 fixes that with a config-driven `MemoryBridgeConfig` containing
 * an array of `MemorySource` entries. Per-source glob → per-source try/catch
 * → optional content-hash dedup. Backward compatible: existing installs get
 * one default source matching the v4.6 behavior, populated by the v4.7.0-M1
 * migration in store.ts.
 *
 * Spec: v4.7.0-M1_multi_source_memory_bridge.md
 */

import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import type { MemorySource, MemoryBridgeConfig } from '../types.ts';

/**
 * The default v4.6.5-compatible source. Used by the v4.7.0-M1 migration when
 * populating `_memoryBridge` for the first time, and as the fallback when
 * scanCCMemories is called against a store with no config (e.g. unit tests).
 *
 * Honors NEXUS_CC_PROJECTS_DIR for users who relocated the CC projects dir.
 */
export function getDefaultMemorySources(): MemorySource[] {
  const ccProjectsRoot = process.env.NEXUS_CC_PROJECTS_DIR || join(homedir(), '.claude', 'projects');
  return [
    {
      name: 'cc-default',
      path: join(ccProjectsRoot, '*', 'memory', '*.md'),
      enabled: true,
    },
  ];
}

/** Build a fresh default config for first-run / migration. */
export function getDefaultMemoryBridgeConfig(): MemoryBridgeConfig {
  return {
    enabled: true,
    sources: getDefaultMemorySources(),
    dedup: {
      strategy: 'path',          // v4.6.5-compatible
      trackAllSources: false,
    },
  };
}

/** Cross-platform `~` expansion. POSIX uses HOME, Windows uses USERPROFILE. */
export function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  // ~/foo OR ~ alone OR ~\foo on Windows
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p; // ~user form not supported — leave as-is
}

/**
 * Minimal glob expander. Supports `*` (any single path segment, no slashes)
 * and `*` inside a segment (e.g. `*.md`). Does NOT support `**` (recursive)
 * — the documented patterns don't need it. Returns absolute file paths.
 *
 * Walks the filesystem segment-by-segment so a missing intermediate directory
 * just yields no results instead of throwing. Errors are swallowed at the
 * directory-read level; the caller's per-source try/catch is the ultimate
 * safety net (see scanCCMemoriesWithSources in memoryIndex.ts).
 */
export function expandGlob(pattern: string): string[] {
  const expanded = expandHome(pattern);

  // Normalize separators on Windows: glob patterns commonly use forward
  // slashes even on Win32. Path.join produces backslashes; we want comparable
  // segments either way.
  const segs = expanded.split(/[/\\]/).filter((s) => s.length > 0);
  if (segs.length === 0) return [];

  // Determine root. Absolute POSIX path starts with /. Windows drive letter.
  const isWindowsAbs = /^[A-Za-z]:$/.test(segs[0]);
  const isPosixAbs = expanded.startsWith('/') || expanded.startsWith('\\');
  let roots: string[];
  let rest: string[];

  if (isWindowsAbs) {
    roots = [segs[0] + '\\'];
    rest = segs.slice(1);
  } else if (isPosixAbs) {
    roots = ['/'];
    rest = segs;
  } else {
    roots = [process.cwd()];
    rest = segs;
  }

  let current = roots;
  for (const seg of rest) {
    const next: string[] = [];
    for (const dir of current) {
      try {
        if (seg === '*') {
          for (const name of readdirSync(dir)) next.push(join(dir, name));
        } else if (seg.includes('*')) {
          // Glob within segment: escape regex metachars except * → .*
          const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
          for (const name of readdirSync(dir)) {
            if (re.test(name)) next.push(join(dir, name));
          }
        } else {
          const candidate = join(dir, seg);
          if (existsSync(candidate)) next.push(candidate);
        }
      } catch {
        // unreachable directory — skip silently; the caller logs the source-level error
      }
    }
    current = next;
    if (current.length === 0) return [];
  }

  // Final filter: only return files (not dirs). The .md glob at the end
  // usually picks up files only, but a stray dir with a .md suffix would
  // otherwise leak through.
  return current.filter((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

// Sentinel exported for the `nexus memory sources` CLI subcommand (v4.7.0)
// and for tests that want to verify defaults without instantiating a store.
export const PLATFORM_LABEL: string = platform(); // 'win32' | 'darwin' | 'linux' | ...
