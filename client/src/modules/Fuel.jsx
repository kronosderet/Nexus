import { useState, useEffect } from 'react';
import { Fuel as FuelIcon, Clock, TrendingDown, Zap, Timer } from 'lucide-react';
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
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className={`${height} bg-nexus-bg rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${barColor(clamped)}`} style={{ width: `${Math.max(2, clamped)}%` }} />
    </div>
  );
}

function usageIntensity(used) {
  // Based on % used this session (not rate — rate is meaningless for compute-proportional limits)
  if (used == null || used <= 0) return { label: 'Fresh', color: 'text-nexus-green' };
  if (used <= 25) return { label: 'Light', color: 'text-nexus-green' };
  if (used <= 50) return { label: 'Normal', color: 'text-nexus-amber' };
  if (used <= 75) return { label: 'Heavy', color: 'text-nexus-amber' };
  return { label: 'Critical', color: 'text-nexus-red' };
}

export default function FuelModule({ ws }) {
  const [fuel, setFuel] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [timing, setTiming] = useState(null);

  async function fetchAll() {
    try {
      const [f, w, t] = await Promise.all([
        api.getEstimator(),
        api.getEstimatorWorkload(),
        api.getUsageLatest().catch(() => null),
      ]);
      setFuel(f);
      setWorkload(w);
      if (t) setTiming(t);
    } catch (err) {
      console.error('Fuel fetch error', err);
    }
  }

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
        <p className="text-xs text-nexus-text-faint mt-1">Report usage: "session X% used, weekly Y% used"</p>
      </div>
    );
  }

  const session = fuel.estimated?.session ?? 0;
  const weekly = fuel.estimated?.weekly ?? 0;
  const used = Math.round(100 - session);
  const intensity = usageIntensity(used);
  const cs = workload?.currentSession;
  const sessionsLeft = fuel.weekly?.sessionsLeft;
  const planLabel = timing?.plan?.label;
  const sessionReset = timing?.session;
  const weeklyReset = timing?.weekly;
  const freshness = fuel.estimated?.confidence === 'high' ? 'Fresh reading' : `${fuel.reported?.minutesAgo ?? '?'}m since last report`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <FuelIcon size={18} className="text-nexus-amber" />
          Fuel Management
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {planLabel && <span className="text-nexus-amber">{planLabel}</span>}
          {planLabel && ' · '}{freshness}
        </p>
      </div>

      {/* Main gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Session */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Session</span>
            <span className={`text-2xl font-light tabular-nums ${color(session)}`}>{session}%</span>
          </div>
          <Bar percent={session} height="h-3" />
          <div className="mt-3 space-y-1 text-xs font-mono text-nexus-text-faint">
            {sessionReset?.countdown && !sessionReset?.expired && (
              <p><Timer size={10} className="inline mr-1" />Resets in {sessionReset.countdown}</p>
            )}
            {sessionReset?.expired && (
              <p className="text-nexus-amber"><Timer size={10} className="inline mr-1" />Session window expired — waiting for reset</p>
            )}
            {session === 0 && !sessionReset?.expired && (
              <p className="text-nexus-red">Session fuel depleted — on extra usage</p>
            )}
          </div>
        </div>

        {/* Weekly */}
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Weekly</span>
            <span className={`text-2xl font-light tabular-nums ${color(weekly)}`}>{weekly}%</span>
          </div>
          <Bar percent={weekly} height="h-3" />
          <div className="mt-3 space-y-1 text-xs font-mono text-nexus-text-faint">
            <p>All models: {weekly}% remaining</p>
            {sessionsLeft != null && <p>~{sessionsLeft} sessions until reset</p>}
            {weeklyReset?.countdown && <p><Clock size={10} className="inline mr-1" />Resets {weeklyReset.countdown}</p>}
          </div>
        </div>
      </div>

      {/* Session summary — one clean row */}
      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-nexus-amber" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">This Session</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Usage intensity */}
          <div>
            <p className="text-[10px] font-mono text-nexus-text-faint mb-1">Usage</p>
            <p className={`text-sm font-medium ${intensity.color}`}>{intensity.label}</p>
            <p className="text-[10px] font-mono text-nexus-text-faint">{used}% of session budget used</p>
          </div>

          {/* Used this session */}
          <div>
            <p className="text-[10px] font-mono text-nexus-text-faint mb-1">Session used</p>
            <p className="text-sm font-medium text-nexus-text">{Math.round(100 - session)}%</p>
            {fuel.session?.hoursRemaining != null && fuel.session.hoursRemaining > 0 && (
              <p className="text-[10px] font-mono text-nexus-text-faint">~{fuel.session.hoursRemaining}h remaining</p>
            )}
          </div>

          {/* Workload recommendation */}
          <div>
            <p className="text-[10px] font-mono text-nexus-text-faint mb-1">Capacity</p>
            {cs?.recommendation ? (
              <>
                <p className={`text-sm font-medium ${
                  cs.recommendation.action === 'wrap_up' ? 'text-nexus-red' :
                  cs.recommendation.action === 'small_tasks' ? 'text-nexus-amber' :
                  cs.recommendation.action === 'medium_tasks' ? 'text-nexus-blue' :
                  'text-nexus-green'
                }`}>
                  {cs.recommendation.action === 'wrap_up' ? 'Wrap Up' :
                   cs.recommendation.action === 'small_tasks' ? 'Small Tasks' :
                   cs.recommendation.action === 'medium_tasks' ? 'Medium Tasks' :
                   'Full Capacity'}
                </p>
                <p className="text-[10px] font-mono text-nexus-text-faint">{cs.recommendation.message}</p>
              </>
            ) : (
              <p className="text-sm font-medium text-nexus-text-faint">—</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
