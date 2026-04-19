import { useState } from 'react';
import {
  Fuel as FuelIcon, Clock, Timer, Zap,
  TrendingUp, TrendingDown, Minus,
  BarChart3, History, Info,
  Sunrise, Sun, Sunset, Moon,
  PieChart, Calendar, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useNexusFuel } from '../context/useNexus.js';
import FuelFreshnessStamp from '../components/FuelFreshnessStamp.jsx';

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

// Mirror of PLAN_INFO from server/lib/fuelConfig.ts — kept on the frontend so the "Compare all plans"
// view renders without a second fetch. Keep in sync with the server map.
const PLAN_DETAILS = [
  { name: 'free',         label: 'Free',          multiplier: 0.2, description: 'Limited usage, variable windows' },
  { name: 'pro',          label: 'Pro',           multiplier: 1.0, description: '~44k tokens per 5h window' },
  { name: 'max5',         label: 'Max 5x',        multiplier: 2.0, description: '~88k tokens per 5h window' },
  { name: 'max20',        label: 'Max 20x',       multiplier: 5.0, description: '~220k tokens per 5h window' },
  { name: 'team',         label: 'Team Standard', multiplier: 1.0, description: 'Same capacity as Pro' },
  { name: 'team_premium', label: 'Team Premium',  multiplier: 2.0, description: 'Same capacity as Max 5x' },
  { name: 'enterprise',   label: 'Enterprise',    multiplier: 5.0, description: 'Custom capacity' },
  { name: 'api',          label: 'API',           multiplier: 0,   description: 'Pay-per-token, no windows' },
];

const TIME_SLOT_ICONS = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };
const TIME_SLOT_LABELS = {
  morning: 'Morning (06–12)',
  afternoon: 'Afternoon (12–18)',
  evening: 'Evening (18–24)',
  night: 'Night (00–06)',
};

