import { useState } from 'react';
import { Fuel as FuelIcon, Clock, Timer, Zap, TrendingUp, BarChart3, History, Info } from 'lucide-react';
import { useNexusFuel } from '../context/useNexus.js';

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
  const c = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className={`${height} bg-nexus-bg rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${barColor(c)}`} style={{ width: `${Math.max(2, c)}%` }} />
    </div>
  );
}

function usageIntensity(used) {
  if (used == null || used <= 0) return { label: 'Fresh', color: 'text-nexus-green' };
  if (used <= 25) return { label: 'Light', color: 'text-nexus-green' };
  if (used <= 50) return { label: 'Normal', color: 'text-nexus-amber' };
  if (used <= 75) return { label: 'Heavy', color: 'text-nexus-amber' };
  return { label: 'Critical', color: 'text-nexus-red' };
}

const PLAN_PRICING = { free: 'Free', pro: '$20/mo', max5: '$100/mo', max20: '$200/mo', team: '$25/seat', team_premium: '$100/seat', enterprise: 'Custom', api: 'Pay-per-token' };

function Stat({ label, value, sub, color: c }) {
  return (
    <div>
      <p className="text-[10px] font-mono text-nexus-text-faint mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${c || 'text-nexus-text'}`}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-nexus-text-faint">{sub}</p>}
    </div>
  );
}

