/**
 * CLI formatting helpers — ANSI color codes + small text formatters.
 *
 * Extracted from cli/nexus.js in v4.7.5 (#217 part 3) so command-group files
 * don't each redefine the color palette.
 */

// ── ANSI color codes ───────────────────────────────────
export const dim   = (s) => `\x1b[2m${s}\x1b[0m`;
export const amber = (s) => `\x1b[33m${s}\x1b[0m`;
export const green = (s) => `\x1b[32m${s}\x1b[0m`;
export const blue  = (s) => `\x1b[34m${s}\x1b[0m`;
export const red   = (s) => `\x1b[31m${s}\x1b[0m`;

// Status → color mapping. `dim` is a function reference, not a string.
export const STATUS_COLORS = {
  backlog:     dim,
  in_progress: amber,
  review:      blue,
  done:        green,
};

// ── Text formatters ────────────────────────────────────

/**
 * Compact relative-time label for human-readable timestamps.
 * "Ns / Nm / Nh / Nd ago".
 */
export function timeSince(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Block-style progress bar of fixed width. `pct` 0–100.
 */
export function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Single-line task formatter used by `nexus tasks`, `nexus brief`, etc.
 * `  #ID [status] title`
 */
export function formatTask(t) {
  const color = STATUS_COLORS[t.status] || dim;
  return `  ${dim(`#${t.id}`)} ${color(`[${t.status}]`)} ${t.title}`;
}
