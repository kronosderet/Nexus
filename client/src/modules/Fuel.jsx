import { useState, useEffect } from 'react';
import { Fuel as FuelIcon, Clock, TrendingDown, Calendar, Zap, AlertTriangle } from 'lucide-react';
import { api } from '../hooks/useApi.js';

function color(pct) {
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

function Bar({ percent, className = '', height = 'h-2' }) {
  return (
    <div className={`${height} bg-nexus-bg rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${barColor(percent)}`} style={{ width: `${Math.max(2, percent)}%` }} />
    </div>
  );
}

export default function FuelModule({ ws }) {
  const [fuel, setFuel] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [history, setHistory] = useState(null);

  const [timing, setTiming] = useState(null);

  async function fetchAll() {
    try {
      const [f, w, h, t] = await Promise.all([
        api.getEstimator(),
        api.getEstimatorWorkload(),
        api.getEstimatorHistory(),
        api.getUsageLatest().catch(() => null),
      ]);
      setFuel(f);
      setWorkload(w);
      setHistory(h);
      if (t) setTiming(t);
    } catch (err) {
      console.error('Failed to fetch fuel data', err);
    }
  }

  // Safety-net poll every 2 min — real-time updates come via WebSocket (#170)
  useEffect(() => { fetchAll(); const i = setInterval(fetchAll, 120000); return () => clearInterval(i); }, []);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => { if (msg.type === 'usage_update' || msg.type === 'reload') fetchAll(); });
  }, [ws]);

  if (!fuel?.tracked) {
    return (
      <div className="text-center py-12">
        <FuelIcon size={32} className="mx-auto text-nexus-text-faint mb-3 opacity-30" />
        <p className="text-sm text-nexus-text-faint">No fuel data yet.</p>
        <p className="text-xs text-nexus-text-faint mt-1">Log with: nexus usage &lt;session%&gt; &lt;weekly%&gt;</p>
      </div>
    );
  }

  const cs = workload?.currentSession;
  const wo = workload?.weeklyOutlook;
  const actionColors = { wrap_up: 'text-nexus-red', small_tasks: 'text-nexus-amber', medium_tasks: 'text-nexus-blue', full_capacity: 'text-nexus-green' };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <FuelIcon size={18} className="text-nexus-amber" />
          Fuel Management
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {timing?.plan ? `${timing.plan.label} (${timing.plan.multiplier}x) · ` : ''}
          {fuel?.estimated?.confidence === 'high' ? 'Fresh reading.' : `Estimated (${fuel?.reported?.minutesAgo ?? '?'}m since last report).`}
        </p>
      </div>

      {/* Main gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Session Fuel</span>
            <span className={`text-2xl font-light ${color(fuel.estimated.session)}`}>{fuel.estimated.session}%</span>
          </div>
          <Bar percent={fuel.estimated.session} height="h-3" />
          {fuel.session && (
            <div className="mt-3 space-y-1 text-xs font-mono text-nexus-text-faint">
              {fuel.session.constrainingFactor !== 'none' && <p><Clock size={10} className="inline mr-1" />{fuel.session.hoursRemaining}h runway ({fuel.session.minutesRemaining}m)</p>}
              {fuel.session.emptyAt && <p><TrendingDown size={10} className="inline mr-1" />Empty at {fuel.session.emptyAt}</p>}
              {fuel.session.resetWindow && <p>Window resets in {Math.floor(fuel.session.resetWindow / 60)}h {fuel.session.resetWindow % 60}m</p>}
            </div>
          )}
        </div>

        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Weekly Pool</span>
            <span className={`text-2xl font-light ${color(fuel.estimated.weekly)}`}>{fuel.estimated.weekly}%</span>
          </div>
          <Bar percent={fuel.estimated.weekly} height="h-3" />
          {fuel.weekly && (
            <div className="mt-3 space-y-1 text-xs font-mono text-nexus-text-faint">
              <p>~{fuel.weekly?.sessionsLeft ?? '?'} sessions until Thursday reset</p>
              {fuel.weekly?.note && <p>{fuel.weekly.note}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Burn rate + workload */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Burn rate */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={14} className="text-nexus-amber" />
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Burn Rate</span>
          </div>
          <p className="text-2xl font-light text-nexus-text">{fuel.rates.sessionPerHour}%<span className="text-sm text-nexus-text-faint">/h</span></p>
          <p className="text-xs font-mono text-nexus-text-faint mt-1">~{fuel.session?.chunksRemaining || '?'} work chunks of 15min</p>
        </div>

        {/* Workload recommendation */}
        {cs?.recommendation && (
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-nexus-amber" />
              <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Workload Advisor</span>
            </div>
            <p className={`text-sm font-medium ${actionColors[cs.recommendation.action] || 'text-nexus-text'}`}>
              {cs.recommendation.action.replace(/_/g, ' ').toUpperCase()}
            </p>
            <p className="text-xs text-nexus-text-dim mt-1">{cs.recommendation.message}</p>
          </div>
        )}
      </div>

      {/* Task capacity table */}
      {cs?.taskCapacity && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Task Capacity (This Session)</span>
          </div>
          <div className="space-y-2">
            {Object.entries(cs.taskCapacity).map(([type, info]) => (
              <div key={type} className="flex items-center gap-3">
                <span className="text-xs font-mono text-nexus-text-faint w-14">{type}</span>
                <div className="flex-1 h-2 bg-nexus-bg rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${info.count > 0 ? 'bg-nexus-green' : 'bg-nexus-border'}`}
                    style={{ width: `${Math.min(100, info.count * 20)}%` }} />
                </div>
                <span className={`text-xs font-mono w-6 text-right ${info.count > 0 ? 'text-nexus-green' : 'text-nexus-red'}`}>×{info.count}</span>
                <span className="text-[10px] text-nexus-text-faint w-20 text-right">~{info.fuelEach}% ea</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History sparkline */}
      {history && !history.insufficient && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Session History</span>
          </div>
          <div className="space-y-2">
            {history.sessionStats?.slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-nexus-text-faint w-20">{s.date || `Session ${i + 1}`}</span>
                <Bar percent={100 - s.burned} className="flex-1" />
                <span className="text-nexus-text-dim w-24 text-right">{s.burned}% in {s.duration}h</span>
                <span className="text-nexus-text-faint w-14 text-right">{s.rate}%/h</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-mono text-nexus-text-faint mt-2">Avg: {history.averageBurnRate}%/h across {history.sessionsDetected} sessions</p>
        </div>
      )}
    </div>
  );
}
