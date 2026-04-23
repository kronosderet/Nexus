// v4.5.9 #266 — single source of truth for fuel-state copy.
// Both ClockWidget (dashboard) and Fuel.jsx previously had their own wording
// for the "session window expired" state. v4.3.9 #234 fixed the copy in both
// places; this module makes sure they stay in sync going forward.
//
// Semantics: when the session window clock hits 0, fuel isn't paused — usage
// continues against the weekly allowance until a fresh reading is logged. The
// short label is the gauge chip; the long label is the status line under it.

export const SESSION_EXPIRED_SHORT = 'window expired';

export const SESSION_EXPIRED_LONG =
  'Session window expired · log a fresh reading to reset timer';

// Tooltip text explaining what the state actually means — reusable on either view.
export const SESSION_EXPIRED_TOOLTIP =
  'The 5-hour session window rolled over. Usage now burns against your weekly cap. ' +
  'Log a fresh reading (nexus_log_usage) to start a new session window.';
