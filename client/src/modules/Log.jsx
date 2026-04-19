import { useState, useMemo } from 'react';
import { api } from '../hooks/useApi.js';
import { useNexusCore } from '../context/useNexus.js';
import {
  ScrollText, BookOpen, Compass, CheckCircle2, Trash2, Settings,
  FileEdit, AlertTriangle, Tag, ChevronDown, ChevronRight, Search, Filter,
  Clock, MapPin, Lightbulb, Brain, MessageSquare, Network, GitCommit,
  Download, Rocket, BookMarked,
} from 'lucide-react';

// ── Activity type config ────────────────────────────────
// v4.4.1 #355 — distinct icon + color per event type so rows scan by shape/color,
// not just by reading. Expanded to cover all types store.ts emits (graph, git_commit,
// git_fetch, memory_import) — previously missing entries fell through to "system".
// Some types sharpened: task_created uses MapPin (plot pin), decision uses Lightbulb,
// thought uses Brain, prompt uses MessageSquare. Compass kept for command/navigation
// actions only.

const TYPE_CONFIG = {
  task_created: { icon: MapPin, color: 'text-nexus-amber', label: 'Plotted', module: 'command' },
  task_done: { icon: CheckCircle2, color: 'text-nexus-green', label: 'Landmark', module: 'command' },
  task_moved: { icon: Compass, color: 'text-nexus-blue', label: 'Course adjusted', module: 'command' },
  task_deleted: { icon: Trash2, color: 'text-nexus-red', label: 'Removed', module: 'command' },
  system: { icon: Settings, color: 'text-nexus-purple', label: 'System', module: null },
  file_change: { icon: FileEdit, color: 'text-nexus-amber', label: 'Terrain shift', module: null },
  error: { icon: AlertTriangle, color: 'text-nexus-red', label: 'Uncharted', module: null },
  auto_summary: { icon: BookOpen, color: 'text-nexus-green', label: 'Auto-summary', module: 'log' },
  thought: { icon: Brain, color: 'text-nexus-purple', label: 'Thought', module: null },
  prompt: { icon: MessageSquare, color: 'text-nexus-blue', label: 'Prompt', module: null },
  session: { icon: BookOpen, color: 'text-nexus-green', label: 'Session', module: 'log' },
  decision: { icon: Lightbulb, color: 'text-nexus-amber', label: 'Decision', module: 'graph' },
  predict: { icon: AlertTriangle, color: 'text-nexus-blue', label: 'Predict', module: 'overseer' },
  deploy: { icon: Rocket, color: 'text-nexus-green', label: 'Deploy', module: null },
  graph: { icon: Network, color: 'text-nexus-purple', label: 'Graph', module: 'graph' },
  git_commit: { icon: GitCommit, color: 'text-nexus-green', label: 'Commit', module: null },
  git_fetch: { icon: Download, color: 'text-nexus-blue', label: 'Fetched', module: null },
  memory_import: { icon: BookMarked, color: 'text-nexus-amber', label: 'Imported', module: 'graph' },
};

