/**
 * Tests for v4.3.8 #200 — Memory Bridge first-run import.
 *
 * Validates NexusStore.importAllCCMemories + importCCMemory:
 *   - fresh import creates reference decisions
 *   - re-run is idempotent (dedup by file path)
 *   - mtime drift triggers update-in-place
 *   - dry_run reports counts without writing
 *   - force re-imports even tracked files
 *   - project filter narrows scope
 *   - auto-link is bypassed (no graph edge spam)
 *
 * Hermetic: overrides NEXUS_CC_PROJECTS_DIR and NEXUS_DB_PATH to temp dirs
 * so the test never touches real ~/.claude or nexus.json data.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import os from 'os';

// ── Hermetic fixtures ─────────────────────────────────────
const TMP_ROOT = join(os.tmpdir(), `nexus-memimport-test-${Date.now()}`);
const PROJECTS_DIR = join(TMP_ROOT, 'projects');
const DB_PATH = join(TMP_ROOT, 'nexus.json');

process.env.NEXUS_CC_PROJECTS_DIR = PROJECTS_DIR;
process.env.NEXUS_DB_PATH = DB_PATH;

// Imports AFTER env vars are set — module-level constants capture them at load.
const { NexusStore } = await import('../server/db/store.ts');

// Fixture builder ─────────────────────────────────────────
function seedMemory(encodedProject, filename, body, mtime) {
  const dir = join(PROJECTS_DIR, encodedProject, 'memory');
  mkdirSync(dir, { recursive: true });
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, body);
  if (mtime) utimesSync(fullPath, mtime, mtime);
  return fullPath;
}

function buildFixture() {
  // Three memories across two encoded-project dirs. "C--Projects" → Nexus,
  // "C--Projects-Shadowrun" → Shadowrun per memoryIndex DIR_HINTS.
  seedMemory('C--Projects', 'feedback_fuel_display.md',
    `---\nname: fuel_display_static\ndescription: Never show fuel as ticking down\ntype: feedback\n---\n\nKeep values static until user reports new reading.\n`
  );
  seedMemory('C--Projects', 'project_nexus_architecture.md',
    `---\nname: nexus_architecture\ndescription: Local-first metabrain with 26 MCP tools\ntype: project\n---\n\nNexus runs as both dashboard and standalone MCPB.\n`
  );
  seedMemory('Shadowrun', 'project_sr3_webapp.md',
    `---\nname: sr3_lan_webapp\ndescription: Shadowrun 3rd Edition LAN web app\ntype: project\n---\n\nNode.js/WS server + vanilla JS Web Components.\n`
  );
}

// ──────────────────────────────────────────────────────────
beforeAll(() => {
  mkdirSync(PROJECTS_DIR, { recursive: true });
});

afterAll(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

// Fresh store + fresh fixtures per test — each test is independent.
let store;
beforeEach(() => {
  // Wipe fixtures + DB
  try { rmSync(PROJECTS_DIR, { recursive: true, force: true }); } catch {}
  try { rmSync(DB_PATH, { force: true }); } catch {}
  mkdirSync(PROJECTS_DIR, { recursive: true });
  buildFixture();
  store = new NexusStore();
});

// ──────────────────────────────────────────────────────────
describe('NexusStore.importAllCCMemories', () => {
  it('fresh import creates lifecycle=reference decisions with cc-memory tag', () => {
    const result = store.importAllCCMemories();

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.totalScanned).toBe(3);

    const ledger = store.getAllDecisions();
    expect(ledger.length).toBe(3);
    for (const d of ledger) {
      expect(d.lifecycle).toBe('reference');
      expect(d.tags).toContain('cc-memory');
    }

    // _memoryImports map populated with all three paths
    const importsMap = store.data._memoryImports;
    expect(Object.keys(importsMap).length).toBe(3);
    for (const key of Object.keys(importsMap)) {
      expect(importsMap[key]).toHaveProperty('decisionId');
      expect(importsMap[key]).toHaveProperty('mtime');
    }
  });

  it('re-run is idempotent — second call skips all three', () => {
    store.importAllCCMemories();  // first run
    const result = store.importAllCCMemories();  // second run

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.updated).toBe(0);

    // Ledger still has exactly 3 — no dupes
    expect(store.getAllDecisions().length).toBe(3);
  });

  it('mtime drift triggers update-in-place, not a duplicate', () => {
    store.importAllCCMemories();  // first run

    // Modify one memory file + bump its mtime artificially
    const memoryPath = seedMemory('C--Projects', 'feedback_fuel_display.md',
      `---\nname: fuel_display_static\ndescription: UPDATED description after drift\ntype: feedback\n---\n\nNew body content.\n`,
      Date.now() / 1000 + 60  // future mtime so it differs from initial
    );

    const result = store.importAllCCMemories();
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.imported).toBe(0);

    // No duplicate decisions
    expect(store.getAllDecisions().length).toBe(3);

    // The updated decision reflects new content
    const importsMap = store.data._memoryImports;
    const decisionId = importsMap[memoryPath].decisionId;
    const decision = store.getDecisionById(decisionId);
    expect(decision.context).toContain('UPDATED description after drift');
  });

  it('dry_run reports counts + samples without writing', () => {
    const result = store.importAllCCMemories({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.imported).toBe(3);
    expect(result.samples.length).toBeGreaterThan(0);

    // Nothing actually written
    expect(store.getAllDecisions().length).toBe(0);
    expect(Object.keys(store.data._memoryImports || {}).length).toBe(0);
  });

  it('force=true re-imports already-tracked memories as updates', () => {
    store.importAllCCMemories();  // first run — all fresh
    const result = store.importAllCCMemories({ force: true });

    // No new imports, all existing get refreshed
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(3);
    expect(result.skipped).toBe(0);

    // Still exactly 3 decisions — not 6
    expect(store.getAllDecisions().length).toBe(3);
  });

  it('project filter narrows to matching inferred project', () => {
    const result = store.importAllCCMemories({ project: 'Nexus' });

    // Only the two C--Projects memories (inferred as Nexus) get imported.
    expect(result.imported).toBe(2);
    expect(result.totalScanned).toBe(2);

    const ledger = store.getAllDecisions();
    expect(ledger.length).toBe(2);
    for (const d of ledger) {
      expect(d.project).toBe('Nexus');
    }
  });

  it('does not manufacture auto-link graph edges for imports', () => {
    const edgesBefore = store.getEdgeCount();
    store.importAllCCMemories();
    const edgesAfter = store.getEdgeCount();

    // Keyword + semantic auto-link is suppressed via autoLink:false in recordDecision.
    // Edge count stays put — imports don't spam the graph with noisy `related` edges.
    expect(edgesAfter).toBe(edgesBefore);
  });

  it('references are excluded from getActiveDecisions but visible via getAllDecisions', () => {
    store.importAllCCMemories();
    expect(store.getAllDecisions().length).toBe(3);
    // References are opt-in — not surfaced on active decision queries.
    expect(store.getActiveDecisions().length).toBe(0);
  });
});
