import { useState } from 'react';
import { Ship, GitBranch, FileText, Brain, CheckCircle2, AlertTriangle, Clock, Layers, Activity, Network, GitCommit, X, Loader2 } from 'lucide-react';
import { useNexusFleet } from '../context/useNexus.js';
import { api } from '../hooks/useApi.js';

// v4.5.9 #248 — tiny 7-day activity sparkline. Deterministic shape from a
// fixed-length [oldest..newest] count array. No axis, no labels, just the
// trend: quiet when daily.every(x=>x===0), otherwise a rising/falling line.
function Sparkline({ daily, color = 'currentColor' }) {
  if (!Array.isArray(daily) || daily.length === 0) return null;
  const max = Math.max(1, ...daily);
  const W = 56;
  const H = 14;
  const stepX = daily.length > 1 ? W / (daily.length - 1) : W;
  const points = daily.map((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth="1" strokeOpacity="0.7" points={points} />
      {/* Last-day dot so "today" is visible even when the line ends at zero */}
      {(() => {
        const last = daily[daily.length - 1];
        const x = (daily.length - 1) * stepX;
        const y = H - (last / max) * (H - 2) - 1;
        return <circle cx={x} cy={y} r="1.5" fill={color} />;
      })()}
    </svg>
  );
}

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

  // v4.5.9 #253 — inline git actions (Diff + Commit) for cards with uncommitted
  // changes. Reuses existing /api/github/{diff,commit} routes. Diff shown in an
  // expandable region under the card; commit uses a default message with an
  // optional override prompt. Closes the fleet-oversight loop without leaving
  // the dashboard.
  const [gitExpanded, setGitExpanded] = useState(false);
  const [gitDiff, setGitDiff] = useState(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitResult, setGitResult] = useState(null);
  const loadDiff = async (e) => {
    e.stopPropagation();
    setGitExpanded(v => !v);
    if (gitDiff) return;
    setGitBusy(true);
    try {
      setGitDiff(await api.getGitDiff(project.name));
    } catch (err) {
      setGitDiff({ error: err.message });
    } finally {
      setGitBusy(false);
    }
  };
  const doCommit = async (e) => {
    e.stopPropagation();
    const message = window.prompt(
      `Commit message for ${project.name}:`,
      'Nexus auto-commit'
    );
    if (!message) return;
    setGitBusy(true);
    setGitResult(null);
    try {
      const r = await api.commitProject(project.name, message);
      setGitResult(r);
      if (r.success) setGitDiff(null); // invalidate diff cache
    } catch (err) {
      setGitResult({ success: false, error: err.message });
    } finally {
      setGitBusy(false);
    }
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

        {/* Activity — v4.4.3 #251 count + v4.5.9 #248 sparkline.
            Sparkline shows last 7 days (oldest left → today right) so trend
            direction is visible at a glance. Hidden for quiet projects. */}
        <div className="flex items-center gap-1.5">
          <Activity size={10} className="text-nexus-text-faint" />
          <span
            className="text-[10px] font-mono text-nexus-text-faint flex-1 min-w-0"
            title="Activity events in the last 7 days (rolling window). Sparkline: oldest ← → today."
          >
            {project.activity?.week > 0 ? (
              <><span className="text-nexus-text">{project.activity.week}</span> events last 7d</>
            ) : 'Quiet'}
          </span>
          {project.activity?.week > 0 && Array.isArray(project.activity?.daily) && (
            <Sparkline daily={project.activity.daily} color={project.heat === 'hot' ? '#60d97e' : '#f5b043'} />
          )}
        </div>

        {/* Git */}
        <div className="flex items-center gap-1.5">
          <GitBranch size={10} className="text-nexus-text-faint" />
          <span className="text-[10px] font-mono text-nexus-text-faint flex-1">
            {project.git?.uncommittedChanges > 0 ? (
              <span className="text-nexus-amber">{project.git.uncommittedChanges} uncommitted</span>
            ) : project.hasGit ? 'Clean' : 'No git'}
          </span>
          {/* v4.5.9 #253 — inline Diff/Commit buttons for cards with uncommitted changes. */}
          {project.git?.uncommittedChanges > 0 && (
            <span className="flex items-center gap-1">
              <button
                onClick={loadDiff}
                disabled={gitBusy}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-nexus-border text-nexus-text-faint hover:text-nexus-amber hover:border-nexus-amber/40 disabled:opacity-50"
                title={gitExpanded ? 'Hide diff' : 'Show `git diff HEAD` for this project'}
              >
                {gitExpanded ? 'Hide' : 'Diff'}
              </button>
              <button
                onClick={doCommit}
                disabled={gitBusy}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/10 disabled:opacity-50"
                title="Stage all + commit with a message you provide"
              >
                Commit
              </button>
            </span>
          )}
        </div>
      </div>

      {/* v4.5.9 #253 — diff drawer + commit result */}
      {gitExpanded && (
        <div className="mt-2 mb-2 border border-nexus-border rounded-lg bg-nexus-bg overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 border-b border-nexus-border/50">
            <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">
              {gitBusy ? 'Loading diff…' : gitDiff?.error ? 'Error' : `Diff · ${gitDiff?.files ?? 0} files`}
            </span>
            <button onClick={(e) => { e.stopPropagation(); setGitExpanded(false); }} className="text-nexus-text-faint hover:text-nexus-text">
              <X size={10} />
            </button>
          </div>
          {gitBusy && !gitDiff && (
            <div className="p-3 flex items-center gap-2">
              <Loader2 size={11} className="animate-spin text-nexus-amber" />
              <span className="text-[10px] font-mono text-nexus-text-faint">Running git diff HEAD…</span>
            </div>
          )}
          {gitDiff?.error && (
            <p className="p-2 text-[10px] font-mono text-nexus-red">{gitDiff.error}</p>
          )}
          {gitDiff && !gitDiff.error && (
            <div className="p-2 max-h-64 overflow-auto">
              {gitDiff.stat && (
                <pre className="text-[9px] font-mono text-nexus-text-dim whitespace-pre mb-2">{gitDiff.stat}</pre>
              )}
              <pre className="text-[9px] font-mono text-nexus-text whitespace-pre">{gitDiff.diff || '(no diff)'}</pre>
              {gitDiff.truncated && (
                <p className="text-[9px] font-mono text-nexus-amber mt-1">… truncated at 64KB</p>
              )}
            </div>
          )}
        </div>
      )}
      {gitResult && (
        <div className={`mb-2 px-2 py-1 rounded text-[10px] font-mono ${gitResult.success ? 'text-nexus-green bg-nexus-green/5 border border-nexus-green/20' : 'text-nexus-red bg-nexus-red/5 border border-nexus-red/20'}`}>
          {gitResult.success
            ? <><GitCommit size={10} className="inline mr-1" />Committed {gitResult.files} file{gitResult.files !== 1 ? 's' : ''}</>
            : <>Commit failed: {String(gitResult.error || 'unknown error').slice(0, 120)}</>}
        </div>
      )}

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

      {/* v4.5.9 #252 — staleness list relabeled. Previously "Project Staleness"
          suggested parity with the cards above; in practice this list includes
          nexus-client, level, direwolf, etc. that have no card because they're
          tracked only via session/decision data (no PROJECTS_DIR folder). The
          relabel + subtitle names what the list actually is. */}
      {fleet?.staleness && (() => {
        // Exclude projects already shown as cards — the staleness list is a
        // residual "other tracked projects" view, not a duplicate.
        const cardNames = new Set(projects.map(p => p.name.toLowerCase()));
        const extras = Object.entries(fleet.staleness)
          .filter(([proj]) => !cardNames.has(proj.toLowerCase()));
        if (extras.length === 0) return null;
        return (
          <div className="mt-6 bg-nexus-surface border border-nexus-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={12} className="text-nexus-text-faint" />
              <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Other tracked projects</span>
            </div>
            <p className="text-[10px] font-mono text-nexus-text-faint mb-2">
              Referenced in sessions or decisions but with no project folder in PROJECTS_DIR. Days = since last session touched.
            </p>
            <div className="flex flex-wrap gap-3">
              {extras
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
        );
      })()}
    </div>
  );
}
