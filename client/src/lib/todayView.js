/**
 * Pure derivation logic for the Today fusion view (v4.7.4 #240).
 *
 * The Command tab's TodayView fuses four signals — fuel, current in-progress
 * task, recent activity, top risk — into a single dense header card. The
 * presentation is in `client/src/modules/command/TodayView.jsx`; everything
 * about WHAT to show lives here so it's testable in node-only Vitest without
 * jsdom or @testing-library/react.
 *
 * Inputs are the same shapes the rest of Command.jsx already consumes:
 *   - fuel:           the /api/estimator response (reported / estimated /
 *                     session.minutesRemaining)
 *   - inProgress:     tasks with status === 'in_progress'
 *   - recentActivity: descending by created_at, latest first (already capped
 *                     to ~20 by the parent)
 *   - risks:          /api/overseer/risks → { level, category, message }
 *
 * Output is a normalized {fuel, now, pulse, signal} block ready to render.
 */

// v4.9.1 #751 — formatTimeAgo lives in lib/time.js as part of the unified
// relative-time helpers. Re-exported here for backwards-compat with the
// existing tests/todayView.test.js + the TodayView module's existing import.
// Imported locally too so the deriveTodayState() body below can keep calling it.
import { formatTimeAgo } from './time.js';
export { formatTimeAgo };

const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

/**
 * Color/severity bucket for a fuel percentage.
 * Mirrors the existing FuelChip thresholds in Command.jsx (≤15 critical,
 * ≤40 low) so the TodayView reads the same semantically.
 */
export function fuelPressure(pct) {
  if (pct == null) return null;
  if (pct <= 15) return 'critical';
  if (pct <= 40) return 'low';
  return 'normal';
}

/**
 * Compact runway label. Minutes for <60min, hours otherwise.
 * Returns null when the input is null/undefined so the renderer can omit
 * the line entirely.
 */
export function formatRunway(minutes) {
  if (minutes == null) return null;
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  if (h < 24) return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Pick the highest-severity risk from a list. Critical > warning > info.
 * Returns null on empty input.
 */
export function topRisk(risks) {
  if (!Array.isArray(risks) || risks.length === 0) return null;
  const ranked = { critical: 3, warning: 2, info: 1 };
  let best = risks[0];
  let bestScore = ranked[best?.level] || 0;
  for (let i = 1; i < risks.length; i++) {
    const s = ranked[risks[i]?.level] || 0;
    if (s > bestScore) { best = risks[i]; bestScore = s; }
  }
  return best;
}

/**
 * Single-pass derivation. Returns the full TodayView render-ready state.
 * Keeps every derived field in one place so the JSX file is dumb glue.
 */
export function deriveTodayState({
  fuel,
  inProgress = [],
  recentActivity = [],
  risks = [],
  now = Date.now(),
}) {
  // ── Fuel ──────────────────────────────────────────────
  // Estimated > reported when both exist (the slider keeps estimated fresh).
  const session = fuel?.estimated?.session ?? fuel?.reported?.session ?? null;
  const weekly = fuel?.estimated?.weekly ?? fuel?.reported?.weekly ?? null;
  const runwayMinutes = fuel?.session?.minutesRemaining ?? null;
  const pressure = fuelPressure(session);

  // ── Now ───────────────────────────────────────────────
  // Picks the most recently-touched in-progress task as the "lead".
  // Falls back to "Idle" when nothing is in progress.
  let leadTask = null;
  if (inProgress.length > 0) {
    const sorted = [...inProgress].sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    const lead = sorted[0];
    const startedIso = lead.updated_at || lead.created_at;
    leadTask = {
      id: lead.id,
      title: lead.title,
      project: lead.project || null,
      elapsedMinutes: startedIso ? Math.max(0, Math.floor((now - new Date(startedIso).getTime()) / ONE_MINUTE)) : null,
      startedIso,
    };
  }

  // ── Pulse ─────────────────────────────────────────────
  // Last 3 activity entries with formatted timestamps. We don't filter by
  // type — recency is the primary signal.
  const pulse = recentActivity.slice(0, 3).map((entry) => ({
    id: entry.id,
    type: entry.type || 'system',
    message: entry.message || '',
    ago: formatTimeAgo(entry.created_at, now),
    iso: entry.created_at,
  }));

  // ── Signal ────────────────────────────────────────────
  // Top risk wins; "calm waters" when there's nothing to surface.
  const top = topRisk(risks);
  const signal = top
    ? {
        kind: top.level || 'info',
        message: top.message || '',
        category: top.category || null,
        extraCount: Math.max(0, risks.length - 1),
      }
    : { kind: 'clear', message: 'Calm waters.', category: null, extraCount: 0 };

  return {
    fuel: {
      session,
      weekly,
      runwayMinutes,
      runwayLabel: formatRunway(runwayMinutes),
      pressure,
    },
    now: {
      task: leadTask,
      label: leadTask ? 'In progress' : 'Idle',
      extraCount: Math.max(0, inProgress.length - 1),
    },
    pulse,
    signal,
  };
}
