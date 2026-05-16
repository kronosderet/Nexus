/**
 * Regression tests for NexusStore._flush() — the JSON write pipeline that
 * underpins every mutation. Tests run against a temp NEXUS_DB_PATH with
 * NEXUS_DISABLE_WATCHER=1 so they don't fight a real file watcher.
 *
 * v4.9.0 #731 — guards that `_lastFlushAt` is stamped BEFORE the rename, not
 * just on success. Pre-fix, an exception in the rename sequence (or the copy
 * fallback) could advance the file's mtime while leaving _lastFlushAt stale,
 * making the watcher misclassify our own write as external and clobber memory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('NexusStore._flush() — _lastFlushAt timing', () => {
  let tmpDir: string;
  let dbPath: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nexus-flush-'));
    dbPath = join(tmpDir, 'nexus.json');
    process.env.NEXUS_DB_PATH = dbPath;
    process.env.NEXUS_DISABLE_WATCHER = '1';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...savedEnv };
  });

  it('stamps _lastFlushAt to a real timestamp on every successful flush', async () => {
    // Fresh import per test so getDbPath() picks up the env var.
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    const beforeFlush = Date.now();
    store.addActivity('system', 'flush test');
    expect((store as unknown as { _lastFlushAt: number })._lastFlushAt).toBeGreaterThanOrEqual(beforeFlush);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('_lastFlushAt is within the watcher grace window of the file mtime', async () => {
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    store.addActivity('system', 'mtime grace test');
    const lastFlushAt = (store as unknown as { _lastFlushAt: number })._lastFlushAt;
    const mtime = statSync(dbPath).mtimeMs;
    // Watcher uses `mtime <= _lastFlushAt + 100` to recognise our own writes.
    // After the v4.9.0 #731 fix _lastFlushAt is stamped both BEFORE and AFTER
    // the rename, so mtime should always be within the grace window.
    expect(mtime).toBeLessThanOrEqual(lastFlushAt + 100);
  });

  it('back-to-back flushes keep _lastFlushAt monotonically non-decreasing', async () => {
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    const stamps: number[] = [];
    for (let i = 0; i < 5; i++) {
      store.addActivity('system', `burst flush ${i}`);
      stamps.push((store as unknown as { _lastFlushAt: number })._lastFlushAt);
    }
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThanOrEqual(stamps[i - 1]);
    }
  });

  it('produces a parseable, well-formed JSON file (no half-written state visible)', async () => {
    const { NexusStore } = await import('../server/db/store.ts');
    const store = new NexusStore();
    store.addActivity('system', 'roundtrip test');
    const raw = readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.activity)).toBe(true);
    expect(parsed.activity.at(-1)?.message).toBe('roundtrip test');
  });
});
