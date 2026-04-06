import { useState, useEffect } from 'react';
import { BarChart3, GitCommit, CheckCircle2, FileEdit, BookOpen, Flame, AlertTriangle, Calendar } from 'lucide-react';

export default function DigestWidget() {
  const [digest, setDigest] = useState(null);
  const [range, setRange] = useState('7d');

  useEffect(() => {
    fetch(`/api/digest?range=${range}`)
      .then(r => r.json())
      .then(setDigest)
      .catch(() => {});
  }, [range]);

  if (!digest) return null;

  const { stats, projectRanking, busiestDay, activeBlockers, summary } = digest;

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-nexus-amber" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Activity Digest</span>
        </div>
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
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Most active</span>
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
                  <span className="text-[10px] font-mono text-nexus-text-faint w-6 text-right">{p.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Busiest day + blockers */}
      <div className="flex gap-4 pt-3 border-t border-nexus-border text-[10px] font-mono text-nexus-text-faint">
        {busiestDay && (
          <span className="flex items-center gap-1">
            <Calendar size={9} /> Busiest: {busiestDay.day} ({busiestDay.count})
          </span>
        )}
        {activeBlockers.length > 0 && (
          <span className="flex items-center gap-1 text-nexus-amber">
            <AlertTriangle size={9} /> {activeBlockers.length} blocker{activeBlockers.length !== 1 ? 's' : ''}
          </span>
        )}
        <span className="flex items-center gap-1">
          <BookOpen size={9} /> {stats.sessions} session{stats.sessions !== 1 ? 's' : ''}
        </span>
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
