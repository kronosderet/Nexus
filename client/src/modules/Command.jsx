import { useState, useEffect, useMemo } from 'react';
import {
  Compass, Activity, Brain, TrendingUp, Package, CheckCircle2, Clock,
  AlertTriangle, Sparkles, ArrowRight, Loader2, RefreshCw, Target,
  Layers, Plus, Trash2, GripVertical, Search, Filter,
} from 'lucide-react';
import { api } from '../hooks/useApi.js';

// ── Shared helpers ──────────────────────────────────────

function parsePlanTasks(aiPlan) {
  if (!aiPlan || typeof aiPlan !== 'string') return [];
  const match = aiPlan.match(/##\s*TASKS\s*\n([\s\S]*?)(?:\n##|$)/i);
  if (!match) return [];
  const items = [];
  const lines = match[1].split('\n');
  let current = null;
  for (const line of lines) {
    const numbered = line.match(/^\s*\d+\.\s*(.*)/);
    if (numbered) { if (current) items.push(current); current = numbered[1].trim(); }
    else if (current && line.trim()) current += ' ' + line.trim();
  }
  if (current) items.push(current);
  return items.slice(0, 6);
}

function planFocus(aiPlan) {
  if (!aiPlan || typeof aiPlan !== 'string') return '';
  const match = aiPlan.match(/##\s*PLAN\s*\n([\s\S]*?)(?:\n##|$)/i);
  return match ? match[1].trim().split('\n')[0] : '';
}

function minutesAgo(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 0 || diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)}m ago`;
  const h = diff / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function groupByProject(tasks) {
  const groups = {};
  for (const t of tasks) {
    const tag = t.title.match(/^\[([A-Za-z][A-Za-z0-9-]+)\]/i);
    const key = tag ? tag[1].split('-')[0].toUpperCase() : 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
}

const CATEGORY_LABEL = { drift: 'Drift', blind_spot: 'Blind spot', orphan: 'Orphan', unvalidated: 'Unvalidated', stale: 'Stale', blocker: 'Blocker' };
const CATEGORY_COLOR = { drift: 'text-nexus-amber', blind_spot: 'text-nexus-red', orphan: 'text-nexus-blue', unvalidated: 'text-nexus-purple', stale: 'text-nexus-text-faint', blocker: 'text-nexus-red' };

const PRIORITY_STYLE = {
  2: { label: 'HIGH', dot: 'bg-nexus-red', text: 'text-nexus-red' },
  1: { label: 'MED', dot: 'bg-nexus-amber', text: 'text-nexus-amber' },
  0: { label: '', dot: '', text: '' },
};

const COLUMNS = [
  { key: 'backlog', label: 'Backlog', color: 'border-nexus-text-faint' },
  { key: 'in_progress', label: 'In Progress', color: 'border-nexus-amber' },
  { key: 'review', label: 'Review', color: 'border-nexus-blue' },
  { key: 'done', label: 'Done', color: 'border-nexus-green' },
];

// ── Main module ─────────────────────────────────────────

export default function Command({ ws }) {
  const [view, setView] = useState('strategic'); // strategic | kanban
  const [tasks, setTasks] = useState([]);
  const [thoughts, setThoughts] = useState([]);
  const [plan, setPlan] = useState(null);
  const [predict, setPredict] = useState(null);
  const [critique, setCritique] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [fuel, setFuel] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [kanbanSearch, setKanbanSearch] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTo, setAddingTo] = useState(null);

  async function fetchAll() {
    try {
      const [t, th, p, c, f, w, act] = await Promise.all([
        api.getTasks(),
        api.getThoughts().catch(() => []),
        api.getPredict().catch(() => ({ suggestions: [] })),
        api.getCritique().catch(() => ({ slowTasks: [] })),
        api.getEstimator().catch(() => null),
        api.getEstimatorWorkload().catch(() => null),
        api.getActivity(10).catch(() => []),
      ]);
      setTasks(t || []);
      setThoughts(Array.isArray(th) ? th : []);
      setPredict(p);
      setCritique(c);
      setFuel(f);
      setWorkload(w);
      setRecentActivity(act || []);
    } catch {} finally { setLoading(false); }
  }

  async function fetchPlan() {
    setLoadingPlan(true);
    try {
      const p = await api.getPlan();
      setPlan(p);
      try { localStorage.setItem('nexus-plan-cache', JSON.stringify(p)); } catch {}
    } catch {} finally { setLoadingPlan(false); }
  }

  useEffect(() => {
    fetchAll();
    // Restore cached plan so Next panel isn't empty on load
    try {
      const cached = localStorage.getItem('nexus-plan-cache');
      if (cached) setPlan(JSON.parse(cached));
    } catch {}
  }, []);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'task_update') {
        setTasks(prev => { const idx = prev.findIndex(t => t.id === msg.payload.id); if (idx >= 0) { const next = [...prev]; next[idx] = msg.payload; return next; } return [...prev, msg.payload]; });
      }
      if (msg.type === 'task_deleted') setTasks(prev => prev.filter(t => t.id !== msg.payload.id));
      if (msg.type === 'thought' || msg.type === 'activity') fetchAll();
      if (msg.type === 'reload') fetchAll();
    });
  }, [ws]);

  useEffect(() => {
    const clear = () => setDraggingId(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  // Task mutations (shared between both views)
  async function handleAdd(status) {
    if (!newTaskTitle.trim()) return;
    try {
      await api.createTask({ title: newTaskTitle.trim(), status });
      setNewTaskTitle('');
      setAddingTo(null);
      fetchAll();
    } catch {}
  }
  async function handleUpdate(id, updates) { await api.updateTask(id, updates); }
  async function handleDelete(id) { await api.deleteTask(id); }
  async function handleDrop(taskId, newStatus) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    await api.updateTask(taskId, { status: newStatus });
  }

  // Hooks MUST be before any early return (React rules of hooks)
  const projects = useMemo(() => {
    const set = new Set();
    for (const t of tasks) {
      const tag = t.title.match(/^\[([A-Za-z][A-Za-z0-9-]+)\]/i);
      if (tag) set.add(tag[1].split('-')[0].toUpperCase());
    }
    return ['all', ...Array.from(set).sort()];
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (projectFilter !== 'all') {
      list = list.filter(t => {
        const tag = t.title.match(/^\[([A-Za-z][A-Za-z0-9-]+)\]/i);
        const key = tag ? tag[1].split('-')[0].toUpperCase() : 'OTHER';
        return key === projectFilter || (!tag && projectFilter === 'OTHER');
      });
    }
    if (kanbanSearch.trim()) {
      const q = kanbanSearch.trim().toLowerCase();
      list = list.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [tasks, projectFilter, kanbanSearch]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 justify-center h-64">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Taking bearings...</span>
      </div>
    );
  }

  // In-progress always shows ALL active work (unaffected by project filter / search)
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const backlog = filtered.filter(t => t.status === 'backlog');
  const done = filtered.filter(t => t.status === 'done');

  return (
    <div>
      {/* Header + view toggle + project filter */}
      <div className="mb-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
              <Compass size={18} className="text-nexus-amber" />
              Command
            </h2>
            <p className="text-xs font-mono text-nexus-text-faint mt-1">
              {inProgress.length} active, {backlog.length} plotted, {thoughts.length} held.
            </p>
          </div>
          <div className="flex gap-1">
            {[
              { key: 'strategic', label: 'Strategic', icon: Compass },
              { key: 'kanban', label: 'Kanban', icon: Target },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setView(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    view === tab.key ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
                  }`}>
                  <Icon size={12} />{tab.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* Project filter + search */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={10} className="text-nexus-text-faint" />
          {projects.map(p => (
            <button key={p} onClick={() => setProjectFilter(p)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition-colors ${
                projectFilter === p ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20' : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'
              }`}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
          {view === 'kanban' && (
            <div className="relative ml-auto">
              <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-nexus-text-faint" />
              <input value={kanbanSearch} onChange={e => setKanbanSearch(e.target.value)}
                placeholder="Search tasks..."
                className="bg-nexus-bg border border-nexus-border rounded-lg pl-7 pr-3 py-1 text-[10px] text-nexus-text font-mono focus:border-nexus-amber focus:outline-none w-40" />
            </div>
          )}
        </div>
      </div>

      {view === 'strategic' ? (
        <StrategicView
          tasks={tasks} inProgress={inProgress} backlog={backlog} done={done}
          thoughts={thoughts} plan={plan} predict={predict} critique={critique}
          fuel={fuel} workload={workload} recentActivity={recentActivity}
          loadingPlan={loadingPlan} onRefreshPlan={fetchPlan} onRefresh={fetchAll}
          onUpdate={handleUpdate}
        />
      ) : (
        <KanbanView
          tasks={tasks} draggingId={draggingId} setDraggingId={setDraggingId}
          newTaskTitle={newTaskTitle} setNewTaskTitle={setNewTaskTitle}
          addingTo={addingTo} setAddingTo={setAddingTo}
          onAdd={handleAdd} onUpdate={handleUpdate} onDelete={handleDelete} onDrop={handleDrop}
        />
      )}
    </div>
  );
}

// ── Strategic View (from Compass) ───────────────────────

function Panel({ title, icon: Icon, count, accent = 'text-nexus-amber', children }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 flex flex-col min-h-[260px]">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-nexus-border">
        <div className="flex items-center gap-2">
          <Icon size={14} className={accent} />
          <span className={`text-xs font-mono uppercase tracking-[0.15em] ${accent}`}>{title}</span>
        </div>
        {count != null && <span className="text-[10px] font-mono text-nexus-text-faint px-1.5 py-0.5 rounded bg-nexus-bg border border-nexus-border">{count}</span>}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, message }) {
  return <div className="text-center py-4 text-nexus-text-faint"><Icon size={14} className="mx-auto mb-1.5 opacity-40" /><p className="text-[10px] font-mono">{message}</p></div>;
}

function estimateMinutes(title, globalAvg = 35) {
  const t = (title || '').toLowerCase();
  if (t.includes('critical') || t.includes('major') || t.includes('refactor') || t.includes('rewrite')) return Math.round(globalAvg * 2.5);
  if (t.includes('phase') || t.includes('audit') || t.includes('restructure')) return Math.round(globalAvg * 2);
  if (t.includes('important') || t.includes('feature') || t.includes('build')) return Math.round(globalAvg * 1.3);
  if (t.includes('fix') || t.includes('polish') || t.includes('update') || t.includes('bump')) return Math.round(globalAvg * 0.5);
  if (t.includes('typo') || t.includes('rename') || t.includes('cleanup')) return Math.round(globalAvg * 0.3);
  return globalAvg;
}

function elapsedSince(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function LaterPanel({ backlog, onUpdate }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (p) => setExpanded(prev => ({ ...prev, [p]: !prev[p] }));

  return (
    <Panel title="Later" icon={Layers} accent="text-nexus-purple" count={backlog.length}>
      {backlog.length === 0 ? <EmptyState icon={Package} message="Empty backlog." /> : (
        <div className="space-y-3">
          {groupByProject(backlog).map(([project, tasks]) => {
            const isExpanded = expanded[project];
            const visible = isExpanded ? tasks : tasks.slice(0, 4);
            return (
              <div key={project}>
                <button onClick={() => toggle(project)} className="flex items-center gap-2 mb-1 w-full text-left">
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20">{project}</span>
                  <span className="text-[10px] font-mono text-nexus-text-faint">{tasks.length}</span>
                  <span className="text-[9px] text-nexus-text-faint ml-auto">{isExpanded ? '▾' : '▸'}</span>
                </button>
                {visible.map(t => {
                  const prio = PRIORITY_STYLE[t.priority] || PRIORITY_STYLE[0];
                  return (
                    <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded text-xs text-nexus-text-dim hover:bg-nexus-bg/50 group">
                      {prio.label && <span className={`text-[7px] font-mono ${prio.text}`}>{prio.label}</span>}
                      <span className="flex-1 min-w-0 truncate">{t.title}</span>
                      <button onClick={() => onUpdate(t.id, { status: 'in_progress' })}
                        className="opacity-0 group-hover:opacity-100 text-[9px] font-mono text-nexus-amber hover:text-nexus-text transition-all" title="Start working">
                        Start
                      </button>
                    </div>
                  );
                })}
                {!isExpanded && tasks.length > 4 && (
                  <button onClick={() => toggle(project)} className="text-[10px] font-mono text-nexus-text-faint pl-4 hover:text-nexus-amber">
                    +{tasks.length - 4} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function StrategicView({ tasks, inProgress, backlog, done, thoughts, plan, predict, critique, fuel, workload, recentActivity, loadingPlan, onRefreshPlan, onUpdate }) {
  const gaps = predict?.suggestions || [];
  const planTasks = parsePlanTasks(plan?.aiPlan);
  const focus = planFocus(plan?.aiPlan);

  const recentDone = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return done.filter(t => t.updated_at && new Date(t.updated_at).getTime() > cutoff)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [done]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* NOW — what CC is actually doing */}
      <Panel title="Now" icon={Activity} accent="text-nexus-green">
        {/* In-progress tasks with elapsed time + estimated cost */}
        {inProgress.length > 0 ? (
          <div className="mb-3">
            <span className="text-[10px] font-mono text-nexus-text-faint mb-1.5 block">Working On ({inProgress.length})</span>
            <div className="space-y-2">
              {inProgress.map(t => {
                const elapsed = elapsedSince(t.updated_at);
                const estMin = estimateMinutes(t.title, critique?.averageCompletionMinutes || 35);
                const elapsedMin = t.updated_at ? Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 60000) : 0;
                const progress = estMin > 0 ? Math.min(100, Math.round((elapsedMin / estMin) * 100)) : 0;
                return (
                  <div key={t.id} className="px-2.5 py-2.5 rounded-lg bg-nexus-amber/5 border border-nexus-amber/20">
                    <div className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-nexus-amber mt-1.5 shrink-0 animate-pulse" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-nexus-text">{t.title}</p>
                        {t.description && <p className="text-[10px] font-mono text-nexus-text-faint line-clamp-1 mt-0.5">{t.description}</p>}
                        <div className="flex gap-3 mt-1.5 text-[9px] font-mono text-nexus-text-faint">
                          {elapsed && <span className="flex items-center gap-1"><Clock size={8} /> {elapsed}</span>}
                          <span>~{estMin}m est.</span>
                          {fuel?.rates?.sessionPerHour > 0 && <span>~{Math.round(estMin * fuel.rates.sessionPerHour / 60)}% fuel</span>}
                        </div>
                        {/* Progress bar based on avg completion time */}
                        <div className="h-1 bg-nexus-bg rounded-full overflow-hidden mt-1.5">
                          <div className={`h-full rounded-full transition-all duration-1000 ${progress > 80 ? 'bg-nexus-amber' : 'bg-nexus-green'}`} style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="px-2.5 py-3 rounded-lg bg-nexus-bg/50 border border-nexus-border mb-3 text-center">
            <p className="text-[10px] font-mono text-nexus-text-faint">No tasks in progress</p>
            <p className="text-[9px] font-mono text-nexus-text-faint mt-0.5">Move a task to "In Progress" in Kanban view to track it here</p>
          </div>
        )}

        {/* Session work summary — always visible */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="bg-nexus-bg rounded-lg px-2 py-1.5 text-center">
            <p className={`text-lg font-light ${done.filter(t => t.updated_at && new Date(t.updated_at).toDateString() === new Date().toDateString()).length > 0 ? 'text-nexus-green' : 'text-nexus-text-faint'}`}>{done.filter(t => t.updated_at && new Date(t.updated_at).toDateString() === new Date().toDateString()).length}</p>
            <p className="text-[9px] font-mono text-nexus-text-faint">done today</p>
          </div>
          <div className="bg-nexus-bg rounded-lg px-2 py-1.5 text-center">
            <p className={`text-lg font-light ${tasks.filter(t => t.status === 'review').length > 0 ? 'text-nexus-blue' : 'text-nexus-text-faint'}`}>{tasks.filter(t => t.status === 'review').length}</p>
            <p className="text-[9px] font-mono text-nexus-text-faint">in review</p>
          </div>
          <div className="bg-nexus-bg rounded-lg px-2 py-1.5 text-center">
            <p className={`text-lg font-light ${inProgress.length > 0 ? 'text-nexus-amber' : 'text-nexus-text-faint'}`}>{inProgress.length}</p>
            <p className="text-[9px] font-mono text-nexus-text-faint">active</p>
          </div>
        </div>

        {/* Thought stack */}
        {thoughts.length > 0 && (
          <div className="mb-3 pt-2 border-t border-nexus-border">
            <span className="text-[10px] font-mono text-nexus-text-faint flex items-center gap-1 mb-1"><Brain size={9} /> Thoughts ({thoughts.length})</span>
            {thoughts.slice(0, 3).map((t, i) => (
              <div key={t.id} className={`flex items-start gap-1.5 px-2 py-1 rounded text-[11px] ${i === 0 ? 'bg-nexus-purple/5 border border-nexus-purple/20' : ''}`}>
                <span className="text-nexus-text-faint shrink-0">{i === 0 ? '▸' : `${i + 1}.`}</span>
                <span className="text-nexus-text-dim truncate">{t.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Live activity feed */}
        {recentActivity.length > 0 && (
          <div className="pt-2 border-t border-nexus-border">
            <span className="text-[10px] font-mono text-nexus-text-faint mb-1 block">Live</span>
            <div className="space-y-0.5">
              {recentActivity.slice(0, 4).map((a, i) => (
                <div key={a.id || i} className="flex items-start gap-2 text-[10px]">
                  <span className="text-nexus-text-faint w-10 shrink-0 font-mono">
                    {new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-nexus-text-dim truncate">{a.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* NEXT — with localStorage plan cache (#101) */}
      <Panel title="Next" icon={TrendingUp} accent="text-nexus-blue" count={planTasks.length + gaps.length}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-nexus-text-faint flex items-center gap-1"><Sparkles size={9} /> Session Plan</span>
          <button onClick={onRefreshPlan} disabled={loadingPlan} className="text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber disabled:opacity-40 flex items-center gap-1">
            {loadingPlan ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />} {plan ? 'Refresh' : 'Plan'}
          </button>
        </div>
        {!plan ? <EmptyState icon={Sparkles} message="Click Plan to generate." /> : (
          <>
            {focus && <p className="text-xs text-nexus-blue italic mb-2 px-2 py-1 bg-nexus-blue/5 border border-nexus-blue/20 rounded">{focus}</p>}
            {plan.generatedAt && <p className="text-[9px] font-mono text-nexus-text-faint mb-1">Generated {minutesAgo(plan.generatedAt)}</p>}
            <ol className="space-y-1">
              {planTasks.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-nexus-text-dim px-2 py-1 rounded hover:bg-nexus-bg/50">
                  <span className="text-nexus-blue font-mono shrink-0">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">{t}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {gaps.length > 0 && (
          <div className="pt-2 mt-2 border-t border-nexus-border">
            <span className="text-[10px] font-mono text-nexus-text-faint mb-1 block"><AlertTriangle size={9} className="inline mr-1" />Gaps ({gaps.length})</span>
            {gaps.slice(0, 4).map((g, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-1 rounded border border-nexus-border mb-1">
                <div className="flex-1 min-w-0">
                  <span className={`text-[9px] font-mono uppercase ${CATEGORY_COLOR[g.category] || 'text-nexus-text-faint'}`}>{CATEGORY_LABEL[g.category] || g.category}</span>
                  <p className="text-xs text-nexus-text-dim truncate">{g.title}</p>
                </div>
                <button onClick={() => { api.createTask({ title: g.title, description: g.reason, priority: g.priority || 1 }).then(() => fetchAll()).catch(() => {}); }}
                  className="text-nexus-text-faint hover:text-nexus-amber shrink-0" title="Create task from gap"><Plus size={10} /></button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* LATER — with expand/collapse + start action (#100) */}
      <LaterPanel backlog={backlog} onUpdate={onUpdate} />

      {/* DONE — with actual duration + today's stats (#102) */}
      <Panel title="Done" icon={CheckCircle2} accent="text-nexus-amber" count={recentDone.length}>
        {recentDone.length === 0 ? <EmptyState icon={CheckCircle2} message="Nothing completed recently." /> : (
          <div className="space-y-1">
            {recentDone.slice(0, 8).map(t => {
              // Calculate actual duration: created_at → updated_at
              const dur = (t.created_at && t.updated_at)
                ? Math.round((new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / 60000)
                : null;
              return (
                <div key={t.id} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-nexus-bg/50">
                  <CheckCircle2 size={10} className="text-nexus-green mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-nexus-text-dim truncate">{t.title}</p>
                    <div className="flex gap-2 text-[9px] font-mono text-nexus-text-faint">
                      <span>{minutesAgo(t.updated_at)}</span>
                      {dur != null && dur > 0 && <span>· took {dur < 60 ? `${dur}m` : `${Math.floor(dur/60)}h ${dur%60}m`}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Today's slowest (not all-time) */}
        {(() => {
          const today = new Date().toDateString();
          const todayDone = done
            .filter(t => t.updated_at && t.created_at && new Date(t.updated_at).toDateString() === today)
            .map(t => ({ ...t, dur: Math.round((new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / 60000) }))
            .filter(t => t.dur > 0)
            .sort((a, b) => b.dur - a.dur);
          return todayDone.length > 1 ? (
            <div className="pt-2 mt-2 border-t border-nexus-border">
              <span className="text-[10px] font-mono text-nexus-text-faint flex items-center gap-1 mb-1"><Clock size={9} /> Slowest Today</span>
              {todayDone.slice(0, 3).map(t => (
                <div key={t.id} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-nexus-amber shrink-0">⏱</span>
                  <span className="text-nexus-text-dim truncate flex-1">{t.title}</span>
                  <span className="text-nexus-text-faint shrink-0">{t.dur}m</span>
                </div>
              ))}
            </div>
          ) : null;
        })()}
      </Panel>
    </div>
  );
}

// ── Kanban View (from MissionBoard) ─────────────────────

function TaskCard({ task, onUpdate, onDelete, onDragStart }) {
  const prio = PRIORITY_STYLE[task.priority] || PRIORITY_STYLE[0];
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(task.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id); }}
      className="bg-nexus-surface border border-nexus-border rounded-lg p-3 hover:border-nexus-border-bright transition-colors group cursor-grab active:cursor-grabbing">
      <div className="flex items-start gap-2">
        <GripVertical size={12} className="text-nexus-text-faint opacity-0 group-hover:opacity-50 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {prio.label && <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${prio.text} bg-nexus-bg border border-current`}>{prio.label}</span>}
            <p className="text-sm text-nexus-text truncate">{task.title}</p>
          </div>
          {task.description && <p className="text-xs text-nexus-text-faint mt-1 line-clamp-2">{task.description}</p>}
        </div>
        <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this task?')) onDelete(task.id); }}
          className="opacity-0 group-hover:opacity-100 p-1 text-nexus-text-faint hover:text-nexus-red transition-all"><Trash2 size={12} /></button>
      </div>
      <div className="flex gap-1.5 mt-2 ml-5">
        {COLUMNS.map(col => (
          <button key={col.key} onClick={() => task.status !== col.key && onUpdate(task.id, { status: col.key })}
            className={`w-3 h-3 rounded-full transition-all ${task.status === col.key ? `${col.color.replace('border', 'bg')} scale-110` : 'bg-nexus-border hover:bg-nexus-border-bright'}`}
            title={col.label} />
        ))}
      </div>
    </div>
  );
}

function DropZone({ status, children, onDrop, isDragging }) {
  const [over, setOver] = useState(false);
  return (
    <div onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id) onDrop(id, status); }}
      className={`min-h-[150px] sm:min-h-[200px] rounded-lg transition-colors ${over ? 'bg-nexus-amber/5 ring-1 ring-nexus-amber/20' : ''} ${isDragging ? 'ring-1 ring-nexus-border ring-dashed' : ''}`}>
      {children}
    </div>
  );
}

