// v4.4.5 #383 — shared Chip primitive. Audit flagged border-radius + padding drift
// across Fuel/Log/Overseer/Graph filter controls. This is the canonical pill used
// for any "filter / scope / toggle" UI. Kept minimal on purpose — if a call-site
// needs extra affordances (eye icon for mute, multi-button compound), it wraps
// <Chip> and renders siblings inside a shared outer <span>.
//
// Variants:
//   active  — currently-selected state (amber ring)
//   muted   — greyed + strikethrough (Log type mute toggle)
//   default — neutral, interactive
//
// Sizes:
//   sm (default) — text-[10px] px-2 py-0.5  · used for filter pills
//   md           — text-xs    px-2.5 py-1   · used for chunkier filters (project chips)
export default function Chip({
  children,
  active = false,
  muted = false,
  size = 'sm',
  onClick,
  title,
  type = 'button',
  className = '',
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
}) {
  const sizeCls = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5';
  const stateCls = muted
    ? 'bg-nexus-bg text-nexus-text-faint border-nexus-border line-through opacity-60'
    : active
    ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20'
    : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text';
  const base = 'inline-flex items-center gap-1 rounded-full font-mono border transition-colors';
  // Render as button by default (interactive) or span when no onClick (display-only).
  if (!onClick) {
    return (
      <span className={`${base} ${sizeCls} ${stateCls} ${className}`} title={title} aria-label={ariaLabel}>
        {children}
      </span>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={`${base} ${sizeCls} ${stateCls} ${className}`}
    >
      {children}
    </button>
  );
}
