/**
 * v4.7.3 #310 — Auto-suggest contradiction scanner.
 *
 * The v4.4.8 #307 contradiction scan engine (embedding shortlist + Overseer
 * classification) shipped as a manual button in the Conflicts tab. This poller
 * runs the same scan automatically on a 24h cadence so suggestions accumulate
 * without the user having to remember to click.
 *
 * Lives in dashboard.ts only — the standalone MCPB process has no long-lived
 * loop. Users running the dashboard get auto-scans for free; standalone-only
 * users still have the manual button + the next dashboard run will catch up.
 *
 * Cadence + budget:
 *   - 24h interval (default — Captain pick) with a "skip if last < 23h" guard
 *     so a dashboard restart doesn't immediately re-run.
 *   - 20 max_pairs (default — same as the manual scan).
 *   - Skipped silently if Overseer is unavailable (LM Studio down). The scan
 *     re-attempts on the next interval; no error toast.
 *
 * Surfacing:
 *   - addScheduledScan({ type: 'contradiction', ... }) — picked up by /api/scans
 *     and the brief composer.
 *   - Broadcast `notification` toast when newSuggestions > 0 so the dashboard
 *     surfaces them live without a refresh.
 */

import type { NexusStore } from '../db/store.ts';
import type { ScheduledScan } from '../types.js';

type BroadcastFn = (data: unknown) => void;

export interface ContradictionScanOptions {
  store: NexusStore;
  port: number;
  broadcast: BroadcastFn;
  maxPairs?: number;
  minIntervalMs?: number;        // skip-if-recent guard
  pollIntervalMs?: number;       // poll cadence inside a single scan
  maxPollAttempts?: number;      // hard cap on poll loops
}

export interface ContradictionScanResult {
  status: 'completed' | 'skipped-recent' | 'skipped-overseer-down' | 'error';
  newSuggestions?: number;
  totalEvaluated?: number;
  error?: string;
  durationMs?: number;
}

/**
 * Pure decision helper: should the poller run a fresh scan now?
 * Exported for unit tests so we don't have to mock fetch.
 */
export function shouldRunContradictionScan(
  lastScan: ScheduledScan | undefined,
  now: Date,
  minIntervalMs: number,
): boolean {
  if (!lastScan) return true;
  const elapsed = now.getTime() - new Date(lastScan.timestamp).getTime();
  return elapsed >= minIntervalMs;
}

/**
 * Run one auto-scan. Mirrors the manual `/api/overseer/scan-contradictions`
 * flow: POST to start (returns taskId), then poll `/api/overseer/ask/result/`
 * until status is 'done' or 'error'.
 */