function TrendBadge({ trend }) {
  const cfg = {
    improving: { Icon: TrendingUp,   cls: 'text-nexus-green',    label: 'Improving' },
    stable:    { Icon: Minus,        cls: 'text-nexus-text-dim', label: 'Stable' },
    degrading: { Icon: TrendingDown, cls: 'text-nexus-red',      label: 'Degrading' },
  };
  const { Icon, cls, label } = cfg[trend] || cfg.stable;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono ${cls}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

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
  const { estimator, workload, timing: timingSlice, history: historySlice, fuelIntel } = useNexusFuel();
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);

  const fuel = estimator.data;
  const wl = workload.data;
  const timingData = timingSlice.data;
  const history = historySlice.data;
  const intel = fuelIntel.data;
  const patterns = intel?.patterns;
  const taskCosts = intel?.taskCosts;
  const weeklyPlan = intel?.weeklyPlan;

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
  return (
    <div>
      {/* Header — v4.3.9 #259: use shared FuelFreshnessStamp so Command view + Dashboard
          ClockWidget can reuse the same staleness-aware age indicator. */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <FuelIcon size={18} className="text-nexus-amber" />
          Fuel Management
        </h2>
        <p className="text-xs font-mono mt-1">
          <FuelFreshnessStamp fuel={fuel} />
        </p>
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
          {plan.description && (
            <p className="text-[10px] font-mono text-nexus-text-faint mt-2">{plan.description}</p>
          )}
          <button
            onClick={() => setShowAllPlans(p => !p)}
            className="flex items-center gap-1 text-[10px] font-mono text-nexus-amber hover:text-nexus-text mt-3 transition-colors"
          >
            {showAllPlans ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {showAllPlans ? 'Hide plan comparison' : 'Compare all plans'}
          </button>
          {showAllPlans && (
            <div className="mt-3 space-y-1">
              {PLAN_DETAILS.map(p => {
                const isCurrent = p.name === plan.name;
                return (
                  <div
                    key={p.name}
                    className={`flex items-center gap-3 text-[10px] font-mono ${isCurrent ? 'text-nexus-amber' : 'text-nexus-text-dim'}`}
                  >
                    <span className="w-24 font-medium">{p.label}</span>
                    <span className="w-20 text-nexus-text-faint">{PLAN_PRICING[p.name]}</span>
                    <span className="w-10 text-nexus-text-faint tabular-nums">{p.multiplier}x</span>
                    <span className="flex-1 text-nexus-text-faint">{p.description}</span>
                    {isCurrent && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-nexus-amber/20 text-nexus-amber">current</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
              // v4.3.9 #234 — "Waiting for next session window" was ambiguous. Users kept
              // thinking fuel was paused; it's not. Session window rolled over but usage
              // continues against weekly until a new reading is logged. Say what's true.
              <p className="text-nexus-amber"><Timer size={10} className="inline mr-1" />Session window expired · log a fresh reading to reset timer</p>
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

      {/* Session Patterns */}
      {patterns && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-nexus-amber" />
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Session Patterns</span>
            <span className="ml-auto"><TrendBadge trend={patterns.trend} /></span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Stat label="Analyzed" value={`${patterns.totalSessions}`} sub="sessions" />
            <Stat label="Avg burn rate" value={`${patterns.avgBurnRate}%/h`} />
            <Stat label="Avg duration" value={`${patterns.avgSessionDuration}h`} />
            <Stat label="Avg fuel/session" value={`${patterns.avgFuelPerSession}%`} />
          </div>

          <div className="space-y-2 mb-4">
            <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Time of Day</p>
            {(() => {
              const slotKeys = ['morning', 'afternoon', 'evening', 'night'];
              const activeSlots = slotKeys.filter(k => patterns.timeSlots?.[k]?.sessions > 0);
              if (activeSlots.length === 0) {
                return <p className="text-[10px] font-mono text-nexus-text-faint">No time-of-day data yet.</p>;
              }
              const maxBurn = Math.max(1, ...activeSlots.map(k => patterns.timeSlots[k].avgBurn ?? 0));
              return activeSlots.map(key => {
                const slot = patterns.timeSlots[key];
                const Icon = TIME_SLOT_ICONS[key];
                const pct = (slot.avgBurn / maxBurn) * 100;
                return (
                  <div key={key} className="flex items-center gap-3 text-xs font-mono">
                    <Icon size={12} className="text-nexus-text-faint" />
                    <span className="w-36 text-nexus-text-dim shrink-0">{TIME_SLOT_LABELS[key]}</span>
                    <Bar percent={pct} className="flex-1" />
                    <span className="w-12 text-right tabular-nums text-nexus-text-dim">{slot.avgBurn}%</span>
                    <span className="w-14 text-right text-nexus-text-faint">{slot.sessions} sess</span>
                  </div>
                );
              });
            })()}
          </div>

          {patterns.mostEfficient && patterns.leastEfficient && (
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-nexus-border">
              <div>
                <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Most efficient</p>
                <p className="text-sm font-medium text-nexus-green">{patterns.mostEfficient.burnRate}%/h</p>
                <p className="text-[10px] font-mono text-nexus-text-faint">{patterns.mostEfficient.duration}h session</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Least efficient</p>
                <p className="text-sm font-medium text-nexus-red">{patterns.leastEfficient.burnRate}%/h</p>
                <p className="text-[10px] font-mono text-nexus-text-faint">{patterns.leastEfficient.duration}h session</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Task Cost by Category */}
      {taskCosts && taskCosts.totalTasksAnalyzed > 0 && (() => {
        const entries = Object.entries(taskCosts.patterns || {}).sort((a, b) => b[1].avgCost - a[1].avgCost);
        if (entries.length === 0) return null;
        const maxCost = Math.max(1, ...entries.map(([, v]) => v.avgCost));
        return (
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <PieChart size={14} className="text-nexus-amber" />
              <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Task Cost by Category</span>
              <span className="text-[9px] font-mono text-nexus-text-faint ml-auto">from {taskCosts.totalTasksAnalyzed} tasks</span>
            </div>
            <div className="space-y-2">
              {entries.map(([cat, v]) => (
                <div key={cat} className="flex items-center gap-3 text-xs font-mono">
                  <span className="w-40 text-nexus-text-dim shrink-0">{cat}</span>
                  <Bar percent={(v.avgCost / maxCost) * 100} className="flex-1" />
                  <span className="w-12 text-right tabular-nums text-nexus-text-dim">{v.avgCost}%</span>
                  <span className="w-14 text-right text-nexus-text-faint">{v.count}×</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Weekly Budget */}
      {weeklyPlan && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={14} className="text-nexus-amber" />
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Weekly Budget</span>
            {weeklyPlan.trend && <span className="ml-auto"><TrendBadge trend={weeklyPlan.trend} /></span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Stat
              label="Sessions affordable"
              value={`${weeklyPlan.sessionsAffordable ?? '—'}`}
              sub="this week"
              color={
                weeklyPlan.sessionsAffordable > 5 ? 'text-nexus-green' :
                weeklyPlan.sessionsAffordable > 2 ? 'text-nexus-amber' :
                'text-nexus-red'
              }
            />
            <Stat label="Weekly cost" value={`~${weeklyPlan.weeklyPerSession ?? '—'}%`} sub="per session" />
            {weeklyPlan.backlog && (
              <>
                <Stat label="Backlog" value={`${weeklyPlan.backlog.total}`} sub={`${weeklyPlan.backlog.inProgress} in progress`} />
                <Stat label="Est. sessions" value={`~${weeklyPlan.backlog.estimatedSessions}`} sub="to clear backlog" />
              </>
            )}
          </div>
          {weeklyPlan.recommendation && (
            <p className={`text-xs font-mono ${
              weeklyPlan.sessionsAffordable > 5 ? 'text-nexus-green' :
              weeklyPlan.sessionsAffordable > 2 ? 'text-nexus-amber' :
              'text-nexus-red'
            }`}>{weeklyPlan.recommendation}</p>
          )}
          {weeklyPlan.optimalTiming && (
            <p className="text-[10px] font-mono text-nexus-text-faint mt-2">{weeklyPlan.optimalTiming}</p>
          )}
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
