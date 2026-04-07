import { useState, useEffect, useMemo } from 'react';
import { api } from '../hooks/useApi.js';
import { BookOpen, Tag, AlertTriangle, FileText, ChevronDown, ChevronRight, Search } from 'lucide-react';

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function SessionCard({ session }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = session.decisions.length > 0 || session.blockers.length > 0
    || session.files_touched.length > 0 || session.tags.length > 0;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-lg p-4 hover:border-nexus-border-bright transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Project + time */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20">
              {session.project}
            </span>
            <span className="text-xs font-mono text-nexus-text-faint">
              {formatDate(session.created_at)} {formatTime(session.created_at)}
            </span>
          </div>

          {/* Summary */}
          <p className="text-sm text-nexus-text leading-relaxed">{session.summary}</p>

          {/* Tags */}
          {session.tags.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {session.tags.map((tag, i) => (
                <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-nexus-purple/10 text-nexus-purple border border-nexus-purple/20">
                  <Tag size={8} />{tag}
                </span>
              ))}
            </div>
          )}

          {/* Expandable details */}
          {hasDetails && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-2 text-xs text-nexus-text-faint hover:text-nexus-text transition-colors"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Details
            </button>
          )}

          {expanded && (
            <div className="mt-2 space-y-2 pl-3 border-l-2 border-nexus-border">
              {session.decisions.length > 0 && (
                <div>
                  <span className="text-xs font-mono text-nexus-green">Decisions:</span>
                  <ul className="mt-0.5">
                    {session.decisions.map((d, i) => (
                      <li key={i} className="text-xs text-nexus-text-dim">• {d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {session.blockers.length > 0 && (
                <div>
                  <span className="text-xs font-mono text-nexus-amber flex items-center gap-1">
                    <AlertTriangle size={10} />Blockers:
                  </span>
                  <ul className="mt-0.5">
                    {session.blockers.map((b, i) => (
                      <li key={i} className="text-xs text-nexus-text-dim">• {b}</li>
                    ))}
                  </ul>
                </div>
              )}
              {session.files_touched.length > 0 && (
                <div>
                  <span className="text-xs font-mono text-nexus-text-faint flex items-center gap-1">
                    <FileText size={10} />Files:
                  </span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {session.files_touched.map((f, i) => (
                      <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-nexus-bg border border-nexus-border text-nexus-text-dim">{f}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Sessions({ ws }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [blockersOnly, setBlockersOnly] = useState(false);

  async function fetchSessions() {
    try {
      const data = await api.getSessions(filter);
      setSessions(data);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchSessions(); }, [filter]);

  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'session_created') {
        setSessions((prev) => [msg.payload, ...prev]);
      }
    });
  }, [ws]);

  // Get unique project names for filter
  const projects = [...new Set(sessions.map(s => s.project))];

  // Apply search / blockers filter / sort locally
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sessions.filter((s) => {
      if (blockersOnly && (!s.blockers || s.blockers.length === 0)) return false;
      if (!q) return true;
      const haystack = [
        s.summary,
        s.project,
        ...(s.tags || []),
        ...(s.decisions || []),
        ...(s.blockers || []),
        ...(s.files_touched || []),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
    list = [...list].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortOrder === 'asc' ? ta - tb : tb - ta;
    });
    return list;
  }, [sessions, search, blockersOnly, sortOrder]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 h-64 justify-center">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Retrieving bearings...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <BookOpen size={18} className="text-nexus-amber" />
          Session Log
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {sessions.length === 0
            ? 'No sessions recorded. Use: nexus session "summary"'
            : `${visible.length} of ${sessions.length} sessions shown. The bridge holds.`}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nexus-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search summaries, tags, decisions..."
              className="w-full bg-nexus-bg border border-nexus-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
            />
          </div>
          <button
            onClick={() => setBlockersOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-colors flex items-center gap-1 ${
              blockersOnly
                ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20'
                : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'
            }`}
          >
            <AlertTriangle size={10} /> Blockers only
          </button>
          <button
            onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
            className="px-3 py-1.5 rounded-lg text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber border border-nexus-border transition-colors"
          >
            {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>

        {projects.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilter('')}
              className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                !filter ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
              }`}
            >
              All
            </button>
            {projects.map((p) => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                  filter === p ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20' : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Session list */}
      {visible.length === 0 ? (
        <div className="text-center py-12 bg-nexus-surface border border-nexus-border rounded-xl">
          <BookOpen size={24} className="mx-auto text-nexus-text-faint mb-2 opacity-40" />
          <p className="text-xs font-mono text-nexus-text-faint">No sessions match these filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}
