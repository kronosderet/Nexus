import { useState, useEffect } from 'react';
import { Clock, Calendar, Fuel, TrendingDown } from 'lucide-react';

function fuelColor(pct) {
  if (pct == null) return 'text-nexus-text-faint';
  if (pct <= 15) return 'text-nexus-red';
  if (pct <= 40) return 'text-nexus-amber';
  return 'text-nexus-green';
}

function barColor(pct) {
  if (pct <= 15) return 'bg-nexus-red';
  if (pct <= 40) return 'bg-nexus-amber';
  return 'bg-nexus-green';
}

function MiniBar({ percent, className = '' }) {
  return (
    <div className={`h-1 bg-nexus-bg rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${barColor(percent)}`} style={{ width: `${Math.max(2, percent)}%` }} />
    </div>
  );
}

export default function ClockWidget() {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    function fetchClock() {
      fetch('/api/clock').then(r => r.json()).then(setData).catch(() => {});
    }
    fetchClock();
    const interval = setInterval(() => { fetchClock(); setTick(t => t + 1); }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const { clock, fuel, calendar, fuelHistory } = data;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      {/* Clock + Date */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-nexus-amber" />
            <span className="text-2xl font-light text-nexus-text font-mono">{clock.time}</span>
          </div>
          <p className="text-xs font-mono text-nexus-text-faint capitalize">{clock.date}</p>
          <p className="text-[9px] font-mono text-nexus-text-faint mt-0.5">
            {clock.isWorkHours ? `${clock.hoursLeftToday}h of work hours remaining` : 'Outside work hours'}
          </p>
        </div>

        {/* Fuel gauges */}
        {fuel && (
          <div className="text-right space-y-1.5 min-w-[120px]">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] font-mono text-nexus-text-faint">Session</span>
                <span className={`text-xs font-mono font-medium ${fuelColor(fuel.session)}`}>{fuel.session}%</span>
              </div>
              <MiniBar percent={fuel.session} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] font-mono text-nexus-text-faint">Weekly</span>
                <span className={`text-xs font-mono font-medium ${fuelColor(fuel.weekly)}`}>{fuel.weekly}%</span>
              </div>
              <MiniBar percent={fuel.weekly} />
            </div>
            {fuel.sessionReset && (
              <p className="text-[9px] font-mono text-nexus-text-faint flex items-center gap-1 justify-end">
                <Clock size={8} />
                Session: {fuel.sessionReset.countdown}{fuel.sessionReset.elapsed ? ` (${fuel.sessionReset.elapsed} in)` : ''}
              </p>
            )}
            {fuel.projection && (
              <p className="text-[9px] font-mono text-nexus-text-faint flex items-center gap-1 justify-end">
                <TrendingDown size={8} />
                ~{fuel.projection.burnPerHour}%/h — empty {fuel.projection.emptyAt}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Fuel sparkline */}
      {fuelHistory.length > 2 && (
        <div className="mb-4">
          <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Fuel history</span>
          <div className="flex items-end gap-px mt-1 h-6">
            {fuelHistory.map((h, i) => {
              const pct = h.session ?? h.weekly ?? 0;
              return (
                <div key={i} className="flex-1 flex items-end" title={`${h.time}: ${pct}%`}>
                  <div className={`w-full rounded-t-sm ${barColor(pct)}`} style={{ height: `${Math.max(1, (pct / 100) * 24)}px`, opacity: 0.6 }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week calendar */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Calendar size={12} className="text-nexus-text-faint" />
          <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Week ahead</span>
          {fuel?.weeklyReset && (
            <span className="ml-auto text-[9px] font-mono text-nexus-text-faint">
              Weekly reset: {fuel.weeklyReset.countdown}
            </span>
          )}
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
              {day.isWeeklyReset && <div className="text-[7px] mt-0.5">⟳ 21:00</div>}
              {day.isToday && <div className="text-[7px] mt-0.5">now</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
