import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';

const DAY_LABELS = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function heatColor(count, max) {
  if (count === 0) return 'bg-nexus-bg';
  const intensity = count / max;
  if (intensity < 0.25) return 'bg-nexus-amber/20';
  if (intensity < 0.5) return 'bg-nexus-amber/40';
  if (intensity < 0.75) return 'bg-nexus-amber/60';
  return 'bg-nexus-amber';
}

export default function ActivityHeatmap() {
  const [data, setData] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    fetch('/api/heatmap?weeks=12')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || data.days.length === 0) return null;

  // Group days into weeks (columns)
  const weeks = [];
  let currentWeek = [];
  for (const day of data.days) {
    if (day.dayOfWeek === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  // Month labels
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const firstDay = week[0];
    const month = new Date(firstDay.date).getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ index: i, label: MONTH_NAMES[month] });
      lastMonth = month;
    }
  });

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-nexus-amber" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Activity Map</span>
        </div>
        <span className="text-xs font-mono text-nexus-text-faint">
          {data.totalEvents} events in {data.weeks} weeks
        </span>
      </div>

      {/* Month labels */}
      <div className="flex ml-8 mb-1">
        {monthLabels.map((m, i) => (
          <span
            key={i}
            className="text-[9px] font-mono text-nexus-text-faint"
            style={{ position: 'relative', left: `${m.index * 13}px` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex gap-0.5">
        {/* Day labels */}
        <div className="flex flex-col gap-0.5 mr-1 shrink-0">
          {DAY_LABELS.map((label, i) => (
            <div key={i} className="w-6 h-[11px] text-[9px] font-mono text-nexus-text-faint leading-[11px] text-right pr-1">
              {label}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex gap-0.5 overflow-x-auto">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {/* Pad start of first week */}
              {wi === 0 && week[0].dayOfWeek > 0 && (
                Array.from({ length: week[0].dayOfWeek }).map((_, i) => (
                  <div key={`pad-${i}`} className="w-[11px] h-[11px]" />
                ))
              )}
              {week.map((day) => (
                <div
                  key={day.date}
                  className={`w-[11px] h-[11px] rounded-sm ${heatColor(day.count, data.maxCount)} cursor-pointer transition-colors hover:ring-1 hover:ring-nexus-amber/50`}
                  onMouseEnter={(e) => setTooltip({ date: day.date, count: day.count, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 justify-end">
        <span className="text-[9px] font-mono text-nexus-text-faint">Less</span>
        <div className="flex gap-0.5">
          <div className="w-[11px] h-[11px] rounded-sm bg-nexus-bg" />
          <div className="w-[11px] h-[11px] rounded-sm bg-nexus-amber/20" />
          <div className="w-[11px] h-[11px] rounded-sm bg-nexus-amber/40" />
          <div className="w-[11px] h-[11px] rounded-sm bg-nexus-amber/60" />
          <div className="w-[11px] h-[11px] rounded-sm bg-nexus-amber" />
        </div>
        <span className="text-[9px] font-mono text-nexus-text-faint">More</span>
      </div>

      {/* Hour distribution bar */}
      <div className="mt-4 pt-3 border-t border-nexus-border">
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Active hours</span>
        <div className="flex items-end gap-px mt-1.5 h-8">
          {data.hourDistribution.map((count, h) => {
            const maxH = Math.max(1, ...data.hourDistribution);
            const height = count > 0 ? Math.max(2, (count / maxH) * 32) : 0;
            return (
              <div key={h} className="flex-1 flex flex-col items-center justify-end">
                <div
                  className={`w-full rounded-t-sm ${count > 0 ? 'bg-nexus-amber/40' : 'bg-transparent'}`}
                  style={{ height: `${height}px` }}
                  title={`${h}:00 — ${count} events`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[8px] font-mono text-nexus-text-faint">0h</span>
          <span className="text-[8px] font-mono text-nexus-text-faint">6h</span>
          <span className="text-[8px] font-mono text-nexus-text-faint">12h</span>
          <span className="text-[8px] font-mono text-nexus-text-faint">18h</span>
          <span className="text-[8px] font-mono text-nexus-text-faint">24h</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-nexus-surface border border-nexus-border rounded px-2 py-1 text-xs font-mono text-nexus-text shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 30 }}
        >
          {tooltip.date}: {tooltip.count} event{tooltip.count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
