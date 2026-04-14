import { useState, useEffect } from 'react';
import { Ship, GitBranch, FileText, Brain, CheckCircle2, AlertTriangle, Clock, Layers, Activity } from 'lucide-react';
import { api } from '../hooks/useApi.js';

function heatColor(heat) {
  if (heat === 'hot') return 'border-nexus-green/30 bg-nexus-green/5';
  if (heat === 'warm') return 'border-nexus-amber/30 bg-nexus-amber/5';
  return 'border-nexus-border bg-nexus-surface';
}

function heatBadge(heat) {
  if (heat === 'hot') return { label: 'Active', color: 'text-nexus-green bg-nexus-green/10 border-nexus-green/20' };
  if (heat === 'warm') return { label: 'Recent', color: 'text-nexus-amber bg-nexus-amber/10 border-nexus-amber/20' };
  return { label: 'Dormant', color: 'text-nexus-text-faint bg-nexus-bg border-nexus-border' };
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function ProjectCard({ project, fleet }) {
  const heat = heatBadge(project.heat);
  const fleetTask = fleet?.topTasks?.find(t => {
    const proj = (t.title.match(/\[(\w+)\]/)?.[1] || '').toLowerCase();
    return proj === project.name.toLowerCase();
  });

  return (
    <div className={`rounded-xl border p-4 transition-colors ${heatColor(project.heat)}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium text-nexus-text">{project.name}</h3>
          {project.git?.branch && (
            <p className="text-[10px] font-mono text-nexus-text-faint flex items-center gap-1 mt-0.5">
              <GitBranch size={9} />{project.git.branch}
            </p>
          )}
        </div>
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${heat.color}`}>{heat.label}</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
        {/* Tasks */}
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={10} className="text-nexus-text-faint" />
          <span className="text-[10px] font-mono text-nexus-text-faint">
            {project.tasks?.open > 0 ? (
              <><span className="text-nexus-text">{project.tasks.open}</span> open</>
            ) : 'No tasks'}
            {project.tasks?.done > 0 && <>, {project.tasks.done} done</>}
          </span>
        </div>

        {/* Sessions */}
        <div className="flex items-center gap-1.5">
          <FileText size={10} className="text-nexus-text-faint" />
          <span className="text-[10px] font-mono text-nexus-text-faint">
            {project.sessions?.count > 0 ? (
              <><span className="text-nexus-text">{project.sessions.count}</span> sessions</>
            ) : 'No sessions'}
          </span>
        </div>

        {/* Decisions */}
        <div className="flex items-center gap-1.5">
          <Brain size={10} className="text-nexus-text-faint" />
          <span className="text-[10px] font-mono text-nexus-text-faint">
            {project.decisions > 0 ? (
              <><span className="text-nexus-text">{project.decisions}</span> decisions</>
            ) : 'No decisions'}
          </span>
        </div>

        {/* Activity */}
        <div className="flex items-center gap-1.5">
          <Activity size={10} className="text-nexus-text-faint" />
          <span className="text-[10px] font-mono text-nexus-text-faint">
            {project.activity?.week > 0 ? (
              <><span className="text-nexus-text">{project.activity.week}</span> events/week</>
            ) : 'Quiet'}
          </span>
        </div>

        {/* Git */}
        <div className="flex items-center gap-1.5">
          <GitBranch size={10} className="text-nexus-text-faint" />
          <span className="text-[10px] font-mono text-nexus-text-faint">
            {project.git?.uncommittedChanges > 0 ? (
              <span className="text-nexus-amber">{project.git.uncommittedChanges} uncommitted</span>
            ) : project.hasGit ? 'Clean' : 'No git'}
          </span>
        </div>
      </div>

      {/* Last commit */}
      {project.git?.lastCommitMsg && (
        <div className="pt-2 border-t border-nexus-border/50">
          <p className="text-[10px] font-mono text-nexus-text-dim truncate" title={project.git.lastCommitMsg}>
            {project.git.lastCommitMsg}
          </p>
          <p className="text-[9px] font-mono text-nexus-text-faint mt-0.5">
            {daysSince(project.git.lastCommitDate)}
          </p>
        </div>
      )}

      {/* Top priority task from fleet overview */}
      {fleetTask && (
        <div className="pt-2 mt-2 border-t border-nexus-border/50">
          <p className="text-[9px] font-mono text-nexus-text-faint uppercase mb-0.5">Top priority</p>
          <p className="text-[10px] font-mono text-nexus-text-dim truncate">#{fleetTask.id} {fleetTask.title.replace(/\[\w+\]\s*/, '')}</p>
        </div>
      )}
    </div>
  );
}

export default function Fleet({ ws }) {
  const [projects, setProjects] = useState([]);
  const [fleet, setFleet] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchAll() {
    try {
      const [p, f] = await Promise.all([
        api.getProjectHealth(),
        api.getFleetOverview().catch(() => null),
      ]);
      setProjects(p || []);
      if (f) setFleet(f);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => { if (msg.type === 'activity' || msg.type === 'reload') fetchAll(); });
  }, [ws]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 justify-center h-64">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Scanning the fleet...</span>
      </div>
    );
  }

  const hot = projects.filter(p => p.heat === 'hot');
  const warm = projects.filter(p => p.heat === 'warm');
  const cold = projects.filter(p => p.heat !== 'hot' && p.heat !== 'warm');
  const totalTasks = projects.reduce((s, p) => s + (p.tasks?.open || 0), 0);
  const totalSessions = projects.reduce((s, p) => s + (p.sessions?.count || 0), 0);
  const uncommitted = projects.filter(p => p.git?.uncommittedChanges > 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <Ship size={18} className="text-nexus-amber" />
          Fleet
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {projects.length} projects · {totalTasks} open tasks · {totalSessions} sessions logged
          {uncommitted.length > 0 && <span className="text-nexus-amber"> · {uncommitted.length} with uncommitted changes</span>}
        </p>
      </div>

      {/* Fleet summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 text-center">
          <p className="text-2xl font-light text-nexus-green">{hot.length}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">Active</p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 text-center">
          <p className="text-2xl font-light text-nexus-amber">{warm.length}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">Recent</p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 text-center">
          <p className="text-2xl font-light text-nexus-text-faint">{cold.length}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">Dormant</p>
        </div>
      </div>

      {/* Fleet priority (from fleet overview) */}
      {fleet?.topTasks?.length > 0 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={12} className="text-nexus-amber" />
            <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Cross-Project Priority</span>
          </div>
          <div className="space-y-1">
            {fleet.topTasks.slice(0, 5).map(t => (
              <div key={t.id} className="flex items-center gap-2 text-xs font-mono">
                <span className={`w-4 text-right ${t.priority >= 2 ? 'text-nexus-red' : t.priority >= 1 ? 'text-nexus-amber' : 'text-nexus-text-faint'}`}>
                  {t.priority >= 2 ? '!!' : t.priority >= 1 ? '!' : ' '}
                </span>
                <span className="text-nexus-text-dim flex-1 truncate">#{t.id} {t.title}</span>
                <span className="text-nexus-text-faint text-[10px]">{t.ageDays}d</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...hot, ...warm, ...cold].map(p => (
          <ProjectCard key={p.name} project={p} fleet={fleet} />
        ))}
      </div>

      {/* Staleness */}
      {fleet?.staleness && Object.keys(fleet.staleness).length > 0 && (
        <div className="mt-6 bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={12} className="text-nexus-text-faint" />
            <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Project Staleness</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {Object.entries(fleet.staleness)
              .sort(([, a], [, b]) => b - a)
              .map(([proj, days]) => (
                <span key={proj} className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  days > 14 ? 'text-nexus-red border-nexus-red/20 bg-nexus-red/5' :
                  days > 7 ? 'text-nexus-amber border-nexus-amber/20 bg-nexus-amber/5' :
                  'text-nexus-text-faint border-nexus-border bg-nexus-bg'
                }`}>
                  {proj}: {days}d
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
