import { useState, useEffect, useMemo } from 'react';
import {
  Compass as CompassIcon,
  Activity,
  Brain,
  TrendingUp,
  Package,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Loader2,
  RefreshCw,
  Target,
  Layers,
} from 'lucide-react';
import { api } from '../hooks/useApi.js';

// ── Helpers ──────────────────────────────────────────────

function parsePlanTasks(aiPlan) {
  if (!aiPlan || typeof aiPlan !== 'string') return [];
  // Grab the "## TASKS" section, split into numbered items
  const match = aiPlan.match(/##\s*TASKS\s*\n([\s\S]*?)(?:\n##|$)/i);
  if (!match) return [];
  const body = match[1];
  const items = [];
  const lines = body.split('\n');
  let current = null;
  for (const line of lines) {
    const numbered = line.match(/^\s*\d+\.\s*(.*)/);
    if (numbered) {
      if (current) items.push(current);
      current = numbered[1].trim();
    } else if (current && line.trim()) {
      current += ' ' + line.trim();
    }
  }
  if (current) items.push(current);
  return items.slice(0, 6);
}

function planFocus(aiPlan) {
  if (!aiPlan || typeof aiPlan !== 'string') return '';
  const match = aiPlan.match(/##\s*PLAN\s*\n([\s\S]*?)(?:\n##|$)/i);
  return match ? match[1].trim().split('\n')[0] : '';
}

function groupByProject(tasks) {
  const groups = {};
  for (const t of tasks) {
    // Try to detect project from title tag like [FW-DATA], [NX-*], else "Other"
    const tag = t.title.match(/^\[([A-Z][A-Z0-9-]+)\]/);
    const key = tag ? tag[1].split('-')[0] : 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length);
}

function minutesAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)}m ago`;
  const h = diff / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const CATEGORY_LABEL = {
  drift: 'Uncommitted drift',
  blind_spot: 'Blind spot',
  orphan: 'Orphan decision',
  unvalidated: 'Unvalidated',
  stale: 'Stale',
  blocker: 'Blocker',
};

const CATEGORY_COLOR = {
  drift: 'text-nexus-amber',
  blind_spot: 'text-nexus-red',
  orphan: 'text-nexus-blue',
  unvalidated: 'text-nexus-purple',
  stale: 'text-nexus-text-faint',
  blocker: 'text-nexus-red',
};

// ── Panels ───────────────────────────────────────────────

function Panel({ title, icon: Icon, count, accent = 'text-nexus-amber', children }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 flex flex-col min-h-[280px]">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-nexus-border">
        <div className="flex items-center gap-2">
          <Icon size={16} className={accent} />
          <span className={`text-xs font-mono uppercase tracking-[0.2em] ${accent}`}>
            {title}
          </span>
        </div>
        {count != null && (
          <span className="text-[10px] font-mono text-nexus-text-faint px-2 py-0.5 rounded bg-nexus-bg border border-nexus-border">
            {count}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="text-center py-6 text-nexus-text-faint">
      <Icon size={16} className="mx-auto mb-2 opacity-40" />
      <p className="text-xs font-mono">{message}</p>
    </div>
  );
}

// ── NOW panel ────────────────────────────────────────────

function NowPanel({ inProgress, thoughts, onRefresh }) {
  return (
    <Panel title="Now" icon={Activity} accent="text-nexus-green" count={inProgress.length + thoughts.length}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">
            In Progress
          </span>
          <span className="text-[10px] font-mono text-nexus-text-faint">{inProgress.length}</span>
        </div>
        {inProgress.length === 0 ? (
          <EmptyState icon={Target} message="No active bearings. Pick a task to begin." />
        ) : (
          <div className="space-y-1.5">
            {inProgress.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-nexus-amber/5 border border-nexus-amber/20"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-nexus-amber mt-1.5 shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-nexus-text truncate">{t.title}</p>
                  {t.description && (
                    <p className="text-[10px] font-mono text-nexus-text-faint line-clamp-1 mt-0.5">
                      {t.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 mt-3 border-t border-nexus-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider flex items-center gap-1">
            <Brain size={10} /> Thought Stack
          </span>
          <span className="text-[10px] font-mono text-nexus-text-faint">{thoughts.length}</span>
        </div>
        {thoughts.length === 0 ? (
          <EmptyState icon={Brain} message="Stack empty. No interrupted thoughts." />
        ) : (
          <div className="space-y-1">
            {thoughts.slice(0, 5).map((t, i) => (
              <div
                key={t.id}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border ${
                  i === 0
                    ? 'bg-nexus-purple/5 border-nexus-purple/20'
                    : 'border-nexus-border'
                }`}
              >
                <span className="text-[10px] font-mono text-nexus-text-faint shrink-0">
                  {i === 0 ? '▸' : `${i + 1}.`}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-nexus-text-dim truncate">{t.text}</p>
                  {t.context && (
                    <p className="text-[9px] font-mono text-nexus-text-faint italic truncate">
                      {t.context}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── NEXT panel ───────────────────────────────────────────

function NextPanel({ plan, predict, loadingPlan, onRefreshPlan }) {
  const tasks = parsePlanTasks(plan?.aiPlan);
  const focus = planFocus(plan?.aiPlan);
  const gaps = predict?.suggestions || [];

  return (
    <Panel title="Next" icon={TrendingUp} accent="text-nexus-blue" count={tasks.length + gaps.length}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider flex items-center gap-1">
            <Sparkles size={10} /> Session Plan
          </span>
          <button
            onClick={onRefreshPlan}
            disabled={loadingPlan}
            className="text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber disabled:opacity-40 flex items-center gap-1"
          >
            {loadingPlan ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />}
            {loadingPlan ? 'Planning...' : 'Plan'}
          </button>
        </div>
        {!plan ? (
          <EmptyState icon={Sparkles} message="Click Plan to generate a session plan." />
        ) : (
          <>
            {focus && (
              <p className="text-xs text-nexus-blue italic mb-2 px-2 py-1.5 bg-nexus-blue/5 border border-nexus-blue/20 rounded">
                {focus}
              </p>
            )}
            {plan.fuelState && (
              <div className="flex gap-3 text-[10px] font-mono text-nexus-text-faint mb-2 px-1">
                <span>Fuel: {plan.fuelState.session}%</span>
                <span>·</span>
                <span>Runway: {plan.fuelState.runwayMinutes}m</span>
              </div>
            )}
            {tasks.length === 0 ? (
              <EmptyState icon={Target} message="No planned tasks parsed." />
            ) : (
              <ol className="space-y-1">
                {tasks.map((t, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-nexus-text-dim px-2 py-1.5 rounded hover:bg-nexus-bg/50"
                  >
                    <span className="text-nexus-blue font-mono shrink-0">{i + 1}.</span>
                    <span className="min-w-0 flex-1 break-words">{t}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div className="pt-3 mt-3 border-t border-nexus-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle size={10} /> Predicted Gaps
          </span>
          <span className="text-[10px] font-mono text-nexus-text-faint">{gaps.length}</span>
        </div>
        {gaps.length === 0 ? (
          <EmptyState icon={CheckCircle2} message="Graph is healthy. No gaps detected." />
        ) : (
          <div className="space-y-1.5">
            {gaps.slice(0, 5).map((g, i) => (
              <div key={i} className="px-2 py-1.5 rounded border border-nexus-border">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[9px] font-mono uppercase ${CATEGORY_COLOR[g.category] || 'text-nexus-text-faint'}`}>
                    {CATEGORY_LABEL[g.category] || g.category}
                  </span>
                  {g.project && (
                    <span className="text-[9px] font-mono text-nexus-text-faint">· {g.project}</span>
                  )}
                </div>
                <p className="text-xs text-nexus-text-dim truncate">{g.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── LATER panel ──────────────────────────────────────────

function LaterPanel({ backlog }) {
  const groups = useMemo(() => groupByProject(backlog), [backlog]);

  return (
    <Panel title="Later" icon={Layers} accent="text-nexus-purple" count={backlog.length}>
      {backlog.length === 0 ? (
        <EmptyState icon={Package} message="Empty backlog. Calm waters." />
      ) : (
        <div className="space-y-4">
          {groups.map(([project, tasks]) => (
            <div key={project}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20">
                  {project}
                </span>
                <span className="text-[10px] font-mono text-nexus-text-faint">{tasks.length}</span>
              </div>
              <div className="space-y-1">
                {tasks.slice(0, 4).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-2 px-2 py-1 rounded text-xs text-nexus-text-dim hover:bg-nexus-bg/50"
                  >
                    <ArrowRight size={10} className="text-nexus-text-faint mt-0.5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  </div>
                ))}
                {tasks.length > 4 && (
                  <p className="text-[10px] font-mono text-nexus-text-faint pl-4">
                    +{tasks.length - 4} more
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── DONE panel ───────────────────────────────────────────

function DonePanel({ done, critique }) {
  const recent = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return done
      .filter((t) => t.updated_at && new Date(t.updated_at).getTime() > cutoff)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [done]);

  const slowest = critique?.slowTasks?.filter((t) => t.status === 'done').slice(0, 3) || [];

  return (
    <Panel title="Done" icon={CheckCircle2} accent="text-nexus-amber" count={recent.length}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">
            Last 24 hours
          </span>
          <span className="text-[10px] font-mono text-nexus-text-faint">{recent.length}</span>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon={CheckCircle2} message="Nothing completed in last 24h." />
        ) : (
          <div className="space-y-1">
            {recent.slice(0, 6).map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-nexus-bg/50"
              >
                <CheckCircle2 size={10} className="text-nexus-green mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-nexus-text-dim truncate">{t.title}</p>
                  <p className="text-[9px] font-mono text-nexus-text-faint">
                    {minutesAgo(t.updated_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {slowest.length > 0 && (
        <div className="pt-3 mt-3 border-t border-nexus-border">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={10} className="text-nexus-amber" />
            <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">
              Took Longest
            </span>
          </div>
          <div className="space-y-1">
            {slowest.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-nexus-amber shrink-0">⏱</span>
                <span className="text-nexus-text-dim truncate flex-1">{t.title}</span>
                <span className="text-nexus-text-faint shrink-0">{t.minutes}m</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Main module ──────────────────────────────────────────

export default function Compass({ ws }) {
  const [tasks, setTasks] = useState([]);
  const [thoughts, setThoughts] = useState([]);
  const [plan, setPlan] = useState(null);
  const [predict, setPredict] = useState(null);
  const [critique, setCritique] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);

  async function fetchAll() {
    try {
      const [t, th, p, c] = await Promise.all([
        api.getTasks(),
        api.getThoughts().catch(() => []),
        api.getPredict().catch(() => ({ suggestions: [] })),
        api.getCritique().catch(() => ({ slowTasks: [] })),
      ]);
      setTasks(t || []);
      setThoughts(Array.isArray(th) ? th : []);
      setPredict(p);
      setCritique(c);
    } catch (err) {
      console.error('Compass fetch failed', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPlan() {
    setLoadingPlan(true);
    try {
      const p = await api.getPlan();
      setPlan(p);
    } catch (err) {
      console.error('Plan fetch failed', err);
    } finally {
      setLoadingPlan(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // Real-time refresh on task/thought changes
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (
        msg.type === 'task_update' ||
        msg.type === 'task_deleted' ||
        msg.type === 'thought' ||
        msg.type === 'activity'
      ) {
        fetchAll();
      }
    });
  }, [ws]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 justify-center h-64">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Taking bearings...</span>
      </div>
    );
  }

  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const backlog = tasks.filter((t) => t.status === 'backlog');
  const done = tasks.filter((t) => t.status === 'done');

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <CompassIcon size={18} className="text-nexus-amber" />
          Compass
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          Strategic bearings. {inProgress.length} active, {backlog.length} plotted, {thoughts.length} held.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <NowPanel inProgress={inProgress} thoughts={thoughts} onRefresh={fetchAll} />
        <NextPanel plan={plan} predict={predict} loadingPlan={loadingPlan} onRefreshPlan={fetchPlan} />
        <LaterPanel backlog={backlog} />
        <DonePanel done={done} critique={critique} />
      </div>
    </div>
  );
}
