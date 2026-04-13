import { useState, useEffect, useRef } from 'react';
import { Clock, Calendar, Timer, Fuel } from 'lucide-react';
import { api } from '../hooks/useApi.js';

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

      {/* Session + Weekly countdowns */}
      {fuel && (
        <div className="mb-4 space-y-2">
          {sessionMs != null && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-nexus-bg border border-nexus-border">
              <div className="flex items-center gap-2">
                <Timer size={12} className="text-nexus-text-faint" />
                <span className="text-[10px] font-mono text-nexus-text-faint uppercase">Session</span>
              </div>
              <span className={`text-sm font-mono font-medium tabular-nums ${cdColor(sessionMs)}`}>
                {sessionMs <= 0 ? 'EXPIRED' : formatCountdown(sessionMs)}
              </span>
            </div>
          )}

          {fuel.session != null && fuel.weekly != null && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-nexus-bg border border-nexus-border">
              <div className="flex items-center gap-2">
                <Fuel size={12} className="text-nexus-text-faint" />
                <span className="text-[10px] font-mono text-nexus-text-faint uppercase">Fuel</span>
              </div>
              <div className="flex gap-3 text-sm font-mono tabular-nums">
                <span className={cdColor(fuel.session > 15 ? 999999 : 0)}>{fuel.session ?? '?'}%</span>
                <span className="text-nexus-text-faint">/</span>
                <span className={cdColor(fuel.weekly > 10 ? 999999 : 0)}>{fuel.weekly ?? '?'}%</span>
              </div>
            </div>
          )}

          {proj && (
            <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-mono text-nexus-text-faint">
              <span>Burn: {proj.burnPerHour}%/h</span>
              <span>Empty ~{proj.emptyAt}</span>
            </div>
          )}

          {weeklyMs != null && weeklyMs > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-mono text-nexus-text-faint">
              <span>Weekly reset</span>
              <span>{formatCountdown(weeklyMs)}</span>
            </div>
          )}
        </div>
      )}

      {/* Week calendar */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Calendar size={12} className="text-nexus-text-faint" />
          <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Week ahead</span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendar.map((day, i) => (
            <div
              key={i}
              className={`text-center py-1.5 rounded text-[10px] font-mono transition-colors ${
                day.isToday
                  ? 'bg-nexus-amber/15 text-nexus-amber border border-nexus-amber/30'
                  : day.isWeekend
                  ? 'bg-nexus-bg/50 text-nexus-text-faint'
                  : day.isWeeklyReset
                  ? 'bg-nexus-green/10 text-nexus-green border border-nexus-green/20'
                  : 'bg-nexus-bg text-nexus-text-dim'
              }`}
              title={day.note || day.date}
            >
              <div>{day.date.split(' ')[0]}</div>
              {day.isWeeklyReset && <div className="text-[7px] mt-0.5">reset</div>}
              {day.isToday && <div className="text-[7px] mt-0.5">now</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
