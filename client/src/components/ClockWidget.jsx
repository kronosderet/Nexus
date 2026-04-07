import { useState, useEffect } from 'react';
import { Clock, Calendar } from 'lucide-react';
import { api } from '../hooks/useApi.js';

export default function ClockWidget({ ws }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    function fetchClock() {
      api.getClock().then(d => { if (!cancelled) setData(d); }).catch(() => {});
    }
    fetchClock();
    const interval = setInterval(fetchClock, 60000); // slow poll as safety net
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Real-time refresh on usage and fuel events (instead of aggressive polling)
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'usage_update' || msg.type === 'fuel_update') {
        api.getClock().then(setData).catch(() => {});
      }
    });
  }, [ws]);

  if (!data) return null;

  const { clock, calendar, fuel } = data;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      {/* Clock + Date */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={14} className="text-nexus-amber" />
          <span className="text-2xl font-light text-nexus-text font-mono">{clock.time}</span>
        </div>
        <p className="text-xs font-mono text-nexus-text-faint capitalize">{clock.date}</p>
      </div>

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
