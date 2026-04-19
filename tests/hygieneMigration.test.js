/**
 * Tests for v4.3.9 H1 — combined hygiene migration.
 *
 * Covers:
 *   #222 Encoding mojibake scrub (U+FFFD -> em-dash) in task titles/descriptions + decision text/context
 *   #245 Blank-project normalization (empty/whitespace -> "general") across sessions/tasks/decisions
 *   #273 Case/alias normalization (DIREWOLF -> direwolf, Projects -> general)
 *   Idempotency: second construction is a no-op
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Hermetic: isolated nexus.json per test
const TMP_ROOT = join(os.tmpdir(), `nexus-hygiene-${Date.now()}`);
const DB_PATH = join(TMP_ROOT, 'nexus.json');
process.env.NEXUS_DB_PATH = DB_PATH;

mkdirSync(TMP_ROOT, { recursive: true });

// Import AFTER env var is set
const { NexusStore } = await import('../server/db/store.ts');

afterAll(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});

// Seed a store with dirty data, then let migration run on construction.
function seedAndConstruct(seed) {
  writeFileSync(DB_PATH, JSON.stringify(seed));
  return new NexusStore();
}

beforeEach(() => {
  // Wipe between tests so v4.3.9-H1 runs fresh
  try { rmSync(DB_PATH, { force: true }); } catch {}
});

describe('v4.3.9 H1 hygiene migration', () => {
  it('scrubs U+FFFD mojibake from task titles and descriptions', () => {
    const store = seedAndConstruct({
      tasks: [
        { id: 1, title: 'AUDIT: MYE 17% scene coverage \uFFFD fix during P3B', description: 'See \uFFFD notes', status: 'backlog', priority: 0, sort_order: 1, linked_files: '[]', project: 'Shadowrun', created_at: '2026-04-01', updated_at: '2026-04-01' },
        { id: 2, title: 'clean title', description: 'clean desc', status: 'backlog', priority: 0, sort_order: 2, linked_files: '[]', project: 'Nexus', created_at: '2026-04-01', updated_at: '2026-04-01' },
      ],
      activity: [], sessions: [], usage: [], gpu_history: [], scratchpads: [], bookmarks: [], ledger: [], graph_edges: [], advice: [], thoughts: [],
    });
    const task1 = store.getAllTasks().find(t => t.id === 1);
    expect(task1.title).not.toContain('\uFFFD');
    expect(task1.title).toContain('—'); // em-dash substituted
    expect(task1.description).not.toContain('\uFFFD');
    // Clean task is untouched
    expect(store.getAllTasks().find(t => t.id === 2).title).toBe('clean title');
  });

  it('scrubs mojibake from decision.decision + decision.context', () => {
    const store = seedAndConstruct({
      tasks: [], activity: [], sessions: [], usage: [], gpu_history: [], scratchpads: [], bookmarks: [],
      ledger: [
        { id: 1, decision: 'Use Postgres \uFFFD not SQLite', context: 'Decided \uFFFD because of concurrency', project: 'Nexus', alternatives: [], tags: [], created_at: '2026-04-01', lifecycle: 'active' },
      ],
      graph_edges: [], advice: [], thoughts: [],
    });
    const d = store.getAllDecisions()[0];
    expect(d.decision).not.toContain('\uFFFD');
    expect(d.decision).toContain('—');
    expect(d.context).not.toContain('\uFFFD');
  });

  it('normalizes blank project to "general" on sessions + decisions (task blanks handled by v4.3.5-C1)', () => {
    // Note on ordering: v4.3.5-C1 migration backfills blank-project TASKS via its own
    // heuristic (title keyword match, defaulting to "Nexus") BEFORE H1 runs. That's fine —
    // C1 owns task-project hygiene. H1 extends the safety net to SESSIONS and DECISIONS
    // which C1 doesn't touch (this is what caused the blank-project ": 10d" Fleet row).
    const store = seedAndConstruct({
      tasks: [],
      activity: [],
      sessions: [
        { id: 1, project: '', summary: 'blank', decisions: [], blockers: [], files_touched: [], tags: [], created_at: '2026-04-01' },
        { id: 2, project: '   ', summary: 'whitespace', decisions: [], blockers: [], files_touched: [], tags: [], created_at: '2026-04-01' },
      ],
      usage: [], gpu_history: [], scratchpads: [], bookmarks: [],
      ledger: [
        { id: 1, decision: 'x', context: '', project: '', alternatives: [], tags: [], created_at: '2026-04-01', lifecycle: 'active' },
      ],
      graph_edges: [], advice: [], thoughts: [],
    });
    const sessions = store.getSessions();
    expect(sessions.every(s => s.project === 'general')).toBe(true);
    expect(store.getAllDecisions()[0].project).toBe('general');
  });

  it('normalizes DIREWOLF to direwolf and Projects to general', () => {
    const store = seedAndConstruct({
      tasks: [
        { id: 1, title: 't', description: '', status: 'backlog', priority: 0, sort_order: 1, linked_files: '[]', project: 'DIREWOLF', created_at: '2026-04-01', updated_at: '2026-04-01' },
        { id: 2, title: 't2', description: '', status: 'backlog', priority: 0, sort_order: 2, linked_files: '[]', project: 'Projects', created_at: '2026-04-01', updated_at: '2026-04-01' },
        { id: 3, title: 't3', description: '', status: 'backlog', priority: 0, sort_order: 3, linked_files: '[]', project: 'Nexus', created_at: '2026-04-01', updated_at: '2026-04-01' },
      ],
      activity: [],
      sessions: [
        { id: 1, project: 'DIREWOLF', summary: 's', decisions: [], blockers: [], files_touched: [], tags: [], created_at: '2026-04-01' },
      ],
      usage: [], gpu_history: [], scratchpads: [], bookmarks: [],
      ledger: [
        { id: 1, decision: 'x', context: '', project: 'Projects', alternatives: [], tags: [], created_at: '2026-04-01', lifecycle: 'active' },
      ],
      graph_edges: [], advice: [], thoughts: [],
    });
    const tasks = store.getAllTasks();
    expect(tasks.find(t => t.id === 1).project).toBe('direwolf');
    expect(tasks.find(t => t.id === 2).project).toBe('general');
    expect(tasks.find(t => t.id === 3).project).toBe('Nexus'); // preserved
    expect(store.getSessions()[0].project).toBe('direwolf');
    expect(store.getAllDecisions()[0].project).toBe('general');
  });

  it('is idempotent: second construction runs no-op and leaves data unchanged', () => {
    const first = seedAndConstruct({
      tasks: [{ id: 1, title: 'foo \uFFFD bar', description: '', status: 'backlog', priority: 0, sort_order: 1, linked_files: '[]', project: 'DIREWOLF', created_at: '2026-04-01', updated_at: '2026-04-01' }],
      activity: [], sessions: [], usage: [], gpu_history: [], scratchpads: [], bookmarks: [], ledger: [], graph_edges: [], advice: [], thoughts: [],
    });
    const firstTitle = first.getAllTasks()[0].title;
    const firstProject = first.getAllTasks()[0].project;
    expect(firstTitle).toContain('—');
    expect(firstProject).toBe('direwolf');
    // Second construction reads the already-migrated data — should detect applied marker and skip.
    const second = new NexusStore();
    expect(second.getAllTasks()[0].title).toBe(firstTitle);
    expect(second.getAllTasks()[0].project).toBe(firstProject);
    expect(second.data._appliedMigrations['v4.3.9-H1']).toBeDefined();
  });
});
