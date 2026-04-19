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
export default function FuelFreshnessStamp({ fuel, className = '' }) {
  if (!fuel) return null;
  const minutesAgo = fuel.reported?.minutesAgo;
  const isHighConfidence = fuel.estimated?.confidence === 'high';

  const label =
    isHighConfidence && (minutesAgo == null || minutesAgo < 15)
      ? 'Fresh reading'
      : `${minutesAgo ?? '?'}m since report`;

  const staleClass =
    minutesAgo == null
      ? 'text-nexus-text-faint'
      : minutesAgo >= 120
      ? 'text-nexus-red'
      : minutesAgo >= 60
      ? 'text-nexus-amber'
      : 'text-nexus-text-faint';

  return <span className={`${staleClass} ${className}`}>{label}</span>;
}