export async function runContradictionScan(
  opts: ContradictionScanOptions,
): Promise<ContradictionScanResult> {
  const {
    store,
    port,
    broadcast,
    maxPairs = 20,
    minIntervalMs = 23 * 3600000,  // skip if last < 23h ago
    pollIntervalMs = 2000,
    maxPollAttempts = 90,           // 90 * 2s = 3min hard cap
  } = opts;

  const startedAt = Date.now();

  // (1) Skip-if-recent guard. Reuses the existing _scheduledScans store.
  const recent = store.getScheduledScans('contradiction', 1)[0];
  if (!shouldRunContradictionScan(recent, new Date(), minIntervalMs)) {
    return { status: 'skipped-recent' };
  }

  // (2) Snapshot pending suggestions before the scan so we can compute the
  // delta (= new suggestions added by THIS scan, not the cumulative total).
  const beforeCount = store.getActiveSuggestedContradictions().length;

  // (3) POST to start. Endpoint returns { taskId } or { error } if Overseer
  // is unavailable / no eligible decisions / etc.
  let taskId: string | undefined;
  try {
    const startRes = await fetch(`http://localhost:${port}/api/overseer/scan-contradictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_pairs: maxPairs }),
    });
    if (!startRes.ok) {
      return { status: 'error', error: `start ${startRes.status}` };
    }
    const startData = (await startRes.json()) as { taskId?: string; error?: string };
    if (startData.error) {
      // Most common: "No local AI available." — treat as "skipped" not error.
      const isOverseerDown = /no local ai|overseer/i.test(startData.error);
      return isOverseerDown
        ? { status: 'skipped-overseer-down' }
        : { status: 'error', error: startData.error };
    }
    taskId = startData.taskId;
    if (!taskId) return { status: 'error', error: 'no taskId returned' };
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  }

  // (4) Poll for completion.
  let result: { status?: string; answer?: string; error?: string } = {};
  for (let i = 0; i < maxPollAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const pollRes = await fetch(`http://localhost:${port}/api/overseer/ask/result/${taskId}`);
      if (!pollRes.ok) continue;
      result = (await pollRes.json()) as typeof result;
      if (result.status === 'done' || result.status === 'error') break;
    } catch {
      // transient — keep polling
    }
  }

  if (result.status !== 'done') {
    return {
      status: 'error',
      error: result.error || `poll timeout after ${maxPollAttempts * pollIntervalMs}ms`,
    };
  }

  // (5) Compute delta. The route already persisted via store.addSuggestedContradiction
  // for every accepted pair; we just compare counts.
  const afterCount = store.getActiveSuggestedContradictions().length;
  const newSuggestions = Math.max(0, afterCount - beforeCount);

  // Number of pairs the Overseer evaluated (regardless of verdict). Useful in
  // the activity log so a "0 new" outcome doesn't read as "scan didn't happen".
  let totalEvaluated = 0;
  try {
    const parsed = JSON.parse(result.answer || '{}') as { suggestions?: unknown[] };
    if (Array.isArray(parsed.suggestions)) totalEvaluated = parsed.suggestions.length;
  } catch {
    // Tolerate malformed Overseer JSON — totalEvaluated stays 0
  }

  const durationMs = Date.now() - startedAt;

  // (6) Persist the scheduled-scan record. Same shape as risk/digest scans.
  store.addScheduledScan({
    type: 'contradiction',
    timestamp: new Date().toISOString(),
    result: { newSuggestions, totalEvaluated, durationMs },
  });

  // (7) Activity log + toast on new suggestions.
  if (newSuggestions > 0) {
    store.addActivity(
      'overseer_scan',
      `Auto-scan flagged ${newSuggestions} new contradiction suggestion${newSuggestions === 1 ? '' : 's'} (evaluated ${totalEvaluated} pair${totalEvaluated === 1 ? '' : 's'})`,
    );
    broadcast({
      type: 'notification',
      payload: {
        title: 'Overseer Contradiction Scan',
        message: `${newSuggestions} new contradiction suggestion${newSuggestions === 1 ? '' : 's'} ready to review in the Conflicts tab.`,
      },
    });
  }

  return { status: 'completed', newSuggestions, totalEvaluated, durationMs };
}

/**
 * setInterval wrapper that runs the scan periodically. Returns the interval
 * handle so dashboard.ts can clear it on shutdown if needed (matches the
 * v4.3.5 C3 pattern of capturing watcher handles for SIGINT cleanup).
 */
export function startContradictionPoller(
  opts: ContradictionScanOptions & { intervalMs?: number },
): NodeJS.Timeout {
  const intervalMs = opts.intervalMs ?? 24 * 3600000;  // 24h default

  const tick = async () => {
    try {
      const r = await runContradictionScan(opts);
      if (r.status === 'completed') {
        console.log(`  ◈ Auto contradiction scan: ${r.newSuggestions} new (evaluated ${r.totalEvaluated} pair${r.totalEvaluated === 1 ? '' : 's'}, ${r.durationMs}ms)`);
      } else if (r.status === 'error') {
        console.warn(`  ◈ Auto contradiction scan failed: ${r.error}`);
      }
      // skipped-recent / skipped-overseer-down are silent (expected on most ticks)
    } catch (e) {
      console.warn(`  ◈ Auto contradiction scan crashed:`, (e as Error).message);
    }
  };

  // Initial run on startup, but delayed 60s so the server is fully up + LM
  // Studio detection has settled. The skip-if-recent guard prevents this from
  // double-firing on a quick restart.
  setTimeout(tick, 60000);

  console.log(`  ◈ Auto contradiction poller active. Scanning every ${Math.round(intervalMs / 3600000)}h.`);
  return setInterval(tick, intervalMs);
}
