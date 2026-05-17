/**
 * Shared horizontal progress / gauge bar.
 *
 * v4.9.1 #752 — replaces three near-identical local components:
 *   - Fuel.jsx     `Bar`      (fuel %, supports invert for burn coloring)
 *   - Pulse.jsx    `GaugeBar` (GPU/VRAM, color override)
 *   - ClockWidget  inline     (session/weekly countdowns)
 * Plus inline patterns in DigestWidget.jsx and Command.jsx that all used the
 * same Tailwind shape.
 *
 * Props:
 *   percent     — 0..100 (clamped). null/undefined treated as 0.
 *   colorClass  — Tailwind background class for the fill (default `bg-nexus-amber`).
 *                 Pass a function `(pct) => className` for dynamic thresholds.
 *   height      — Tailwind height class for the track (default `h-2`).
 *   bgClass     — track background class (default `bg-nexus-bg`).
 *   minVisible  — minimum width % so a 1% fill still shows a sliver (default 2).
 *   className   — extra classes for the outer track.
 */
export default function ProgressBar({
  percent,
  colorClass = 'bg-nexus-amber',
  height = 'h-2',
  bgClass = 'bg-nexus-bg',
  minVisible = 2,
  className = '',
}) {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const fill = typeof colorClass === 'function' ? colorClass(clamped) : colorClass;
  return (
    <div className={`${height} ${bgClass} rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ${fill}`}
        style={{ width: `${Math.max(minVisible, clamped)}%` }}
      />
    </div>
  );
}