export default function FuelModule() {
  // All fuel data from shared context — no local fetch, no ws.subscribe, no polling
  const { estimator, workload, timing: timingSlice, history: historySlice } = useNexusFuel();
  const [showAllSessions, setShowAllSessions] = useState(false);

  const fuel = estimator.data;
  const wl = workload.data;
  const timingData = timingSlice.data;
  const history = historySlice.data;

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
  const cs = wl?.currentSession;
  const sessionsLeft = fuel.weekly?.sessionsLeft;
  const plan = timingData?.timing?.plan;
  const sessionReset = timingData?.timing?.session;
  const weeklyReset = timingData?.timing?.weekly;
  const costs = fuel.costs;
  const capacity = fuel.capacity;
  const forecast = fuel.forecast;
  const freshness = fuel.estimated?.confidence === 'high' ? 'Fresh reading' : `${fuel.reported?.minutesAgo ?? '?'}m since report`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <FuelIcon size={18} className="text-nexus-amber" />
          Fuel Management
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">{freshness}</p>
      </div>

      {/* Plan context */}
      {plan && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Info size={12} className="text-nexus-amber" />
            <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Your Plan</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
            <span className="text-nexus-amber font-medium">{plan.label}</span>
            <span className="text-nexus-text-faint">{PLAN_PRICING[plan.name] || ''}</span>
            <span className="text-nexus-text-faint">{plan.multiplier}x capacity</span>
            <span className="text-nexus-text-faint">5h session windows</span>
            {weeklyReset && <span className="text-nexus-text-faint">Weekly resets {weeklyReset.resetsAt}</span>}
          </div>
        </div>
      )}

      {/* Main gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
              <p className="text-nexus-amber"><Timer size={10} className="inline mr-1" />Waiting for next session window</p>
            )}
            {(session <= 0 || timingData?.extra_usage) && <p className="text-nexus-red">On extra usage (session limit reached)</p>}
          </div>
        </div>

        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Weekly</span>
            <span className={`text-2xl font-light tabular-nums ${color(weekly)}`}>{weekly}%</span>
          </div>
          <Bar percent={weekly} height="h-3" />
          <div className="mt-3 space-y-1 text-xs font-mono text-nexus-text-faint">
            <p>All models: {weekly}% remaining</p>
            {timingData?.sonnet_weekly_percent != null && <p>Sonnet only: {Math.round(timingData.sonnet_weekly_percent)}% remaining</p>}
            {sessionsLeft != null && sessionsLeft > 0 && <p>~{sessionsLeft} sessions until reset</p>}
            {weeklyReset?.countdown && <p><Clock size={10} className="inline mr-1" />Resets {weeklyReset.countdown}</p>}
            {forecast && (
              <p className={forecast.status === 'warning' ? 'text-nexus-amber' : forecast.status === 'safe' ? 'text-nexus-green' : ''}>
                <TrendingUp size={10} className="inline mr-1" />{forecast.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* This Session */}
      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-nexus-amber" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">This Session</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Usage" value={intensity.label} sub={`${used}% consumed`} color={intensity.color} />
          <Stat label="Remaining" value={`${session}%`} sub={fuel.session?.hoursRemaining > 0 ? `~${fuel.session.hoursRemaining}h` : null} color={color(session)} />
          <Stat label="Capacity" value={
            cs?.recommendation?.action === 'wrap_up' ? 'Wrap Up' :
            cs?.recommendation?.action === 'small_tasks' ? 'Small Tasks' :
            cs?.recommendation?.action === 'medium_tasks' ? 'Medium Tasks' : 'Full Capacity'
          } sub={cs?.recommendation?.message} color={
            cs?.recommendation?.action === 'wrap_up' ? 'text-nexus-red' :
            cs?.recommendation?.action === 'small_tasks' ? 'text-nexus-amber' :
            cs?.recommendation?.action === 'medium_tasks' ? 'text-nexus-blue' : 'text-nexus-green'
          } />
          {capacity?.promptsRemaining != null && (
            <Stat label="Prompts left" value={`~${capacity.promptsRemaining}`}
              sub={capacity.tasksRemaining != null ? `~${capacity.tasksRemaining} tasks` : null} />
          )}
        </div>
      </div>

      {/* Learned Costs */}
      {costs && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-nexus-amber" />
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Learned Costs</span>
            <span className="text-[9px] font-mono text-nexus-text-faint ml-auto">from {costs.sampleSize} data points</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Per prompt" value={`~${costs.sessionPerPrompt}%`} sub={`~${costs.weeklyPerPrompt}% weekly`} />
            <Stat label="Per task" value={`~${costs.sessionPerTask}%`} sub={`~${costs.weeklyPerTask}% weekly`} />
            {capacity?.promptsRemaining != null && (
              <Stat label="Session budget" value={`${capacity.promptsRemaining} prompts`}
                sub={capacity.tasksRemaining != null ? `or ${capacity.tasksRemaining} tasks` : null} color="text-nexus-green" />
            )}
            {capacity?.weeklyTasksRemaining != null && (
              <Stat label="Weekly budget" value={`${capacity.weeklyTasksRemaining} tasks`} sub="across all sessions" />
            )}
          </div>
        </div>
      )}

      {/* Session History */}
      {history?.sessionStats?.length > 0 && (() => {
        const stats = [...history.sessionStats];
        const visible = showAllSessions ? stats : stats.slice(0, 5);
        const hasMore = stats.length > 5;
        return (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <History size={14} className="text-nexus-amber" />
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Session History</span>
            <span className="text-[9px] font-mono text-nexus-text-faint ml-auto">{stats.length} sessions</span>
          </div>
          <div className="space-y-2">
            {visible.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-nexus-text-faint w-20 shrink-0">{s.date}</span>
                <Bar percent={s.burned} className="flex-1" />
                <span className={`w-10 text-right tabular-nums ${s.burned > 75 ? 'text-nexus-amber' : 'text-nexus-text-dim'}`}>{s.burned}%</span>
                <span className="text-nexus-text-faint w-12 text-right">{s.duration}h</span>
                <span className="text-[10px] text-nexus-text-faint w-14 text-right">{s.reports} pts</span>
              </div>
            ))}
          </div>
          {hasMore && (
            <button onClick={() => setShowAllSessions(prev => !prev)}
              className="text-[10px] font-mono text-nexus-amber hover:text-nexus-text mt-2 transition-colors">
              {showAllSessions ? 'Show less' : `Show all ${stats.length} sessions`}
            </button>
          )}
          {history.sessionsDetected > 1 && (
            <p className="text-[10px] font-mono text-nexus-text-faint mt-2">
              Avg: {history.averageSessionDuration}h per session · {history.averageBurnRate}% avg burn
            </p>
          )}
        </div>
        );
      })()}
    </div>
  );
}
