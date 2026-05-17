/**
 * v4.9.1 #737 — regression test for the `withBatchedFlush` coalescing pattern.
 *
 * Pre-fix `recordDecision → _autoLinkDecision → addEdge × N` chained one
 * `_flush()` per mutation, producing 1 + min(5, N) full-store JSON
 * serialisations per recordDecision. Now the cascade is wrapped in
 * `withBatchedFlush(() => …)` which coalesces all nested `_flush()` calls
 * into a single write at exit.
 *
 * The test instruments `_flush` and counts invocations across a controlled
 * `recordDecision` that triggers auto-link edges; pre-fix this would be
 * `≥2` (decision + one or more edges), post-fix exactly `1`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('NexusStore.withBatchedFlush (v4.9.1 #737)', () => {
  let tmpDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nexus-flush-batch-'));
    process.env.NEXUS_DB_PATH = join(tmpDir, 'nexus.json');
    process.env.NEXUS_DISABLE_WATCHER = '1';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('recordDecision with auto-link produces exactly one disk write, regardless of edge count', async () => {
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    // Seed 5 decisions that all share enough keywords to trigger auto-link
    // edges (>= 30% keyword overlap with the new decision).
    for (let i = 0; i < 5; i++) {
      store.recordDecision({
        decision: `Use PostgreSQL for the events table — concurrent writes need transactional safety #${i}`,
        project: 'Nexus',
        autoLink: false,
      });
    }
    const before = store._realFlushCount;
    // The auto-link in this recordDecision call should fire up to 5 addEdge
    // calls. Pre-fix every one of them flushed; now they're batched into one.
    store.recordDecision({
      decision: 'Use PostgreSQL for the audit log too — same transactional reasoning applies',
      project: 'Nexus',
      autoLink: true,
    });
    expect(store._realFlushCount - before).toBe(1);
  });

  it('withBatchedFlush always writes to disk on exit even when fn throws', async () => {
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    const before = store._realFlushCount;
    expect(() => store.withBatchedFlush(() => {
      store.addActivity('system', 'batched activity');
      throw new Error('simulated failure');
    })).toThrow('simulated failure');
    // The exit flush still fires so we don't leave dirty in-memory state.
    expect(store._realFlushCount - before).toBe(1);
  });

  it('nested withBatchedFlush is re-entrant — inner block does not write to disk', async () => {
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    const before = store._realFlushCount;
    store.withBatchedFlush(() => {
      store.addActivity('system', 'outer');
      store.withBatchedFlush(() => {
        store.addActivity('system', 'inner');
      });
    });
    // Two mutations, one disk write.
    expect(store._realFlushCount - before).toBe(1);
  });
});
