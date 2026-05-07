/**
 * Tests for v4.7.3 #310 — auto-suggest contradiction poller.
 *
 * Focuses on the testable seams:
 *   - shouldRunContradictionScan() — pure helper, the skip-if-recent guard
 *   - runContradictionScan() — full flow with the fetch stack stubbed via
 *     globalThis.fetch override so we don't need a real LM Studio or Express
 *     server running. Verifies:
 *       · skip when last scan < minIntervalMs ago
 *       · skip when start endpoint signals overseer-down
 *       · completed path: persists scheduled scan + emits notification toast
 *
 * The end-to-end integration (real Express + real LM Studio) is covered by the
 * existing manual /api/overseer/scan-contradictions tests in routes.test.ts —
 * we don't reproduce that here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

const TMP_ROOT = join(os.tmpdir(), `nexus-contradiction-poller-${Date.now()}`);
const DB_PATH = join(TMP_ROOT, 'nexus.json');

beforeEach(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
  process.env.NEXUS_DB_PATH = DB_PATH;
  process.env.NEXUS_DISABLE_WATCHER = '1';
});

afterEach(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const { shouldRunContradictionScan, runContradictionScan } = await import('../server/watchers/contradictionPoller.ts');
const { NexusStore } = await import('../server/db/store.ts');

// ──────────────────────────────────────────────────────────
// Pure helper: skip-if-recent guard
// ──────────────────────────────────────────────────────────

describe('shouldRunContradictionScan', () => {
  const now = new Date('2026-05-07T12:00:00Z');
  const minInterval = 23 * 3600000;

  it('runs when no prior scan exists', () => {
    expect(shouldRunContradictionScan(undefined, now, minInterval)).toBe(true);
  });

  it('skips when last scan was 1h ago', () => {
    const oneHourAgo = new Date(now.getTime() - 1 * 3600000).toISOString();
    expect(shouldRunContradictionScan({ type: 'contradiction', timestamp: oneHourAgo, result: {} }, now, minInterval)).toBe(false);
  });

  it('skips when last scan was exactly minIntervalMs - 1ms ago', () => {
    const t = new Date(now.getTime() - minInterval + 1).toISOString();
    expect(shouldRunContradictionScan({ type: 'contradiction', timestamp: t, result: {} }, now, minInterval)).toBe(false);
  });

  it('runs when last scan was exactly minIntervalMs ago', () => {
    const t = new Date(now.getTime() - minInterval).toISOString();
    expect(shouldRunContradictionScan({ type: 'contradiction', timestamp: t, result: {} }, now, minInterval)).toBe(true);
  });

  it('runs when last scan was 25h ago', () => {
    const t = new Date(now.getTime() - 25 * 3600000).toISOString();
    expect(shouldRunContradictionScan({ type: 'contradiction', timestamp: t, result: {} }, now, minInterval)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// runContradictionScan — full flow with fetch stubbed
// ──────────────────────────────────────────────────────────

function makeStore() {
  return new NexusStore();
}

describe('runContradictionScan', () => {
  it('returns skipped-recent when a scan was logged < 23h ago', async () => {
    const store = makeStore();
    store.addScheduledScan({
      type: 'contradiction',
      timestamp: new Date(Date.now() - 1 * 3600000).toISOString(),
      result: { newSuggestions: 0, totalEvaluated: 0, durationMs: 0 },
    });

    const broadcastCalls: unknown[] = [];
    const result = await runContradictionScan({
      store,
      port: 9999,
      broadcast: (m) => broadcastCalls.push(m),
      maxPairs: 20,
    });

    expect(result.status).toBe('skipped-recent');
    // Guarded skip should NOT add a new scheduled-scan record
    expect(store.getScheduledScans('contradiction', 10).length).toBe(1);
    expect(broadcastCalls).toEqual([]);
  });

  it('returns skipped-overseer-down when start endpoint signals no AI', async () => {
    const store = makeStore();

    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify({ error: 'No local AI available. Install LM Studio.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await runContradictionScan({
      store,
      port: 9999,
      broadcast: () => {},
      maxPairs: 20,
    });

    expect(result.status).toBe('skipped-overseer-down');
    // No scheduled scan persisted on a skipped run
    expect(store.getScheduledScans('contradiction', 10).length).toBe(0);
  });

  it('completed path: persists scan, broadcasts toast on new suggestions', async () => {
    const store = makeStore();

    // Seed a decision so the route has eligible data (and so eligible.length>=2 in the
    // real route path; the mock fetch bypasses that, but keep the store realistic).
    store.recordDecision({ decision: 'Use Postgres for prod', project: 'Nexus' });
    store.recordDecision({ decision: 'Reject Postgres — SQLite is simpler', project: 'Nexus' });

    // Simulate the route having added a suggestion DURING the scan: we pre-add 1
    // suggestion AFTER the start fetch (i.e. after the start POST resolves) so the
    // "after - before" delta = 1. We do this by advancing the suggestion store on
    // the start-call (the mock fetch handler itself).
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/overseer/scan-contradictions') && init?.method === 'POST') {
        // The real route persists suggestions inside its async work. Simulate
        // that here so afterCount > beforeCount when the poller compares.
        store.addSuggestedContradiction({
          from_id: 1,
          to_id: 2,
          similarity: 0.78,
          confidence: 0.72,
          reason: 'These pick opposite database engines for the same workload',
        });
        return new Response(JSON.stringify({ taskId: 'scan-test-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/overseer/ask/result/scan-test-123')) {
        // Return a 'done' poll with a parseable answer so the totalEvaluated branch hits.
        return new Response(JSON.stringify({
          status: 'done',
          answer: JSON.stringify({
            suggestions: [
              { from_id: 1, to_id: 2, is_contradiction: true, confidence: 0.72, reason: 'opposite picks' },
            ],
          }),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const broadcastCalls: Array<{ type?: string; payload?: unknown }> = [];
    const result = await runContradictionScan({
      store,
      port: 9999,
      broadcast: (m) => broadcastCalls.push(m as { type?: string; payload?: unknown }),
      maxPairs: 20,
      pollIntervalMs: 1,             // make the test fast
      maxPollAttempts: 3,
    });

    expect(result.status).toBe('completed');
    expect(result.newSuggestions).toBe(1);
    expect(result.totalEvaluated).toBe(1);

    // Persisted scheduled-scan record
    const scans = store.getScheduledScans('contradiction', 10);
    expect(scans.length).toBe(1);
    expect((scans[0].result as { newSuggestions: number }).newSuggestions).toBe(1);

    // Toast broadcast
    const toast = broadcastCalls.find((c) => c.type === 'notification');
    expect(toast).toBeDefined();
    const payload = toast?.payload as { title?: string; message?: string };
    expect(payload?.title).toMatch(/Contradiction Scan/i);
    expect(payload?.message).toMatch(/1 new contradiction/i);
  });

  it('completed path with zero new suggestions: no toast', async () => {
    const store = makeStore();

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/overseer/scan-contradictions') && init?.method === 'POST') {
        // Don't add any suggestion this time — beforeCount === afterCount.
        return new Response(JSON.stringify({ taskId: 'scan-empty-456' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/overseer/ask/result/scan-empty-456')) {
        return new Response(JSON.stringify({
          status: 'done',
          answer: JSON.stringify({ suggestions: [] }),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const broadcastCalls: Array<{ type?: string }> = [];
    const result = await runContradictionScan({
      store,
      port: 9999,
      broadcast: (m) => broadcastCalls.push(m as { type?: string }),
      maxPairs: 20,
      pollIntervalMs: 1,
      maxPollAttempts: 3,
    });

    expect(result.status).toBe('completed');
    expect(result.newSuggestions).toBe(0);

    // Scheduled scan IS still recorded (we ran a real scan, just no hits)
    const scans = store.getScheduledScans('contradiction', 10);
    expect(scans.length).toBe(1);

    // But NO toast — we don't badger the user when there's nothing to act on
    const toast = broadcastCalls.find((c) => c.type === 'notification');
    expect(toast).toBeUndefined();
  });
});
