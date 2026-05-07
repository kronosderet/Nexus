/**
 * Today fusion view (v4.7.4 #240).
 *
 * Single dense header card on the Command tab fusing four signals into one
 * glance: fuel · current task · recent activity · top risk. The four columns
 * collapse to 2x2 on small viewports and to 1-column on phones.
 *
 * All derivation logic lives in `client/src/lib/todayView.js` so this file
 * stays as thin presentation glue. See `tests/todayView.test.js` for the
 * derivation specs.
 *
 * Render contract: receives the same `fuel`, `inProgress`, `recentActivity`,
 * and `risks` shapes that StrategicView already consumes. No new fetches,
 * no new endpoints.
 */
import { useMemo } from 'react';
import { Battery, Activity, Zap, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { deriveTodayState } from '../../lib/todayView.js';

const PRESSURE_COLOR = {
  critical: 'text-nexus-red',
  low: 'text-nexus-amber',
  normal: 'text-nexus-green',
};

const SIGNAL_STYLE = {
  critical: { color: 'text-nexus-red',    icon: AlertTriangle },
  warning:  { color: 'text-nexus-amber',  icon: AlertTriangle },
  info:     { color: 'text-nexus-blue',   icon: AlertTriangle },
  clear:    { color: 'text-nexus-green',  icon: CheckCircle2 },
};

export default function TodayView({ fuel, inProgress = [], recentActivity = [], risks = [] }) {
  const state = useMemo(
    () => deriveTodayState({ fuel, inProgress, recentActivity, risks }),
    [fuel, inProgress, recentActivity, risks],
  );

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <FuelColumn fuel={state.fuel} />
        <NowColumn now={state.now} />
        <PulseColumn pulse={state.pulse} />
        <SignalColumn signal={state.signal} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Column primitives
// ──────────────────────────────────────────────────────────

function ColumnHeader({ icon: Icon, label, accent = 'text-nexus-amber' }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon size={11} className={accent} />
      <span className={`text-[9px] font-mono uppercase tracking-[0.15em] ${accent}`}>{label}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Fuel
// ──────────────────────────────────────────────────────────

function FuelColumn({ fuel }) {
  const { session, weekly, runwayLabel, pressure } = fuel;
  const sessionColor = pressure ? PRESSURE_COLOR[pressure] : 'text-nexus-text-faint';

  return (
    <div className="min-w-0">
      <ColumnHeader icon={Battery} label="Fuel" accent={pressure === 'critical' ? 'text-nexus-red' : 'text-nexus-amber'} />
      {session == null ? (
        <p className="text-[11px] font-mono text-nexus-text-faint">No reading yet — log via /api/usage.</p>
      ) : (
        <div className="space-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-light tabular-nums ${sessionColor}`}>{session}%</span>
            <span className="text-[10px] font-mono text-nexus-text-faint">session</span>
          </div>
          <div className="flex items-baseline gap-2 text-[10px] font-mono">
            <span className="text-nexus-text-dim tabular-nums">{weekly == null ? '—' : `${weekly}%`}</span>
            <span className="text-nexus-text-faint">weekly</span>
            {runwayLabel && (
              <span className="text-nexus-text-faint ml-auto">runway {runwayLabel}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Now (current task)
// ──────────────────────────────────────────────────────────

function NowColumn({ now }) {
  const accent = now.task ? 'text-nexus-amber' : 'text-nexus-text-faint';

  return (
    <div className="min-w-0">
      <ColumnHeader icon={Activity} label="Now" accent={accent} />
      {now.task ? (
        <div className="space-y-0.5">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-nexus-amber shrink-0 animate-pulse mt-1" aria-hidden="true" />
            <span className="text-xs text-nexus-text truncate" title={now.task.title}>
              #{now.task.id} {now.task.title}
            </span>
          </div>
          <div className="flex items-baseline gap-2 text-[10px] font-mono text-nexus-text-faint">
            {now.task.project && <span className="text-nexus-text-dim">[{now.task.project}]</span>}
            {now.task.elapsedMinutes != null && (
              <span className="flex items-center gap-1">
                <Clock size={8} /> {formatElapsed(now.task.elapsedMinutes)}
              </span>
            )}
            {now.extraCount > 0 && (
              <span className="ml-auto">+{now.extraCount} more</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[11px] font-mono text-nexus-text-faint">Idle — no active task.</p>
      )}
    </div>
  );
}

function formatElapsed(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ──────────────────────────────────────────────────────────
// Pulse (recent activity)
// ──────────────────────────────────────────────────────────

function PulseColumn({ pulse }) {
  return (
    <div className="min-w-0">
      <ColumnHeader icon={Zap} label="Pulse" accent="text-nexus-blue" />
      {pulse.length === 0 ? (
        <p className="text-[11px] font-mono text-nexus-text-faint">Quiet — no recent events.</p>
      ) : (
        <ul className="space-y-0.5">
          {pulse.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 min-w-0">
              <span className="text-[9px] font-mono text-nexus-text-faint tabular-nums shrink-0">{e.ago}</span>
              <span className="text-[11px] text-nexus-text-dim truncate" title={e.message}>
                {e.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Signal (top risk OR all-clear)
// ──────────────────────────────────────────────────────────

function SignalColumn({ signal }) {
  const style = SIGNAL_STYLE[signal.kind] || SIGNAL_STYLE.info;
  const Icon = style.icon;

  return (
    <div className="min-w-0">
      <ColumnHeader icon={Icon} label="Signal" accent={style.color} />
      <div className="space-y-0.5">
        <p className={`text-xs ${signal.kind === 'clear' ? 'text-nexus-text-dim' : 'text-nexus-text'} line-clamp-2`} title={signal.message}>
          {signal.message}
        </p>
        <div className="flex items-baseline gap-2 text-[10px] font-mono text-nexus-text-faint">
          {signal.category && <span className={style.color}>{signal.category}</span>}
          {signal.extraCount > 0 && (
            <span className="ml-auto">+{signal.extraCount} more</span>
          )}
        </div>
      </div>
    </div>
  );
}