function formatTime(dateStr) { return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function formatDate(dateStr) {
  const d = new Date(dateStr); const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Session card ────────────────────────────────────────

function SessionCard({ session }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = session.decisions?.length > 0 || session.blockers?.length > 0 || session.files_touched?.length > 0;
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-lg p-4 hover:border-nexus-border-bright transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20">{session.project}</span>
        <span className="text-xs font-mono text-nexus-text-faint">{formatDate(session.created_at)} {formatTime(session.created_at)}</span>
      </div>
      <p className="text-sm text-nexus-text leading-relaxed">{session.summary}</p>
      {session.tags?.length > 0 && (
        <div className="flex gap-1.5 mt-2">
          {session.tags.map((tag, i) => (
            <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20"><Tag size={8} />{tag}</span>
          ))}
        </div>
      )}
      {hasDetails && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 mt-2 text-xs text-nexus-text-faint hover:text-nexus-text transition-colors">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Details
          </button>
          {expanded && (
            <div className="mt-2 space-y-2 pl-3 border-l-2 border-nexus-border">
              {session.decisions?.length > 0 && <div><span className="text-xs font-mono text-nexus-green">Decisions:</span><ul className="mt-0.5">{session.decisions.map((d, i) => <li key={i} className="text-xs text-nexus-text-dim">• {d}</li>)}</ul></div>}
              {session.blockers?.length > 0 && <div><span className="text-xs font-mono text-nexus-amber flex items-center gap-1"><AlertTriangle size={10} />Blockers:</span><ul className="mt-0.5">{session.blockers.map((b, i) => <li key={i} className="text-xs text-nexus-text-dim">• {b}</li>)}</ul></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main module ─────────────────────────────────────────

export default function Log({ onNavigate }) {
  const { activity: activitySlice, sessions: sessionsSlice } = useNexusCore();
  const [tab, setTab] = useState('activity');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('desc');
  const [projectFilter, setProjectFilter] = useState('');
  const [blockersOnly, setBlockersOnly] = useState(false);
  // v4.4.1 #356 — client-side page size for the activity stream. Store keeps 500-750
  // entries; this lets users page beyond the initial 200 cap without a server refetch.
  const [pageSize, setPageSize] = useState(200);

  const entries = activitySlice.data || [];
  const sessions = sessionsSlice.data || [];
  const loadingA = activitySlice.loading;
  const loadingS = sessionsSlice.loading;

  // Filtered activity
  const typesPresent = useMemo(() => ['all', ...new Set(entries.map(e => e.type)).values()].sort(), [entries]);
  const filteredActivityAll = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (q && !e.message.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => sortOrder === 'asc'
      ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [entries, search, typeFilter, sortOrder]);
  // v4.4.1 #356 — paginate the filtered stream. filteredActivity is what renders; the
  // "Load N more" button grows pageSize until all filtered entries are visible.
  const filteredActivity = useMemo(() => filteredActivityAll.slice(0, pageSize), [filteredActivityAll, pageSize]);

  // Filtered sessions
  const projects = useMemo(() => [...new Set(sessions.map(s => s.project))], [sessions]);
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sessions;
    if (projectFilter) list = list.filter(s => s.project === projectFilter);
    if (blockersOnly) list = list.filter(s => s.blockers?.length > 0);
    if (q) list = list.filter(s => [s.summary, s.project, ...(s.tags || []), ...(s.decisions || [])].join(' ').toLowerCase().includes(q));
    return [...list].sort((a, b) => sortOrder === 'asc'
      ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [sessions, search, projectFilter, blockersOnly, sortOrder]);

  // Group activity by date
  const groupedActivity = useMemo(() => {
    const grouped = {};
    for (const e of filteredActivity) { const k = formatDate(e.created_at); if (!grouped[k]) grouped[k] = []; grouped[k].push(e); }
    return grouped;
  }, [filteredActivity]);

  const loading = tab === 'activity' ? loadingA : loadingS;

  return (
    <div>
      {/* Header + tabs */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
            <ScrollText size={18} className="text-nexus-amber" />
            Log
          </h2>
          <p className="text-xs font-mono text-nexus-text-faint mt-1">
            {tab === 'timeline' ? `${entries.length + sessions.length} events` : tab === 'activity' ? `${filteredActivity.length} of ${filteredActivityAll.length} entries (${entries.length} total)` : `${filteredSessions.length} of ${sessions.length} sessions`}
          </p>
        </div>
        <div className="flex gap-1">
          {[{ key: 'timeline', label: 'Timeline', icon: Clock }, { key: 'activity', label: 'Activity', icon: ScrollText }, { key: 'sessions', label: 'Sessions', icon: BookOpen }].map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                  tab === t.key ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
                }`}>
                <Icon size={12} />{t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Shared search + sort */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === 'activity' ? 'Search messages...' : 'Search summaries, tags, decisions...'}
              className="w-full bg-nexus-bg border border-nexus-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-nexus-text font-mono focus:border-nexus-amber focus:outline-none" />
          </div>
          <button onClick={() => setSortOrder(s => s === 'desc' ? 'asc' : 'desc')}
            className="px-3 py-1.5 rounded-lg text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber border border-nexus-border transition-colors">
            {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
          {tab === 'sessions' && (
            <button onClick={() => setBlockersOnly(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-colors flex items-center gap-1 ${blockersOnly ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20' : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'}`}>
              <AlertTriangle size={10} /> Blockers
            </button>
          )}
        </div>

        {/* Type chips (activity) or project chips (sessions) */}
        {tab === 'activity' ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Filter size={10} className="text-nexus-text-faint" />
            {typesPresent.map(type => (
              <button key={type} onClick={() => setTypeFilter(type)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition-colors ${typeFilter === type ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20' : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'}`}>
                {type === 'all' ? 'All' : (TYPE_CONFIG[type]?.label || type)}
              </button>
            ))}
          </div>
        ) : projects.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setProjectFilter('')}
              className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${!projectFilter ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'}`}>
              All
            </button>
            {projects.map(p => (
              <button key={p} onClick={() => setProjectFilter(p)}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${projectFilter === p ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'}`}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-3 h-64 justify-center">
          <div className="text-2xl animate-compass text-nexus-amber">◈</div>
          <span className="font-mono text-sm text-nexus-text-dim">Scanning the archives...</span>
        </div>
      ) : tab === 'timeline' ? (
        <TimelineView entries={entries} sessions={sessions} search={search} />
      ) : tab === 'activity' ? (
        /* ── Activity stream ─── */
        filteredActivity.length === 0 ? (
          <div className="text-center py-12 bg-nexus-surface border border-nexus-border rounded-xl">
            <ScrollText size={24} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
            <p className="text-xs font-mono text-nexus-text-faint">No entries match.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* v4.4.1 #356 — Load-more footer. Renders below the day groups once there
                are more filtered entries than currently visible. Simple pagination
                growing client-side slice. */}
            {Object.entries(groupedActivity).map(([date, items]) => (
              <div key={date}>
                <div className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider mb-2 sticky top-0 bg-nexus-bg py-1">{date}</div>
                <div className="space-y-1">
                  {items.map(entry => {
                    const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.system;
                    const Icon = config.icon;
                    // v4.4.1 #354 — click-through: types with a `module` map navigate on click.
                    // Types with `module: null` (system, error, file_change, etc.) stay read-only.
                    const clickable = !!(config.module && onNavigate);
                    const Tag = clickable ? 'button' : 'div';
                    const onClick = clickable ? () => onNavigate(config.module) : undefined;
                    return (
                      <Tag
                        key={entry.id}
                        {...(clickable ? { onClick, type: 'button' } : {})}
                        className={`flex items-start gap-3 py-2 px-3 rounded-lg transition-colors w-full text-left ${clickable ? 'hover:bg-nexus-surface cursor-pointer' : 'hover:bg-nexus-surface/50'}`}
                        title={clickable ? `Click to open ${config.module}` : undefined}
                      >
                        <span className="text-xs font-mono text-nexus-text-faint w-12 pt-0.5 shrink-0">{formatTime(entry.created_at)}</span>
                        <Icon size={14} className={`${config.color} mt-0.5 shrink-0`} />
                        <span className="text-sm text-nexus-text-dim">{entry.message}</span>
                      </Tag>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* v4.4.1 #356 — Load-more button appears when there are more entries than shown */}
            {filteredActivity.length < filteredActivityAll.length && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => setPageSize(n => n + 200)}
                  className="px-4 py-2 rounded-lg text-xs font-mono text-nexus-amber hover:bg-nexus-amber/10 border border-nexus-amber/20 transition-colors"
                >
                  Load {Math.min(200, filteredActivityAll.length - filteredActivity.length)} more
                  <span className="text-nexus-text-faint ml-2">
                    ({filteredActivityAll.length - filteredActivity.length} hidden)
                  </span>
                </button>
              </div>
            )}
          </div>
        )
      ) : (
        /* ── Sessions list ─── */
        filteredSessions.length === 0 ? (
          <div className="text-center py-12 bg-nexus-surface border border-nexus-border rounded-xl">
            <BookOpen size={24} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
            <p className="text-xs font-mono text-nexus-text-faint">No sessions match.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSessions.map(s => <SessionCard key={s.id} session={s} />)}
          </div>
        )
      )}
    </div>
  );
}

// ── Timeline View ─────────────────────────────────────────
function TimelineView({ entries, sessions, search }) {
  const q = search.toLowerCase();
  const [expanded, setExpanded] = useState({});

  const timeline = useMemo(() => {
    const items = [];
    for (const e of entries) {
      if (q && !e.message.toLowerCase().includes(q)) continue;
      const config = TYPE_CONFIG[e.type] || TYPE_CONFIG.system;
      items.push({
        time: e.created_at, kind: e.type === 'task_done' ? 'task' : e.type === 'decision' ? 'decision' : 'activity',
        icon: config.icon, color: config.color, label: config.label, text: e.message, id: `a-${e.id}`,
      });
    }
    for (const s of sessions) {
      if (q && !s.summary.toLowerCase().includes(q) && !s.project.toLowerCase().includes(q)) continue;
      items.push({
        time: s.created_at, kind: 'session', icon: BookOpen, color: 'text-nexus-amber',
        label: s.project, text: s.summary, id: `s-${s.id}`, session: s,
      });
    }
    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return items;
  }, [entries, sessions, q]);

  const grouped = useMemo(() => {
    const g = {};
    for (const item of timeline) { const d = formatDate(item.time); if (!g[d]) g[d] = []; g[d].push(item); }
    return g;
  }, [timeline]);

  if (timeline.length === 0) return (
    <div className="text-center py-12 bg-nexus-surface border border-nexus-border rounded-xl">
      <Clock size={24} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
      <p className="text-xs font-mono text-nexus-text-faint">No events match.</p>
    </div>
  );

  const dotSize = { session: 'w-3 h-3', task: 'w-2.5 h-2.5', decision: 'w-2.5 h-2.5', activity: 'w-2 h-2' };
  const dotColor = { session: 'bg-nexus-amber', task: 'bg-nexus-green', decision: 'bg-nexus-purple', activity: 'bg-nexus-text-faint/40' };

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date}>
          <div className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider mb-3 sticky top-0 bg-nexus-bg py-1">{date}</div>
          <div className="relative ml-4 border-l border-nexus-border/50 pl-6 space-y-1">
            {items.map(item => {
              const isSession = item.kind === 'session';
              const isExp = expanded[item.id];
              return (
                <div key={item.id} className="relative">
                  <div className={`absolute -left-[31px] top-2 rounded-full ${dotSize[item.kind]} ${dotColor[item.kind]}`} />
                  {isSession ? (
                    <div className={`py-2 px-3 rounded-lg bg-nexus-surface border ${isExp ? 'border-nexus-amber/20' : 'border-nexus-border'} hover:border-nexus-amber/30 transition-colors`}>
                      <button onClick={() => setExpanded(p => ({ ...p, [item.id]: !p[item.id] }))} className="w-full text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-nexus-text-faint w-10 shrink-0">{formatTime(item.time)}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20">{item.label}</span>
                          <span className="text-xs text-nexus-text truncate flex-1">{item.text.slice(0, 80)}{item.text.length > 80 ? '...' : ''}</span>
                          {isExp ? <ChevronDown size={10} className="text-nexus-text-faint shrink-0" /> : <ChevronRight size={10} className="text-nexus-text-faint shrink-0" />}
                        </div>
                      </button>
                      {isExp && item.session && (
                        <div className="mt-2 pt-2 border-t border-nexus-border/50 space-y-1 text-[10px] font-mono text-nexus-text-faint">
                          {item.session.decisions?.length > 0 && <p>{item.session.decisions.length} decisions captured</p>}
                          {item.session.blockers?.length > 0 && <p className="text-nexus-red">{item.session.blockers.length} blockers</p>}
                          {item.session.tags?.length > 0 && (
                            <div className="flex gap-1 flex-wrap">{item.session.tags.map(tag => <span key={tag} className="px-1.5 py-0.5 rounded bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20">{tag}</span>)}</div>
                          )}
                          {item.session.files_touched?.length > 0 && <p>{item.session.files_touched.length} files touched</p>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 py-1 px-2 rounded hover:bg-nexus-surface/50 transition-colors">
                      <span className="text-[10px] font-mono text-nexus-text-faint w-10 shrink-0 pt-0.5">{formatTime(item.time)}</span>
                      <span className={`text-[9px] font-mono ${item.color}`}>{item.label}</span>
                      <span className="text-xs text-nexus-text-dim truncate">{item.text}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
