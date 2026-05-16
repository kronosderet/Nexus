/**
 * Regression tests for CC lifecycle hooks (cli/hooks/ + plugin/server/hooks/).
 *
 * v4.9.0 #725 — guards against the canonical-Thought-shape regression where
 * session-stop.js wrote `created_at` instead of `pushed_at`. session-start.js
 * sorts the Thought Stack by `pushed_at`, so the bad shape made handoff thoughts
 * NaN-sort to the bottom of the LIFO and never resurface. These tests pin the
 * write shape to the canonical Thought interface in server/types.ts.
 *
 * Hooks run as standalone Node subprocesses (no server required), so the test
 * spawns them with execFileSync and asserts the resulting nexus.json shape.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_HOOK_PATH = join(process.cwd(), 'cli', 'hooks', 'session-stop.js');
const PLUGIN_HOOK_PATH = join(process.cwd(), 'plugin', 'server', 'hooks', 'session-stop.js');

interface ThoughtShape {
  id: number;
  text: string;
  context: string;
  project: string;
  pushed_at?: string;
  popped_at: string | null;
  status: 'active' | 'resolved' | 'abandoned';
  related_task_id: number | null;
  // Regression guard — this field MUST NOT appear; older hooks wrote it.
  created_at?: string;
}

function makeFixture(): { tmpDir: string; dbPath: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'nexus-hooks-'));
  const dbPath = join(tmpDir, 'nexus.json');
  const seed = {
    tasks: [
      { id: 42, title: 'In-progress task', description: '', status: 'in_progress', priority: 1, sort_order: 0, linked_files: '[]', project: 'Nexus', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ],
    activity: [],
    sessions: [],
    usage: [],
    gpu_history: [],
    scratchpads: [],
    bookmarks: [],
    ledger: [],
    graph_edges: [],
    advice: [],
    thoughts: [],
  };
  writeFileSync(dbPath, JSON.stringify(seed, null, 2));
  return { tmpDir, dbPath };
}

function runHook(hookPath: string, dbPath: string): void {
  execFileSync('node', [hookPath], {
    env: { ...process.env, NEXUS_DB_PATH: dbPath, NEXUS_HOME: dbPath + '.home' },
    cwd: process.cwd(),
    timeout: 10000,
    stdio: 'pipe',
  });
}

function readDb(dbPath: string): { thoughts: ThoughtShape[]; activity: unknown[] } {
  return JSON.parse(readFileSync(dbPath, 'utf-8'));
}

// v4.9.0 #726 — plugin/server/hooks/ kept drifting behind cli/hooks/ between
// releases (prompt-submit reverted to the pre-v4.3 noise pattern, session-start
// lost the v4.7.6 Chapter Narrator + project-scoped tasks/thoughts). The fix
// is byte-identical content; this test guards it.
describe('cli/hooks ↔ plugin/server/hooks parity', () => {
  const HOOK_NAMES = ['session-stop.js', 'prompt-submit.js', 'session-start.js'];
  for (const name of HOOK_NAMES) {
    it(`${name} is byte-identical between cli and plugin`, () => {
      const cliPath = join(process.cwd(), 'cli', 'hooks', name);
      const pluginPath = join(process.cwd(), 'plugin', 'server', 'hooks', name);
      expect(existsSync(cliPath), `missing ${cliPath}`).toBe(true);
      expect(existsSync(pluginPath), `missing ${pluginPath}`).toBe(true);
      const cli = readFileSync(cliPath, 'utf-8');
      const plugin = readFileSync(pluginPath, 'utf-8');
      expect(plugin).toBe(cli);
    });
  }
});

describe.each([
  ['cli/hooks/session-stop.js', CLI_HOOK_PATH],
  ['plugin/server/hooks/session-stop.js', PLUGIN_HOOK_PATH],
])('%s — handoff Thought shape', (_label, hookPath) => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    if (!existsSync(hookPath)) throw new Error(`Hook not found: ${hookPath}`);
    ({ tmpDir, dbPath } = makeFixture());
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes pushed_at on the new handoff thought (NOT created_at)', () => {
    runHook(hookPath, dbPath);
    const db = readDb(dbPath);
    expect(db.thoughts).toHaveLength(1);
    const t = db.thoughts[0];
    expect(typeof t.pushed_at).toBe('string');
    expect(t.pushed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The regression we're guarding against:
    expect(t.created_at).toBeUndefined();
  });

  it('writes the canonical Thought shape (popped_at:null, status:active, related_task_id)', () => {
    runHook(hookPath, dbPath);
    const t = readDb(dbPath).thoughts[0];
    expect(t.popped_at).toBeNull();
    expect(t.status).toBe('active');
    expect(t.related_task_id).toBe(42); // linked to the in_progress task
    expect(t.text).toContain('#42');
  });

  it('survives the session-start sort — new thought lands at top of LIFO, not NaN-buried', () => {
    runHook(hookPath, dbPath);
    const thoughts = readDb(dbPath).thoughts.filter((t) => t.status === 'active');
    // Same sort session-start.js uses (line 166): newest pushed_at first.
    const sorted = [...thoughts].sort(
      (a, b) => new Date(b.pushed_at!).getTime() - new Date(a.pushed_at!).getTime(),
    );
    expect(sorted[0]?.id).toBe(thoughts[0].id);
    // No NaN — the comparator must produce a real number.
    expect(Number.isFinite(new Date(sorted[0]!.pushed_at!).getTime())).toBe(true);
  });

  it('logs a session-ended activity entry', () => {
    runHook(hookPath, dbPath);
    const db = readDb(dbPath);
    expect(db.activity).toHaveLength(1);
    const a = db.activity[0] as { type: string; message: string };
    expect(a.type).toBe('system');
    expect(a.message).toMatch(/Session ended/i);
  });
});
