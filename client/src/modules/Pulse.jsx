import { useState, useEffect } from 'react';
import { api } from '../hooks/useApi.js';
import { Activity, Cpu, HardDrive, GitBranch, FolderOpen, Clock, Flame, Thermometer, Zap, Gauge } from 'lucide-react';
import ProjectHealth from '../components/ProjectHealth.jsx';
import DigestWidget from '../components/DigestWidget.jsx';
import QuickActions from '../components/QuickActions.jsx';
import ClockWidget from '../components/ClockWidget.jsx';

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-nexus-amber' }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 hover:border-nexus-border-bright transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className={color} />
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-light text-nexus-text">{value}</p>
      {sub && <p className="text-xs font-mono text-nexus-text-dim mt-1">{sub}</p>}
    </div>
  );
}

/** Horizontal gauge bar */
function GaugeBar({ percent, color = 'bg-nexus-amber', className = '' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`h-2 bg-nexus-bg rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function tempColor(c) {
  if (c < 55) return 'text-nexus-green';
  if (c < 75) return 'text-nexus-amber';
  return 'text-nexus-red';
}

function utilizationColor(pct) {
  if (pct < 30) return 'text-nexus-text-dim';
  if (pct < 70) return 'text-nexus-amber';
  return 'text-nexus-green'; // high util = working hard = good
}

function barColor(pct, invert = false) {
  if (invert) { // higher = worse (temp, power)
    if (pct < 50) return 'bg-nexus-green';
    if (pct < 80) return 'bg-nexus-amber';
    return 'bg-nexus-red';
  }
  // higher = more used (vram, utilization)
  if (pct < 50) return 'bg-nexus-green';
  if (pct < 85) return 'bg-nexus-amber';
  return 'bg-nexus-red';
}

function GpuPanel({ gpu }) {
  if (!gpu || !gpu.available) {
    return (
      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Flame size={14} className="text-nexus-text-faint" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">GPU</span>
        </div>
        <p className="text-sm text-nexus-text-dim">No CUDA device detected.</p>
      </div>
    );
  }

  const tempPct = Math.round((gpu.temperature / 90) * 100); // 90C as soft max

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 hover:border-nexus-border-bright transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-nexus-green" />
          <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">CUDA Engine</span>
        </div>
        <span className="text-[10px] font-mono text-nexus-text-faint px-2 py-0.5 rounded bg-nexus-bg border border-nexus-border">
          {gpu.pstate} | Driver {gpu.driver}
        </span>
      </div>

      {/* GPU Name */}
      <h3 className="text-lg font-light text-nexus-text mb-4">{gpu.name}</h3>

      {/* Main metrics grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* GPU Utilization */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-nexus-text-faint flex items-center gap-1.5">
              <Gauge size={11} />
              GPU Load
            </span>
            <span className={`text-sm font-mono font-medium ${utilizationColor(gpu.utilization.gpu)}`}>
              {gpu.utilization.gpu}%
            </span>
          </div>
          <GaugeBar percent={gpu.utilization.gpu} color={barColor(gpu.utilization.gpu)} />
        </div>

        {/* Memory Utilization */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-nexus-text-faint flex items-center gap-1.5">
              <HardDrive size={11} />
              Mem Bus
            </span>
            <span className={`text-sm font-mono font-medium ${utilizationColor(gpu.utilization.memory)}`}>
              {gpu.utilization.memory}%
            </span>
          </div>
          <GaugeBar percent={gpu.utilization.memory} color={barColor(gpu.utilization.memory)} />
        </div>

        {/* VRAM */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-nexus-text-faint flex items-center gap-1.5">
              <HardDrive size={11} />
              VRAM
            </span>
            <span className="text-sm font-mono font-medium text-nexus-text">
              {gpu.vram.used} / {gpu.vram.total} MiB
            </span>
          </div>
          <GaugeBar percent={gpu.vram.percent} color={barColor(gpu.vram.percent)} />
        </div>

        {/* Temperature */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-mono text-nexus-text-faint flex items-center gap-1.5">
              <Thermometer size={11} />
              Temp
            </span>
            <span className={`text-sm font-mono font-medium ${tempColor(gpu.temperature)}`}>
              {gpu.temperature}°C
            </span>
          </div>
          <GaugeBar percent={tempPct} color={barColor(tempPct, true)} />
        </div>
      </div>

      {/* Bottom stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-nexus-border">
        <div className="text-center">
          <p className="text-xs font-mono text-nexus-text-faint">Power</p>
          <p className="text-sm font-mono text-nexus-text">
            <Zap size={10} className="inline text-nexus-amber mr-0.5" />
            {gpu.power.draw.toFixed(0)}W
          </p>
          <p className="text-[10px] font-mono text-nexus-text-faint">/ {gpu.power.limit.toFixed(0)}W</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-mono text-nexus-text-faint">Core</p>
          <p className="text-sm font-mono text-nexus-text">{gpu.clocks.graphics} MHz</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">/ {gpu.clocks.maxGraphics}</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-mono text-nexus-text-faint">VRAM Clk</p>
          <p className="text-sm font-mono text-nexus-text">{gpu.clocks.memory} MHz</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">/ {gpu.clocks.maxMemory}</p>
        </div>
        <div className="text-center">
          <p className="text-xs font-mono text-nexus-text-faint">Fan</p>
          <p className="text-sm font-mono text-nexus-text">{gpu.fan}%</p>
          <p className="text-[10px] font-mono text-nexus-text-faint">
            {gpu.fan === 0 ? 'silent' : gpu.fan < 40 ? 'quiet' : 'active'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Pulse({ ws }) {
  const [pulse, setPulse] = useState(null);
  const [projectHealth, setProjectHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchPulse() {
    try {
      const [data, health] = await Promise.all([api.getPulse(), api.getProjectHealth()]);
      setPulse(data);
      setProjectHealth(health);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPulse();
    // Slow safety-net poll — real-time updates come via WebSocket below
    const interval = setInterval(fetchPulse, 60000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to server-pushed snapshots instead of aggressive polling
  useEffect(() => {
    if (!ws?.subscribe) return;
    return ws.subscribe((msg) => {
      if (msg.type === 'gpu_snapshot' || msg.type === 'activity' || msg.type === 'reload') {
        fetchPulse();
      }
    });
  }, [ws]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-compass text-nexus-amber">◈</div>
        <span className="ml-4 font-mono text-sm text-nexus-text-dim">Scanning the horizon...</span>
      </div>
    );
  }

  if (!pulse) {
    return <div className="font-mono text-nexus-text-dim">Uncharted territory. Cannot reach instruments.</div>;
  }

  const { system, gpu, projects, git } = pulse;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <Activity size={18} className="text-nexus-amber" />
          System Pulse
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">All instruments nominal.</p>
      </div>

      {/* System stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={Cpu}
          label="CPUs"
          value={system.cpus}
          sub={system.hostname}
        />
        <StatCard
          icon={HardDrive}
          label="Memory"
          value={`${system.memory.percent}%`}
          sub={`${formatBytes(system.memory.used)} / ${formatBytes(system.memory.total)}`}
          color={system.memory.percent > 85 ? 'text-nexus-red' : 'text-nexus-green'}
        />
        <StatCard
          icon={Clock}
          label="Uptime"
          value={formatUptime(system.uptime)}
          sub={system.platform}
        />
        <StatCard
          icon={GitBranch}
          label="Git"
          value={git.isRepo ? git.branch : 'N/A'}
          sub={git.isRepo ? `${git.uncommittedChanges} uncommitted` : 'No repo in CWD'}
          color={git.isRepo ? 'text-nexus-purple' : 'text-nexus-text-faint'}
        />
      </div>

      {/* Clock + Calendar */}
      <div className="mb-6">
        <ClockWidget ws={ws} />
      </div>

      {/* Digest + Quick Actions row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <DigestWidget />
        <QuickActions />
      </div>

      {/* GPU Panel */}
      <div className="mb-6">
        <GpuPanel gpu={gpu} />
      </div>

      {/* Project Health Cards */}
      <ProjectHealth projects={projectHealth} />
    </div>
  );
}
