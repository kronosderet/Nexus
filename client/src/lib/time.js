/**
 * Relative-time helpers — single source of truth.
 *
 * v4.9.1 #751 — collapses six near-identical implementations across the client:
 *   - Command.jsx:39 minutesAgo (Nm/h/d ago, "just now" / "unknown")
 *   - Command.jsx:524 elapsedSince (composite "Nh Nm")
 *   - Fleet.jsx:46 daysSince (days-only, "today" / "yesterday")
 *   - ProjectHealth.jsx:10 timeAgo (Nm/h/d ago, "never")
 *   - Handover.jsx:19 relativeAge (Nm/h/d ago, "just now")
 *   - components/DigestWidget.jsx:45 ageStr (inline Ns/m/h, no suffix)
 *
 * Plus the pre-existing lib/todayView.js:30 formatTimeAgo which kept its
 * own copy because the TodayView header needed a tighter no-suffix form.
 * That function is now re-exported from here as an alias for backwards
 * compatibility with its single caller.
 *
 * API:
 *   relativeAge(iso, opts) → "Nm ago" / "just now" / etc.
 *     opts.suffix       — string appended to bucket value (default ' ago')
 *     opts.justNow      — string when < 1 min (default 'just now')
 *     opts.empty        — string when iso is null/invalid (default '')
 *     opts.includeSeconds — show "Ns" for < 1 min instead of justNow (default false)
 *     opts.specialDays  — object overriding day buckets, e.g. { 0: 'today', 1: 'yesterday' }
 *
 *   elapsedDuration(iso) → "Nh Nm" composite for in-progress timing
 */

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * 1000;
const ONE_HOUR   = 60 * ONE_MINUTE;
const ONE_DAY    = 24 * ONE_HOUR;

function parseMs(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Default "N{unit} ago" formatter. Negative diff (future timestamp) clamps to
 * justNow so we never show "-2m ago" from clock skew.
 */
export function relativeAge(iso, opts = {}) {
  const {
    suffix = ' ago',
    justNow = 'just now',
    empty = '',
    includeSeconds = false,
    specialDays,
  } = opts;

  const ms = parseMs(iso);
  if (ms == null) return empty;
  const diff = Date.now() - ms;

  // floorTo='day' collapses sub-day diffs into the day bucket — useful for
  // "lastCommitDate" displays where "5m ago" would be noise. Negative diffs
  // (future timestamps) still hit the justNow path.
  if (opts.floorTo === 'day' && diff >= 0) {
    const days = Math.floor(diff / ONE_DAY);
    if (specialDays && Object.prototype.hasOwnProperty.call(specialDays, days)) {
      return specialDays[days];
    }
    return `${days}d${suffix}`;
  }

  if (diff < ONE_MINUTE) {
    if (includeSeconds && diff >= 0) return `${Math.floor(diff / ONE_SECOND)}s${suffix}`;
    return justNow;
  }
  if (diff < ONE_HOUR)  return `${Math.round(diff / ONE_MINUTE)}m${suffix}`;
  if (diff < ONE_DAY)   return `${Math.round(diff / ONE_HOUR)}h${suffix}`;
  const days = Math.round(diff / ONE_DAY);
  if (specialDays && Object.prototype.hasOwnProperty.call(specialDays, days)) {
    return specialDays[days];
  }
  return `${days}d${suffix}`;
}

/** Composite "Nh Nm" form for showing in-flight duration (was Command.elapsedSince). */
export function elapsedDuration(iso) {
  const ms = parseMs(iso);
  if (ms == null) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return '';
  const m = Math.floor(diff / ONE_MINUTE);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Backwards-compat re-export — lib/todayView.js used to own this. */
export function formatTimeAgo(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = now - t;
  if (diff < 0) return 'just now';
  if (diff < ONE_MINUTE) return 'just now';
  if (diff < ONE_HOUR)   return `${Math.round(diff / ONE_MINUTE)}m`;
  if (diff < ONE_DAY)    return `${Math.round(diff / ONE_HOUR)}h`;
  return `${Math.round(diff / ONE_DAY)}d`;
}
