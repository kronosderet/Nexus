import { useState } from 'react';
import { Ship, GitBranch, FileText, Brain, CheckCircle2, AlertTriangle, Clock, Layers, Activity, Network } from 'lucide-react';
import { useNexusFleet } from '../context/useNexus.js';

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

function ProjectCard({ project, fleet, onNavigate }) {
  const heat = heatBadge(project.heat);
  const fleetTask = fleet?.topTasks?.find(t => {
    const proj = (t.title.match(/\[(\w+)\]/)?.[1] || '').toLowerCase();
    return proj === project.name.toLowerCase();
  });

  // v4.4.3 #250 — click card title to jump to Command. Command filters by project
  // naturally if we navigate; future: pass project as target filter too (requires
  // Command accepting initialProjectFilter prop — follow-up).
  const handleCardJump = () => { if (onNavigate) onNavigate('command'); };
  // v4.4.5 #380 — secondary action: jump to Graph/Visual focused on this project.
  // Passes navOptions so Graph seeds the Visual view with hiddenProjects =
  // everything except this project name. Resolves the audit finding that project →
  // graph drill-down was too many clicks.
  const handleGraphJump = (e) => {
    e.stopPropagation();
    if (onNavigate) onNavigate('graph', { graphView: 'visual', focusProject: project.name });
  };

  return (
    <div className={`rounded-xl border p-4 transition-colors ${heatColor(project.heat)} ${onNavigate ? 'hover:border-nexus-amber/40 cursor-pointer' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          {onNavigate ? (
            <button
              onClick={handleCardJump}
              className="text-sm font-medium text-nexus-text hover:text-nexus-amber transition-colors text-left"
              title={`Open Command view (${project.name})`}
            >
              {project.name}
            </button>
          ) : (
            <h3 className="text-sm font-medium text-nexus-text">{project.name}</h3>
          )}
          {project.git?.branch && (
            <p className="text-[10px] font-mono text-nexus-text-faint flex items-center gap-1 mt-0.5">
              <GitBranch size={9} />{project.git.branch}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* v4.4.5 #380 — Open in Graph (Visual, filtered to this project) */}
          {onNavigate && (
            <button
              onClick={handleGraphJump}
              title={`Open ${project.name} in Graph Visual (filtered)`}
              aria-label={`Open ${project.name} in Graph Visual`}
              className="p-1 rounded text-nexus-text-faint hover:text-nexus-amber hover:bg-nexus-amber/10 transition-colors"
            >
              <Network size={11} />
            </button>
          )}
          <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${heat.color}`}>{heat.label}</span>
        </div>
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

        {/* Activity — v4.4.3 #251: Fleet card measures rolling 7d activity count
            (same as Dashboard Digest in 7d-range mode). Tooltip spells out semantics
            so the disparity between 7d-rolling (card) and calendar-week (Digest 7d)
            is legible. */}
        <div className="flex items-center gap-1.5">
          <Activity size={10} className="text-nexus-text-faint" />
          <span
            className="text-[10px] font-mono text-nexus-text-faint"
            title="Activity events in the last 7 days (rolling window)"
          >
            {project.activity?.week > 0 ? (
              <><span className="text-nexus-text">{project.activity.week}</span> events last 7d</>
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

export default function Fleet({ onNavigate }) {
  const { fleet: fleetSlice } = useNexusFleet();
  const projects = fleetSlice.data?.projects || [];
  const fleet = fleetSlice.data?.overview || null;
  const loading = fleetSlice.loading;

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
    <div className="animate-page-mount">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <Ship size={18} className="text-nexus-amber" />
          Fleet
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {/* v4.4.1 #246 — "open" explicitly means not-done (backlog + in_progress + review)
              consistent with card display and server-side pulse.ts logic. Title makes the
              semantic discoverable on hover. */}
          {projects.length} projects ·{' '}
          <span title="Not-done tasks: backlog + in_progress + review. Excludes done.">
            {totalTasks} not-done
          </span>
          {' '}· {totalSessions} sessions logged
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
                {/* v4.4.3 #249 — show numeric priority score so ranking is legible beyond
                    the !! bangs. Score factors in priority × age × project staleness. */}
                {t.score != null && (
                  <span
                    className="text-[9px] font-mono text-nexus-text-faint tabular-nums w-8 text-right"
                    title={`Priority score: ${t.score.toFixed(2)} (priority × age × project-staleness)`}
                  >
                    {t.score.toFixed(1)}
                  </span>
                )}
                <span className="text-nexus-text-faint text-[10px] w-8 text-right">{t.ageDays}d</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project cards — v4.4.3 #250: onNavigate passed so card title click jumps to Command.
          v4.5.0 — staggered reveal; 30ms per card capped at 180ms. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...hot, ...warm, ...cold].map((p, i) => (
          <div
            key={p.name}
            className="animate-row-reveal"
            style={{ animationDelay: `${Math.min(i * 30, 180)}ms` }}
          >
            <ProjectCard project={p} fleet={fleet} onNavigate={onNavigate} />
          </div>
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
