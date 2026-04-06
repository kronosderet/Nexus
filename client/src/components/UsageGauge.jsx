import { useState, useEffect } from 'react';
import { Fuel, Clock } from 'lucide-react';

function color(pct) {
  if (pct == null) return 'text-nexus-text-faint';
  if (pct <= 15) return 'text-nexus-red';
  if (pct <= 40) return 'text-nexus-amber';
  return 'text-nexus-green';
}

function barColor(pct) {
  if (pct == null) return 'bg-nexus-border';
  if (pct <= 15) return 'bg-nexus-red';
  if (pct <= 40) return 'bg-nexus-amber';
  return 'bg-nexus-green';
}

export default function UsageGauge({ ws }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/usage/latest')
      .then(r => r.json())
      .then(d => { if (d.tracked) setData(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'usage_update') setData({ tracked: true, ...msg.payload });
    });
  }, [ws]);

  if (!data) return null;

  const timing = data.timing;

  return (
    <div className="px-4 py-3 border-t border-nexus-border">
      <div className="flex items-center gap-2 mb-2">
        <Fuel size={12} className="text-nexus-text-faint" />
        <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Fuel</span>
      </div>

      {data.session_percent != null && (
        <div className="mb-1.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-mono text-nexus-text-faint">Session</span>
            <span className={`text-[10px] font-mono font-medium ${color(data.session_percent)}`}>
              {data.session_percent}%
            </span>
          </div>
          <div className="h-1.5 bg-nexus-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor(data.session_percent)}`}
              style={{ width: `${Math.max(2, data.session_percent)}%` }}
            />
          </div>
        </div>
      )}

      {data.weekly_percent != null && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-mono text-nexus-text-faint">Weekly</span>
            <span className={`text-[10px] font-mono font-medium ${color(data.weekly_percent)}`}>
              {data.weekly_percent}%
            </span>
          </div>
          <div className="h-1.5 bg-nexus-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor(data.weekly_percent)}`}
              style={{ width: `${Math.max(2, data.weekly_percent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Reset countdowns */}
      {timing && (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-nexus-text-faint">
            <Clock size={8} />
            <span>Session: {timing.session.countdown}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-nexus-text-faint">
            <Clock size={8} />
            <span>Weekly: {timing.weekly.countdown}</span>
          </div>
        </div>
      )}

      {/* Burn rate */}
      {data.burnRate?.estimatedEmpty && (
        <div className="mt-1.5 text-[9px] font-mono text-nexus-text-faint">
          ~{data.burnRate.sessionPerHour}%/h | empty in ~{data.burnRate.estimatedEmpty}
        </div>
      )}
    </div>
  );
}
