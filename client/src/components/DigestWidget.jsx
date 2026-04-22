import { useState, useEffect, useCallback } from 'react';
import { BarChart3, GitCommit, CheckCircle2, FileEdit, BookOpen, Flame, AlertTriangle, Calendar, RefreshCw } from 'lucide-react';
import { api } from '../hooks/useApi.js';

export default function DigestWidget({ ws, onNavigate }) {
  const [digest, setDigest] = useState(null);
  const [range, setRange] = useState('7d');
  const [fetchedAt, setFetchedAt] = useState(null);

  const refresh = useCallback(() => {
    api.getDigest(range).then(d => { setDigest(d); setFetchedAt(Date.now()); }).catch(() => {});
  }, [range]);

  // Initial + range-change fetch
  useEffect(() => { refresh(); }, [refresh]);

  // v4.4.1 #235 — auto-refresh on WS events that affect digest stats.
  // Previously cached "0 commits" long after a commit landed. Now subscribes to
  // activity / task_update / session_created / task_deleted and refetches.
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'activity' || msg.type === 'task_update' || msg.type === 'task_deleted' || msg.type === 'session_created') {
        refresh();
      }
    });
  }, [ws, refresh]);

  if (!digest) return null;

  // Freshness age for display
  const ageSec = fetchedAt ? Math.floor((Date.now() - fetchedAt) / 1000) : 0;
  const ageStr = ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m` : `${Math.floor(ageSec / 3600)}h`;

  const { stats, projectRanking, busiestDay, activeBlockers, summary } = digest;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-nexus-amber" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Activity Digest</span>
        </div>
        <div className="flex items-center gap-2">
          {/* v4.4.1 #235 — freshness indicator + manual refresh */}
          <button
            onClick={refresh}
            className="flex items-center gap-1 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber transition-colors"
            title={`Last updated ${ageStr} ago. Click to refresh.`}
          >
            <RefreshCw size={9} />
            {ageStr}
          </button>
          <div className="flex gap-1">
            {['24h', '7d', '30d'].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                  range === r
                    ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20'
                    : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary sentence */}
      <p className="text-sm text-nexus-text mb-4 capitalize">{summary}</p>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat icon={FileEdit} label="Events" value={stats.totalEvents} />
        <Stat icon={GitCommit} label="Commits" value={stats.commits} />
        <Stat icon={CheckCircle2} label="Done" value={stats.tasksCompleted} color="text-nexus-green" />
      </div>

      {/* Project ranking */}
      {projectRanking.length > 0 && (
        <div className="mb-3">
          {/* v4.4.2 #236 — label the unit explicitly so "180" isn't ambiguous. */}
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Most active</span>
            <span className="text-[9px] font-mono text-nexus-text-faint" title="Activity events in the selected range">events</span>
          </div>
          <div className="mt-1.5 space-y-1">
            {projectRanking.slice(0, 4).map((p, i) => {
              const maxCount = projectRanking[0].count;
              const pct = Math.round((p.count / maxCount) * 100);
              return (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="text-xs text-nexus-text w-24 truncate">{p.name}</span>
                  <div className="flex-1 h-1.5 bg-nexus-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${i === 0 ? 'bg-nexus-amber' : 'bg-nexus-border-bright'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-nexus-text-faint w-6 text-right" title={`${p.count} activity events in range`}>{p.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Busiest day + blockers — v4.5.7 #241: clickable. Busiest day opens Log
          timeline (no direct day filter yet, but the user lands in the right
          tab with all timestamps visible). Blockers count opens Log sessions
          tab where the Blockers-only toggle lives. Sessions count just jumps
          to the same sessions tab. Purely navigational — no new server routes. */}
      <div className="flex gap-4 pt-3 border-t border-nexus-border text-[10px] font-mono text-nexus-text-faint">
        {busiestDay && (
          <button
            onClick={() => onNavigate && onNavigate('log')}
            disabled={!onNavigate}
            className="flex items-center gap-1 hover:text-nexus-amber transition-colors disabled:cursor-default disabled:hover:text-nexus-text-faint"
            title={onNavigate ? `Open Log timeline (no direct day filter; ${busiestDay.day} has ${busiestDay.count} events)` : undefined}
          >
            <Calendar size={9} /> Busiest: {busiestDay.day} ({busiestDay.count})
          </button>
        )}
        {activeBlockers.length > 0 && (
          <button
            onClick={() => onNavigate && onNavigate('log')}
            disabled={!onNavigate}
            className="flex items-center gap-1 text-nexus-amber hover:text-nexus-text transition-colors disabled:cursor-default"
            title={onNavigate ? 'Open Log sessions tab (use Blockers toggle there)' : undefined}
          >
            <AlertTriangle size={9} /> {activeBlockers.length} blocker{activeBlockers.length !== 1 ? 's' : ''}
          </button>
        )}
        <button
          onClick={() => onNavigate && onNavigate('log')}
          disabled={!onNavigate}
          className="flex items-center gap-1 hover:text-nexus-amber transition-colors disabled:cursor-default disabled:hover:text-nexus-text-faint"
          title={onNavigate ? 'Open Log sessions tab' : undefined}
        >
          <BookOpen size={9} /> {stats.sessions} session{stats.sessions !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, color = 'text-nexus-text' }) {
  return (
    <div className="text-center">
      <Icon size={12} className="mx-auto mb-1 text-nexus-text-faint" />
      <p className={`text-lg font-light ${color}`}>{value}</p>
      <p className="text-[10px] font-mono text-nexus-text-faint">{label}</p>
    </div>
  );
}
