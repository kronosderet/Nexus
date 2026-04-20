import { useState, useEffect, useRef } from 'react';
import { Clock, Calendar, Timer, Fuel } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { useTweenedNumber } from '../hooks/useMotion.js';

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function cdColor(ms) {
  if (ms <= 0) return 'text-nexus-red';
  if (ms < 1800000) return 'text-nexus-red';     // <30m
  if (ms < 3600000) return 'text-nexus-amber';   // <1h
  return 'text-nexus-green';
}

export default function ClockWidget({ ws }) {
  const [serverData, setServerData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const fetchedAt = useRef(Date.now());

  // Tick every second
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Fetch server data on mount + slow poll as safety net
  useEffect(() => {
    function fetch() {
      api.getClock().then(d => {
        setServerData(d);
        fetchedAt.current = Date.now();
      }).catch(() => {});
    }
    fetch();
    const interval = setInterval(fetch, 120000);
    return () => clearInterval(interval);
  }, []);

  // Refresh on fuel/usage events
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'usage_update' || msg.type === 'reload') {
        api.getClock().then(d => {
          setServerData(d);
          fetchedAt.current = Date.now();
        }).catch(() => {});
      }
    });
  }, [ws]);

  // v4.5.0 — tween the widget's fuel percentages. HOOK CALLS MUST PRECEDE ANY
  // EARLY RETURN. Previously placed after the `if (!serverData) return null`
  // guard, which violated the Rules of Hooks — on first render serverData is
  // null (hooks skipped), next render they get called, React sees hook-call-
  // order change and throws, crashing the entire Pulse module. Don't move
  // these below the early-return.
  const sessionTween = useTweenedNumber(serverData?.fuel?.session ?? 0);
  const weeklyTween = useTweenedNumber(serverData?.fuel?.weekly ?? 0);

  if (!serverData) return null;

  const { clock, calendar, fuel } = serverData;

  // Client-side time (ticks every second)
  const localNow = new Date();
  const timeStr = localNow.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = clock.date; // Date doesn't need ticking

  // Live countdowns — compute from server reference + elapsed since fetch
  const elapsed = now - fetchedAt.current;
  const sessionMs = fuel?.sessionReset?.countdownMs != null ? Math.max(0, fuel.sessionReset.countdownMs - elapsed) : null;
  const weeklyMs = fuel?.weeklyReset ? Math.max(0, (new Date(fuel.weeklyReset.date).getTime() - Date.now())) : null;

  // Burn rate projection
  const proj = fuel?.projection;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      {/* Clock + Date */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={14} className="text-nexus-amber" />
          <span className="text-2xl font-light text-nexus-text font-mono tabular-nums">{timeStr}</span>
        </div>
        <p className="text-xs font-mono text-nexus-text-faint capitalize">{dateStr}</p>
      </div>

      {/* Session + Fuel gauges */}
      {fuel && (
        <div className="mb-4 space-y-2.5">
          {/* Session gauge with countdown */}
          <div className="px-3 py-2.5 rounded-lg bg-nexus-bg border border-nexus-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Timer size={11} className="text-nexus-text-faint" />
                <span className="text-[10px] font-mono text-nexus-text-faint uppercase">Session</span>
              </div>
              <span className={`text-xs font-mono font-medium tabular-nums ${sessionMs != null && sessionMs <= 0 ? 'text-nexus-red' : sessionMs != null && sessionMs < 1800000 ? 'text-nexus-amber' : 'text-nexus-text-dim'}`}>
                {/* v4.3.9 #234 — "waiting for reset" implied fuel was paused; rolled-over
                    window actually means usage now burns against weekly. "window expired"
                    is shorter and truthful; Fuel view shows the "log a fresh reading" nudge. */}
                {sessionMs == null ? '—' : sessionMs <= 0 ? 'window expired' : formatCountdown(sessionMs)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-nexus-border/30 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${(fuel.session ?? 0) <= 15 ? 'bg-nexus-red' : (fuel.session ?? 0) <= 40 ? 'bg-nexus-amber' : 'bg-nexus-green'}`}
                  style={{ width: `${Math.max(2, fuel.session ?? 0)}%` }} />
              </div>
              <span className="text-[10px] font-mono text-nexus-text-faint tabular-nums w-8 text-right">{fuel.session != null ? `${Math.round(sessionTween)}%` : '?'}</span>
            </div>
          </div>

          {/* Weekly gauge with reset info */}
          <div className="px-3 py-2.5 rounded-lg bg-nexus-bg border border-nexus-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <Fuel size={11} className="text-nexus-text-faint" />
                <span className="text-[10px] font-mono text-nexus-text-faint uppercase">Weekly</span>
              </div>
              <span className="text-xs font-mono text-nexus-text-dim tabular-nums">
                {weeklyMs != null && weeklyMs > 0 ? `resets ${formatCountdown(weeklyMs)}` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-nexus-border/30 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${(fuel.weekly ?? 0) <= 15 ? 'bg-nexus-red' : (fuel.weekly ?? 0) <= 40 ? 'bg-nexus-amber' : 'bg-nexus-green'}`}
                  style={{ width: `${Math.max(2, fuel.weekly ?? 0)}%` }} />
              </div>
              <span className="text-[10px] font-mono text-nexus-text-faint tabular-nums w-8 text-right">{fuel.weekly != null ? `${Math.round(weeklyTween)}%` : '?'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Week calendar */}
      {/* v4.4.4 #238 — burn-rate projection overlay. When a weeklyProjection is
          available (enough fuel history to compute daily burn), the strip tints
          days based on projected end-of-day weekly fuel and marks the first day
          the line crosses zero. Tooltip on each day spells out the projected value. */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Calendar size={12} className="text-nexus-text-faint" />
          <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Week ahead</span>
          {fuel?.weeklyProjection && (
            <span className="ml-auto text-[9px] font-mono text-nexus-text-faint" title="Current weekly burn projection">
              ~{fuel.weeklyProjection.perDay}%/day
              {fuel.weeklyProjection.runsOutBeforeReset && <span className="text-nexus-red ml-1">· runs out</span>}
            </span>
          )}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendar.map((day, i) => {
            const proj = day.projectedWeekly;
            const empty = day.isProjectedEmpty;
            // Base class: preserve today/weekend/reset styling as primary signal.
            // Projection adds a tint for low-fuel days and a distinct red border
            // on the runout day so it reads at a glance.
            const base = day.isToday
              ? 'bg-nexus-amber/15 text-nexus-amber border border-nexus-amber/30'
              : day.isWeekend
              ? 'bg-nexus-bg/50 text-nexus-text-faint'
              : day.isWeeklyReset
              ? 'bg-nexus-green/10 text-nexus-green border border-nexus-green/20'
              : 'bg-nexus-bg text-nexus-text-dim';
            const projTint = empty
              ? 'ring-1 ring-nexus-red/60'
              : proj != null && proj <= 15
              ? 'ring-1 ring-nexus-red/30'
              : proj != null && proj <= 40
              ? 'ring-1 ring-nexus-amber/30'
              : '';
            const baseTitle = day.isWeeklyReset
              ? (day.note ? `Weekly fuel reset · ${day.note}` : `${day.date} · Weekly fuel limit resets this day (all-models bucket refills).`)
              : (day.note || day.date);
            const projTitle = proj != null
              ? `\nProjected weekly: ~${proj}%${empty ? ' · runs out this day' : ''}`
              : '';
            return (
              <div
                key={i}
                className={`relative text-center py-1.5 rounded text-[10px] font-mono transition-colors ${base} ${projTint}`}
                title={`${baseTitle}${projTitle}`}
              >
                <div>{day.date.split(' ')[0]}</div>
                {day.isWeeklyReset && <div className="text-[7px] mt-0.5">reset</div>}
                {day.isToday && <div className="text-[7px] mt-0.5">now</div>}
                {empty && !day.isToday && <div className="text-[7px] mt-0.5 text-nexus-red">0%</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
