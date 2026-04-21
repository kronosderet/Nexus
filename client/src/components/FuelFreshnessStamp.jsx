/**
 * Shared fuel-reading freshness stamp — v4.3.9 #259.
 *
 * Extracted from Fuel view's header so Command view (#220) and Dashboard's
 * ClockWidget can reuse the same age indicator without duplicating the
 * derivation logic.
 *
 * Input: `fuel` object from /api/estimator (shape matches useFuel return).
 * Output: short human-readable age stamp, colored by staleness so users
 * can see at a glance whether the reading is live-enough to trust.
 *
 * Staleness thresholds:
 *   - < 15m and high-confidence estimate → "Fresh reading" (text-faint)
 *   - 0–60m → "Nm since report" (text-faint)
 *   - 60–120m → amber (stale-ish, consider re-reading)
 *   - > 120m → red (definitely stale)
 *
 * Usage:
 *   <FuelFreshnessStamp fuel={fuel} />
 *   <FuelFreshnessStamp fuel={fuel} className="ml-2" />
 */
// v4.5.5 #242 — label phrasing changed from "Nm since report" → "read Nm ago".
// The old wording read as a technical delta ("since report"); the new wording
// matches how users think about freshness. Also lowers the "Fresh reading"
// threshold to prevent the illusion the dashboard was fueled by the stale-look
// audit flagged. Adds title tooltip with exact delta for power users.
export default function FuelFreshnessStamp({ fuel, className = '' }) {
  if (!fuel) return null;
  const minutesAgo = fuel.reported?.minutesAgo;
  const isHighConfidence = fuel.estimated?.confidence === 'high';

  const label =
    isHighConfidence && (minutesAgo == null || minutesAgo < 10)
      ? 'fresh'
      : minutesAgo == null
      ? 'age unknown'
      : minutesAgo < 60
      ? `read ${minutesAgo}m ago`
      : `read ${Math.floor(minutesAgo / 60)}h${minutesAgo % 60 > 0 ? ` ${minutesAgo % 60}m` : ''} ago`;

  const staleClass =
    minutesAgo == null
      ? 'text-nexus-text-faint'
      : minutesAgo >= 120
      ? 'text-nexus-red'
      : minutesAgo >= 60
      ? 'text-nexus-amber'
      : 'text-nexus-text-faint';

  const title =
    minutesAgo == null
      ? 'No report age available'
      : `Last fuel reading logged ${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago. Values shown are that snapshot — log a fresh reading to refresh.`;

  return <span className={`${staleClass} ${className}`} title={title}>{label}</span>;
}
