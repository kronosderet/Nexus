import { useState, useEffect } from 'react';
import { FolderOpen, GitBranch, Flame, Clock, CheckCircle2, BookOpen } from 'lucide-react';

const HEAT_CONFIG = {
  hot: { color: 'text-nexus-red', bg: 'bg-nexus-red/10 border-nexus-red/20', label: 'Hot' },
  warm: { color: 'text-nexus-amber', bg: 'bg-nexus-amber/10 border-nexus-amber/20', label: 'Warm' },
  cold: { color: 'text-nexus-text-faint', bg: 'bg-nexus-surface border-nexus-border', label: 'Cold' },
};

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ProjectCard({ project }) {
  const heat = HEAT_CONFIG[project.heat];

  return (
    <div className={`rounded-xl p-4 border transition-colors hover:border-nexus-border-bright ${heat.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className={heat.color} />
          <span className="text-sm font-medium text-nexus-text">{project.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Flame size={10} className={heat.color} />
          <span className={`text-[10px] font-mono ${heat.color}`}>{heat.label}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
        {/* Activity */}
        <div>
          <p className="text-lg font-light text-nexus-text">{project.activity.week}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">events / 7d</p>
        </div>
        {/* Open tasks */}
        <div>
          <p className="text-lg font-light text-nexus-text">{project.tasks.open}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">open tasks</p>
        </div>
        {/* Sessions */}
        <div>
          <p className="text-lg font-light text-nexus-text">{project.sessions.count}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">sessions</p>
        </div>
      </div>

      {/* Git info */}
      {project.git.isRepo && (
        <div className="mt-3 pt-2 border-t border-nexus-border/50">
          <div className="flex items-center gap-2 text-xs">
            <GitBranch size={10} className="text-nexus-purple" />
            <span className="font-mono text-nexus-text-dim">{project.git.branch}</span>
            {project.git.uncommittedChanges > 0 && (
              <span className="text-nexus-amber font-mono">+{project.git.uncommittedChanges}</span>
            )}
            <span className="flex-1" />
            <span className="font-mono text-nexus-text-faint">{timeAgo(project.git.lastCommitDate)}</span>
          </div>
          {project.git.lastCommitMsg && (
            <p className="text-[10px] font-mono text-nexus-text-faint mt-1 truncate pl-4">
              {project.git.lastCommitMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectHealth({ projects }) {
  if (!projects || projects.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-mono text-nexus-text-faint uppercase tracking-wider mb-3 flex items-center gap-2">
        <FolderOpen size={14} />
        Fleet Status ({projects.length} territories)
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {projects.map((p) => (
          <ProjectCard key={p.name} project={p} />
        ))}
      </div>
    </div>
  );
}
