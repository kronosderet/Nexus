// v4.5.0 "Animated Instruments" — motion primitives.
//
// Two hooks + one constant. Kept colocated in one file because they're tiny
// and always used together; inlining the CSS-animation className pattern
// from here keeps module code readable.

import { useEffect, useRef, useState } from 'react';

// Check prefers-reduced-motion once; CSS handles the actual suppression via
// the @media block in index.css. This export is for JS-side bailouts (e.g.
// don't tween numbers, just snap to the new value) so we don't waste an
// animation frame on users who opted out.
export const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// useTweenedNumber — animates a numeric display from previous value to target.
// Uses requestAnimationFrame with a cubic-out ease. Returns the current tween
// value (may be fractional mid-tween; caller handles rounding).
//
// Usage:
//   const display = useTweenedNumber(session, { duration: 420 });
//   return <span>{Math.round(display)}%</span>;
//
// When the value jumps, the hook animates smoothly. When the user opts out of
// motion, it snaps immediately (PREFERS_REDUCED_MOTION → duration=0).
export function useTweenedNumber(target, { duration = 450 } = {}) {
  const [value, setValue] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);
  const rafRef = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (target == null) { setValue(0); return; }
    if (PREFERS_REDUCED_MOTION || duration <= 0) { setValue(target); fromRef.current = target; return; }
    const from = fromRef.current;
    if (from === target) return;
    startRef.current = performance.now();
    const run = (now) => {
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // Cubic-out: 1 - (1-t)^3 — fast start, gentle landing
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      setValue(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(run);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(run);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}

// useWsFlash — tracks which item ids arrived after mount so the row can
// wear an `animate-ws-flash` class once and only once.
//
// Usage:
//   const isNew = useWsFlash(entries, e => e.id);
//   return items.map(e => (
//     <div className={isNew(e.id) ? 'animate-ws-flash' : ''}>...</div>
//   ));
//
// First-render items are treated as already-seen (no flash on cold load).
export function useWsFlash(items, getId) {
  const seenRef = useRef(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!Array.isArray(items)) return;
    if (seenRef.current == null) {
      // First pass: everything visible right now is "already seen" — we only
      // flash items that arrive AFTER this render.
      seenRef.current = new Set(items.map(i => getId(i)));
      return;
    }
    // Subsequent passes: if any item id isn't in seenRef, it just arrived.
    let mutated = false;
    for (const item of items) {
      const id = getId(item);
      if (!seenRef.current.has(id)) {
        seenRef.current.add(id);
        mutated = true;
      }
    }
    if (mutated) setTick(t => t + 1);
  }, [items, getId]);

  // Return an isNew predicate. "New" = id added to seenRef in the latest pass.
  // We store the "just-flashed" set separately so flashes clear after 1s.
  const recentlyNewRef = useRef(new Set());
  useEffect(() => {
    if (tick === 0) return;
    const snapshot = Array.from(seenRef.current);
    recentlyNewRef.current = new Set(snapshot.slice(-5)); // last 5 additions
    const t = setTimeout(() => { recentlyNewRef.current = new Set(); }, 1000);
    return () => clearTimeout(t);
  }, [tick]);

  return (id) => recentlyNewRef.current.has(id);
}
