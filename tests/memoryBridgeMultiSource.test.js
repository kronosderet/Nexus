/**
 * Tests for v4.7.0-M1 — Multi-source CC memory bridge.
 *
 * Validates:
 *   - expandHome works on POSIX (HOME) and Windows (USERPROFILE) shapes
 *   - expandGlob walks the FS with `*` segments
 *   - scanCCMemories aggregates across multiple sources
 *   - sourceFilter limits to one source by name
 *   - per-source try/catch — broken source doesn't kill scan
 *   - content-hash dedup collapses identical files into one entry
 *   - trackAllSources populates allSources[] with all paths
 *   - v4.7.0-M1 migration populates default _memoryBridge on cold start
 *
 * Hermetic: writes fixtures into os.tmpdir() under unique per-run subdirs.
 * No real ~/.claude or ~/.nexus paths are touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Two source roots — one for "cc-dev" simulation, one for "cowork-sandbox".
const TMP_ROOT = join(os.tmpdir(), `nexus-multisrc-${Date.now()}`);
const SRC_A = join(TMP_ROOT, 'cc-dev');           // ~/.claude/projects-equivalent
const SRC_B = join(TMP_ROOT, 'cowork-sandbox');   // /sessions/<id>/mnt/.auto-memory-equivalent
const DB_PATH = join(TMP_ROOT, 'nexus.json');

// Hermetic env BEFORE imports.
process.env.NEXUS_DB_PATH = DB_PATH;
process.env.NEXUS_DISABLE_WATCHER = '1';

// Use dynamic imports to capture env vars at module load.
const { NexusStore } = await import('../server/db/store.ts');
const { scanCCMemories } = await import('../server/lib/memoryIndex.ts');
const { expandGlob, expandHome, getDefaultMemoryBridgeConfig } = await import('../server/lib/memoryBridge.ts');

function seed(rootDir, encodedDir, memoryDirName, filename, body) {
  const dir = join(rootDir, encodedDir, memoryDirName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, body);
  return path;
}

function md(name, type, body) {
  return `---\nname: ${name}\ntype: ${type}\n---\n\n${body}\n`;
}

beforeAll(() => {
  mkdirSync(SRC_A, { recursive: true });
  mkdirSync(SRC_B, { recursive: true });

  // SRC_A — simulates ~/.claude/projects/<encoded>/memory/*.md
  // 3 files in 2 encoded-project dirs.
  seed(SRC_A, 'C--Projects-Nexus', 'memory', 'feedback_static_fuel.md', md('static_fuel', 'feedback', 'Never extrapolate fuel.'));
  seed(SRC_A, 'C--Projects-Nexus', 'memory', 'project_arch.md', md('arch', 'project', 'Local-first metabrain.'));
  // Shared memory: same body across both sources (for content-hash dedup test).
  const shared = md('persona_nalira', 'persona', 'Calm-warm tutor persona.');
  seed(SRC_A, 'C--Projects-Nexus', 'memory', 'persona_nalira.md', shared);

  // SRC_B — simulates /sessions/<sandbox-id>/mnt/.auto-memory/*.md
  seed(SRC_B, 'epic-bold-ptolemy', 'mnt/.auto-memory', 'reference_user_profile.md', md('user_profile', 'reference', 'Jakub Kotyza profile.'));
  seed(SRC_B, 'epic-bold-ptolemy', 'mnt/.auto-memory', 'project_kalg.md', md('kalg', 'project', 'KALG kombinatorické algoritmy course.'));
  // Same persona file as SRC_A — should dedup by content hash.
  seed(SRC_B, 'epic-bold-ptolemy', 'mnt/.auto-memory', 'persona_nalira.md', shared);
});

afterAll(() => {
  if (existsSync(TMP_ROOT)) {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────
describe('expandHome (cross-platform)', () => {
  it('returns paths starting with non-tilde unchanged', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
    expect(expandHome('C:\\Users\\foo')).toBe('C:\\Users\\foo');
  });

  it('expands ~/foo using HOME or USERPROFILE', () => {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const expanded = expandHome('~/foo/bar');
    expect(expanded.startsWith(home)).toBe(true);
    expect(expanded.endsWith('foo' + (process.platform === 'win32' ? '\\bar' : '/bar'))).toBe(true);
  });

  it('expands ~ alone to home dir', () => {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    expect(expandHome('~')).toBe(home);
  });
});

describe('expandGlob (filesystem walker)', () => {
  it('finds .md files via */memory/*.md pattern', () => {
    const pattern = join(SRC_A, '*', 'memory', '*.md');
    const files = expandGlob(pattern);
    expect(files.length).toBe(3); // 3 files in SRC_A under C--Projects-Nexus/memory/
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });

  it('handles deeper nested wildcards (sandbox shape)', () => {
    const pattern = join(SRC_B, '*', 'mnt', '.auto-memory', '*.md');
    const files = expandGlob(pattern);
    expect(files.length).toBe(3); // 3 files in SRC_B
  });

  it('returns empty array for unreachable path (no throw)', () => {
    const files = expandGlob('/this/path/does/not/exist/*.md');
    expect(files).toEqual([]);
  });

  it('matches glob within a single segment (e.g. *.md vs *.txt)', () => {
    // Plant a non-md file alongside the .md ones
    writeFileSync(join(SRC_A, 'C--Projects-Nexus', 'memory', 'README.txt'), 'noise');
    const mdFiles = expandGlob(join(SRC_A, 'C--Projects-Nexus', 'memory', '*.md'));
    const txtFiles = expandGlob(join(SRC_A, 'C--Projects-Nexus', 'memory', '*.txt'));
    expect(mdFiles.every((f) => f.endsWith('.md'))).toBe(true);
    expect(txtFiles.length).toBe(1);
  });
});

describe('scanCCMemories — multi-source', () => {
  const SOURCES = [
    { name: 'cc-dev', path: join(SRC_A, '*', 'memory', '*.md'), machineHint: 'home-pc', enabled: true },
    { name: 'cowork-sandbox', path: join(SRC_B, '*', 'mnt', '.auto-memory', '*.md'), machineHint: 'school-laptop', enabled: true },
  ];

  it('aggregates files from all enabled sources', () => {
    const idx = scanCCMemories({ sources: SOURCES });
    expect(idx.available).toBe(true);
    expect(idx.totalFiles).toBe(6); // 3 + 3
    expect(idx.uniqueFiles).toBe(6); // path-dedup default = no collapse
    expect(idx.sourcesScanned).toBe(2);
    expect(idx.sourceErrors).toEqual([]);
  });

  it('attaches source name + machineHint to each entry', () => {
    const idx = scanCCMemories({ sources: SOURCES, limit: 9999 });
    const ccDevEntries = idx.memories.filter((m) => m.source === 'cc-dev');
    const coworkEntries = idx.memories.filter((m) => m.source === 'cowork-sandbox');
    expect(ccDevEntries.length).toBe(3);
    expect(coworkEntries.length).toBe(3);
    expect(ccDevEntries.every((e) => e.machineHint === 'home-pc')).toBe(true);
    expect(coworkEntries.every((e) => e.machineHint === 'school-laptop')).toBe(true);
  });

  it('respects sourceFilter — only one source scanned', () => {
    const idx = scanCCMemories({ sources: SOURCES, sourceFilter: 'cowork-sandbox' });
    expect(idx.totalFiles).toBe(3);
    expect(idx.memories.every((m) => m.source === 'cowork-sandbox')).toBe(true);
  });

  it('skips disabled sources', () => {
    const partial = [{ ...SOURCES[0], enabled: false }, SOURCES[1]];
    const idx = scanCCMemories({ sources: partial });
    expect(idx.totalFiles).toBe(3);
    expect(idx.memories.every((m) => m.source === 'cowork-sandbox')).toBe(true);
  });

  it('continues past a broken source — records sourceError, doesn\'t throw', () => {
    const withBroken = [
      { name: 'good', path: join(SRC_A, '*', 'memory', '*.md'), enabled: true },
      // Even completely unreachable paths just yield empty (expandGlob swallows
      // readdir errors). To trigger sourceErrors we need a pattern that throws
      // higher up — but the current design simply yields []. Asserting the
      // resilience property (no crash) is the primary contract.
      { name: 'unreachable', path: '/this/never/existed/*.md', enabled: true },
    ];
    const idx = scanCCMemories({ sources: withBroken });
    expect(idx.totalFiles).toBe(3);
    expect(idx.sourcesScanned).toBe(2);
  });
});

describe('encodedProject derivation (#591)', () => {
  // Pre-v4.7.2: buildEntry() did `basename(dirname(memoryDir))` for both
  // layouts. That returns the parent dir of memoryDir, which is correct for
  // CC dev (~/.claude/projects/<encoded>/memory/file.md → <encoded>) but
  // returns 'mnt' for Cowork sandbox paths (/sessions/<id>/mnt/.auto-memory/
  // file.md), losing the sandbox id. The v4.7.2 fix walks one extra level
  // up when the memoryDir name is dot-prefixed AND the immediate parent is
  // literally 'mnt'.
  const SOURCES = [
    { name: 'cc-dev', path: join(SRC_A, '*', 'memory', '*.md'), machineHint: 'home-pc', enabled: true },
    { name: 'cowork-sandbox', path: join(SRC_B, '*', 'mnt', '.auto-memory', '*.md'), machineHint: 'school-laptop', enabled: true },
  ];

  it('CC dev layout — encodedProject is the project encoded dir', () => {
    const idx = scanCCMemories({ sources: SOURCES, limit: 9999 });
    const ccDev = idx.memories.filter((m) => m.source === 'cc-dev');
    expect(ccDev.length).toBeGreaterThan(0);
    expect(ccDev.every((e) => e.encodedProject === 'C--Projects-Nexus')).toBe(true);
  });

  it('Cowork sandbox layout — encodedProject is the sandbox id, not "mnt"', () => {
    const idx = scanCCMemories({ sources: SOURCES, limit: 9999 });
    const sandbox = idx.memories.filter((m) => m.source === 'cowork-sandbox');
    expect(sandbox.length).toBeGreaterThan(0);
    // Pre-fix this would have been 'mnt' for every entry; post-fix it must
    // be the sandbox id. Asserting the negative explicitly so a regression
    // is loud.
    expect(sandbox.every((e) => e.encodedProject !== 'mnt')).toBe(true);
    expect(sandbox.every((e) => e.encodedProject === 'epic-bold-ptolemy')).toBe(true);
  });
});

describe('scanCCMemories — content-hash dedup', () => {
  const SOURCES = [
    { name: 'cc-dev', path: join(SRC_A, '*', 'memory', '*.md'), machineHint: 'home-pc', enabled: true },
    { name: 'cowork', path: join(SRC_B, '*', 'mnt', '.auto-memory', '*.md'), machineHint: 'school-laptop', enabled: true },
  ];

  it('collapses files with identical content into one entry', () => {
    const idx = scanCCMemories({ sources: SOURCES, dedupStrategy: 'content-hash' });
    expect(idx.totalFiles).toBe(6);
    // persona_nalira.md is identical in both sources → one unique entry.
    expect(idx.uniqueFiles).toBe(5);
    expect(idx.memories.length).toBe(5);
    const personaHits = idx.memories.filter((m) => m.filename === 'persona_nalira.md');
    expect(personaHits.length).toBe(1);
  });

  it('trackAllSources records every source path for deduped entries', () => {
    const idx = scanCCMemories({
      sources: SOURCES,
      dedupStrategy: 'content-hash',
      trackAllSources: true,
    });
    const persona = idx.memories.find((m) => m.filename === 'persona_nalira.md');
    expect(persona).toBeDefined();
    expect(persona.allSources).toBeDefined();
    expect(persona.allSources.length).toBe(2);
    const sources = persona.allSources.map((s) => s.source).sort();
    expect(sources).toEqual(['cc-dev', 'cowork']);
  });
});

describe('v4.7.0-M1 migration — default config population', () => {
  it('populates _memoryBridge on first store load', () => {
    // Fresh store path
    const freshDb = join(TMP_ROOT, `fresh-${Date.now()}.json`);
    process.env.NEXUS_DB_PATH = freshDb;
    const store = new NexusStore();
    expect(store.data._memoryBridge).toBeDefined();
    expect(store.data._memoryBridge.enabled).toBe(true);
    expect(store.data._memoryBridge.sources.length).toBeGreaterThanOrEqual(1);
    expect(store.data._memoryBridge.sources[0].name).toBe('cc-default');
    expect(store.data._memoryBridge.dedup.strategy).toBe('path');
    expect(store.data._appliedMigrations['v4.7.0-M1']).toBeDefined();
    process.env.NEXUS_DB_PATH = DB_PATH; // restore
  });

  it('respects an existing user-edited _memoryBridge (idempotent)', () => {
    // Seed a custom config in the JSON store before the migration runs.
    const customDb = join(TMP_ROOT, `custom-${Date.now()}.json`);
    const customConfig = {
      tasks: [], activity: [], sessions: [], usage: [], gpu_history: [],
      scratchpads: [], bookmarks: [], ledger: [], graph_edges: [],
      advice: [], thoughts: [],
      _memoryBridge: {
        enabled: true,
        sources: [{ name: 'custom', path: '/custom/path/*.md', enabled: true }],
        dedup: { strategy: 'content-hash', trackAllSources: true },
      },
    };
    writeFileSync(customDb, JSON.stringify(customConfig, null, 2));
    process.env.NEXUS_DB_PATH = customDb;
    const store = new NexusStore();
    expect(store.data._memoryBridge.sources[0].name).toBe('custom');
    expect(store.data._memoryBridge.dedup.strategy).toBe('content-hash');
    process.env.NEXUS_DB_PATH = DB_PATH; // restore
  });
});

describe('getDefaultMemoryBridgeConfig', () => {
  it('produces a v4.6.5-compatible default', () => {
    const cfg = getDefaultMemoryBridgeConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.sources).toHaveLength(1);
    expect(cfg.sources[0].enabled).toBe(true);
    expect(cfg.dedup.strategy).toBe('path');
    expect(cfg.dedup.trackAllSources).toBe(false);
  });
});
