import { useState, useEffect, useMemo } from 'react';
import { api } from '../hooks/useApi.js';
import {
  ScrollText, BookOpen, Compass, CheckCircle2, Trash2, Settings,
  FileEdit, AlertTriangle, Tag, ChevronDown, ChevronRight, Search, Filter,
} from 'lucide-react';

// ── Activity type config ────────────────────────────────

const TYPE_CONFIG = {
  task_created: { icon: Compass, color: 'text-nexus-amber', label: 'Plotted' },
  task_done: { icon: CheckCircle2, color: 'text-nexus-green', label: 'Landmark' },
  task_moved: { icon: Compass, color: 'text-nexus-blue', label: 'Course adjusted' },
  task_deleted: { icon: Trash2, color: 'text-nexus-red', label: 'Removed' },
  system: { icon: Settings, color: 'text-nexus-purple', label: 'System' },
  file_change: { icon: FileEdit, color: 'text-nexus-amber', label: 'Terrain shift' },
  error: { icon: AlertTriangle, color: 'text-nexus-red', label: 'Uncharted' },
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

export default function Log({ ws }) {
  const [tab, setTab] = useState('activity'); // activity | sessions
  const [entries, setEntries] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loadingA, setLoadingA] = useState(true);
  const [loadingS, setLoadingS] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('desc');
  const [projectFilter, setProjectFilter] = useState('');
  const [blockersOnly, setBlockersOnly] = useState(false);

  // Fetch both on mount
  useEffect(() => {
    api.getActivity(200).then(setEntries).catch(() => []).finally(() => setLoadingA(false));
    api.getSessions().then(setSessions).catch(() => []).finally(() => setLoadingS(false));
  }, []);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'activity') setEntries(prev => [msg.payload, ...prev].slice(0, 200));
      if (msg.type === 'session_created') setSessions(prev => [msg.payload, ...prev]);
    });
  }, [ws]);

  // Filtered activity
  const typesPresent = useMemo(() => ['all', ...new Set(entries.map(e => e.type)).values()].sort(), [entries]);
  const filteredActivity = useMemo(() => {
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
            {tab === 'activity' ? `${filteredActivity.length} of ${entries.length} entries` : `${filteredSessions.length} of ${sessions.length} sessions`}
          </p>
        </div>
        <div className="flex gap-1">
          {[{ key: 'activity', label: 'Activity', icon: ScrollText }, { key: 'sessions', label: 'Sessions', icon: BookOpen }].map(t => {
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
          <span className="font-mono text-sm text-nexus-text-dim">{tab === 'activity' ? 'Reviewing the log...' : 'Retrieving bearings...'}</span>
        </div>
      ) : tab === 'activity' ? (
        /* ── Activity stream ─── */
        filteredActivity.length === 0 ? (
          <div className="text-center py-12 bg-nexus-surface border border-nexus-border rounded-xl">
            <ScrollText size={24} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
            <p className="text-xs font-mono text-nexus-text-faint">No entries match.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedActivity).map(([date, items]) => (
              <div key={date}>
                <div className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider mb-2 sticky top-0 bg-nexus-bg py-1">{date}</div>
                <div className="space-y-1">
                  {items.map(entry => {
                    const config = TYPE_CONFIG[entry.type] || TYPE_CONFIG.system;
                    const Icon = config.icon;
                    return (
                      <div key={entry.id} className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-nexus-surface transition-colors">
                        <span className="text-xs font-mono text-nexus-text-faint w-12 pt-0.5 shrink-0">{formatTime(entry.created_at)}</span>
                        <Icon size={14} className={`${config.color} mt-0.5 shrink-0`} />
                        <span className="text-sm text-nexus-text-dim">{entry.message}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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