function KanbanView({ tasks, draggingId, setDraggingId, newTaskTitle, setNewTaskTitle, addingTo, setAddingTo, onAdd, onUpdate, onDelete, onDrop }) {
  const [showAllDone, setShowAllDone] = useState(false);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {COLUMNS.map(col => {
        let colTasks = tasks.filter(t => t.status === col.key);
        // Limit Done column to 20 most recent unless expanded
        const totalDone = colTasks.length;
        if (col.key === 'done' && !showAllDone) {
          colTasks = [...colTasks].sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()).slice(0, 20);
        }
        return (
          <DropZone key={col.key} status={col.key} onDrop={onDrop} isDragging={draggingId !== null}>
            <div className={`border-t-2 ${col.color} pt-2 mb-3`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">{col.label}</span>
                <span className="text-xs font-mono text-nexus-text-faint">{colTasks.length}</span>
              </div>
            </div>
            <div className="space-y-2">
              {colTasks.map(task => <TaskCard key={task.id} task={task} onUpdate={onUpdate} onDelete={onDelete} onDragStart={setDraggingId} />)}
            </div>
            {/* Show more for Done column */}
            {col.key === 'done' && !showAllDone && totalDone > 20 && (
              <button onClick={() => setShowAllDone(true)} className="mt-2 w-full py-1.5 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber transition-colors">
                Show all {totalDone} (+{totalDone - 20} hidden)
              </button>
            )}
            {addingTo === col.key ? (
              <div className="mt-2">
                <input autoFocus className="w-full bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text placeholder:text-nexus-text-faint focus:border-nexus-amber focus:outline-none"
                  placeholder="New bearing..." value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onAdd(col.key); if (e.key === 'Escape') { setAddingTo(null); setNewTaskTitle(''); } }}
                  onBlur={() => { if (!newTaskTitle.trim()) setAddingTo(null); }} />
              </div>
            ) : (
              <button onClick={() => setAddingTo(col.key)} className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-xs text-nexus-text-faint hover:text-nexus-amber border border-dashed border-nexus-border hover:border-nexus-amber/30 rounded-lg transition-colors">
                <Plus size={12} /> Plot
              </button>
            )}
          </DropZone>
        );
      })}
    </div>
  );
}
