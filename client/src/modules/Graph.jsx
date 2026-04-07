import { useState, useEffect, useMemo } from 'react';
import { GitBranch, Target, AlertTriangle, BarChart3, Link2, RefreshCw, Search, ChevronRight, Network } from 'lucide-react';
import { api } from '../hooks/useApi.js';

export default function GraphModule() {
  const [view, setView] = useState('overview'); // overview, blast, centrality, contradictions, holes, visual
  const [graph, setGraph] = useState(null);
  const [centrality, setCentrality] = useState(null);
  const [contradictions, setContradictions] = useState(null);
  const [holes, setHoles] = useState(null);
  const [blastId, setBlastId] = useState('');
  const [blastResult, setBlastResult] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchAll() {
    setLoading(true);
    try {
      const [g, c, con, h] = await Promise.all([
        api.getGraphFull(),
        api.getImpactCentrality(),
        api.getImpactContradictions(),
        api.getImpactHoles(),
      ]);
      setGraph(g);
      setCentrality(c);
      setContradictions(con);
      setHoles(h);
    } catch (err) {
      console.error('Failed to fetch graph data', err);
    } finally {
      setLoading(false);
    }
  }

  async function autoLink() {
    try {
      await api.autoLinkGraph();
      fetchAll();
    } catch (err) {
      console.error('Auto-link failed', err);
    }
  }

  async function runBlast() {
    if (!blastId) return;
    try {
      setBlastResult(await api.getImpactBlast(blastId));
    } catch (err) {
      console.error('Blast analysis failed', err);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-3 justify-center h-64">
        <div className="text-2xl animate-compass text-nexus-amber">◈</div>
        <span className="font-mono text-sm text-nexus-text-dim">Mapping the decision landscape...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
          <GitBranch size={18} className="text-nexus-amber" />
          Knowledge Graph
        </h2>
        <p className="text-xs font-mono text-nexus-text-faint mt-1">
          {graph?.nodes.length || 0} decisions, {graph?.edges.length || 0} connections. The architecture in context.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-nexus-border pb-2">
        {[
          { key: 'overview', label: 'Overview', icon: BarChart3 },
          { key: 'blast', label: 'Blast Radius', icon: Target },
          { key: 'centrality', label: 'Centrality', icon: Link2 },
          { key: 'contradictions', label: 'Conflicts', icon: AlertTriangle },
          { key: 'holes', label: 'Holes', icon: Search },
          { key: 'visual', label: 'Visual', icon: Network },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                view === tab.key
                  ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20'
                  : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
              }`}
            >
              <Icon size={12} />{tab.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button onClick={autoLink} className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber border border-nexus-border rounded transition-colors">
          <RefreshCw size={10} /> Auto-link
        </button>
      </div>

      {/* Views */}
      {view === 'overview' && <OverviewView graph={graph} centrality={centrality} contradictions={contradictions} holes={holes} />}
      {view === 'blast' && <BlastView blastId={blastId} setBlastId={setBlastId} onRun={runBlast} result={blastResult} />}
      {view === 'centrality' && <CentralityView data={centrality} />}
      {view === 'contradictions' && <ContradictionsView data={contradictions} />}
      {view === 'holes' && <HolesView data={holes} />}
      {view === 'visual' && <VisualView graph={graph} />}
    </div>
  );
}

function OverviewView({ graph, centrality, contradictions, holes }) {
  // Edge type breakdown
  const edgeTypes = {};
  for (const e of graph?.edges || []) edgeTypes[e.rel] = (edgeTypes[e.rel] || 0) + 1;

  // Project breakdown
  const projects = {};
  for (const n of graph?.nodes || []) projects[n.project] = (projects[n.project] || 0) + 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard label="Decisions" value={graph?.nodes.length || 0} sub="Total indexed" />
      <StatCard label="Connections" value={graph?.edges.length || 0} sub={`Avg ${centrality?.averageConnections || '?'} per node`} />
      <StatCard label="Conflicts" value={contradictions?.total || 0} sub={contradictions?.total > 0 ? 'Needs attention' : 'All clear'} color={contradictions?.total > 0 ? 'text-nexus-amber' : 'text-nexus-green'} />
      <StatCard label="Holes" value={holes?.totalHoles || 0} sub={holes?.totalHoles > 0 ? 'Weak cross-links' : 'Well connected'} color={holes?.totalHoles > 0 ? 'text-nexus-amber' : 'text-nexus-green'} />

      {/* Edge types */}
      <div className="col-span-2 bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Edge Types</span>
        <div className="mt-2 space-y-1">
          {Object.entries(edgeTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="text-xs font-mono text-nexus-text-dim w-24">{type}</span>
              <div className="flex-1 h-1.5 bg-nexus-bg rounded-full"><div className="h-full bg-nexus-amber/50 rounded-full" style={{ width: `${(count / Math.max(...Object.values(edgeTypes))) * 100}%` }} /></div>
              <span className="text-xs font-mono text-nexus-text-faint w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Projects */}
      <div className="col-span-2 bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">By Project</span>
        <div className="mt-2 space-y-1">
          {Object.entries(projects).sort((a, b) => b[1] - a[1]).map(([proj, count]) => (
            <div key={proj} className="flex items-center gap-2">
              <span className="text-xs font-mono text-nexus-text-dim w-24">{proj}</span>
              <div className="flex-1 h-1.5 bg-nexus-bg rounded-full"><div className="h-full bg-nexus-purple/50 rounded-full" style={{ width: `${(count / Math.max(...Object.values(projects))) * 100}%` }} /></div>
              <span className="text-xs font-mono text-nexus-text-faint w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlastView({ blastId, setBlastId, onRun, result }) {
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          value={blastId}
          onChange={e => setBlastId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onRun()}
          placeholder="Decision ID (e.g. 44)"
          className="bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-sm text-nexus-text font-mono focus:border-nexus-amber focus:outline-none w-48"
        />
        <button onClick={onRun} className="px-4 py-2 rounded-lg bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 text-xs font-mono hover:bg-nexus-amber/20">
          Analyze
        </button>
      </div>
      {result && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
          <h3 className="text-sm text-nexus-text mb-1">{result.decision?.decision}</h3>
          <p className={`text-xs font-mono mb-3 ${result.blastRadius > 5 ? 'text-nexus-red' : result.blastRadius > 0 ? 'text-nexus-amber' : 'text-nexus-green'}`}>
            {result.warning}
          </p>
          {result.affected?.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-nexus-text-faint uppercase">Downstream</span>
              {result.affected.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-xs" style={{ paddingLeft: `${(a.depth - 1) * 16}px` }}>
                  <ChevronRight size={10} className="text-nexus-amber" />
                  <span className="text-nexus-green font-mono">#{a.id}</span>
                  <span className="text-nexus-text-dim">{a.decision}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CentralityView({ data }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      <p className="text-xs font-mono text-nexus-text-faint mb-3">Avg {data?.averageConnections} connections per decision</p>
      <div className="space-y-1.5">
        {data?.centrality?.slice(0, 15).map(c => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="text-xs font-mono text-nexus-text-faint w-8">#{c.id}</span>
            <div className="flex-1 h-2 bg-nexus-bg rounded-full">
              <div className="h-full bg-nexus-amber/60 rounded-full" style={{ width: `${Math.min(100, c.total * 5)}%` }} />
            </div>
            <span className="text-xs font-mono text-nexus-text-dim w-6 text-right">{c.total}</span>
            <span className="text-xs text-nexus-text-dim truncate w-48">{c.decision}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContradictionsView({ data }) {
  if (data?.total === 0) return <div className="text-center py-8"><AlertTriangle size={20} className="mx-auto text-nexus-green mb-2" /><p className="text-xs font-mono text-nexus-green">No contradictions detected.</p></div>;
  return (
    <div className="space-y-2">
      {data?.contradictions?.map((c, i) => (
        <div key={i} className="bg-nexus-red/5 border border-nexus-red/20 rounded-lg p-3">
          <p className="text-xs text-nexus-text-dim">{c.message}</p>
          {c.trigger && <span className="text-[10px] font-mono text-nexus-red mt-1 inline-block">Trigger: {c.trigger}</span>}
        </div>
      ))}
    </div>
  );
}

function HolesView({ data }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      {data?.holes?.length === 0 ? (
        <p className="text-xs font-mono text-nexus-green">All projects well-connected.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {data?.holes?.map((h, i) => (
            <div key={i} className="flex items-center gap-2 text-xs"><AlertTriangle size={10} className="text-nexus-amber" /><span className="text-nexus-text-dim">{h.pair}: {h.note}</span></div>
          ))}
        </div>
      )}
      <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Cross-project links</span>
      <div className="mt-2 space-y-1">
        {Object.entries(data?.crossLinks || {}).map(([pair, count]) => (
          <div key={pair} className="flex items-center justify-between text-xs font-mono">
            <span className="text-nexus-text-dim">{pair}</span>
            <span className="text-nexus-text-faint">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color = 'text-nexus-text' }) {
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
      <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">{label}</span>
      <p className={`text-2xl font-light mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-nexus-text-faint mt-1">{sub}</p>}
    </div>
  );
}

// ── Visual / Force-Directed View ─────────────────────────
const PROJECT_PALETTE = [
  { name: 'amber', stroke: '#f59e0b', fill: '#f59e0b' },
  { name: 'green', stroke: '#22c55e', fill: '#22c55e' },
  { name: 'blue', stroke: '#3b82f6', fill: '#3b82f6' },
  { name: 'purple', stroke: '#a855f7', fill: '#a855f7' },
  { name: 'red', stroke: '#ef4444', fill: '#ef4444' },
];

function hashProjectColor(project) {
  if (!project) return PROJECT_PALETTE[0];
  let h = 0;
  for (let i = 0; i < project.length; i++) {
    h = (h * 31 + project.charCodeAt(i)) | 0;
  }
  return PROJECT_PALETTE[Math.abs(h) % PROJECT_PALETTE.length];
}

function VisualView({ graph }) {
  const WIDTH = 600;
  const HEIGHT = 400;
  const [hoveredId, setHoveredId] = useState(null);

  // Memoized force-directed layout: runs once per graph (and on graph change)
  const layout = useMemo(() => {
    if (!graph || !graph.nodes || graph.nodes.length === 0) {
      return { positions: {}, components: 0 };
    }
    const nodes = graph.nodes;
    const edges = graph.edges || [];

    // Position state — seeded deterministically by id so layout is stable
    const positions = {};
    for (const n of nodes) {
      const seed = n.id * 9301 + 49297;
      const r1 = ((seed % 233280) / 233280);
      const r2 = (((seed * 13) % 233280) / 233280);
      positions[n.id] = {
        x: WIDTH / 2 + (r1 - 0.5) * WIDTH * 0.7,
        y: HEIGHT / 2 + (r2 - 0.5) * HEIGHT * 0.7,
      };
    }

    // Connection counts (degree)
    const degree = {};
    for (const n of nodes) degree[n.id] = 0;
    for (const e of edges) {
      if (degree[e.from] !== undefined) degree[e.from]++;
      if (degree[e.to] !== undefined) degree[e.to]++;
    }

    // Spring-embedder iterations
    const ITER = 100;
    const k = Math.sqrt((WIDTH * HEIGHT) / Math.max(1, nodes.length)) * 0.6;
    const repel = k * k;
    const cooling = (i) => Math.max(0.01, 1 - i / ITER) * 6;

    for (let i = 0; i < ITER; i++) {
      // Reset displacements
      const disp = {};
      for (const n of nodes) disp[n.id] = { x: 0, y: 0 };

      // Repulsive forces between all pairs
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a];
          const nb = nodes[b];
          const dx = positions[na.id].x - positions[nb.id].x;
          const dy = positions[na.id].y - positions[nb.id].y;
          const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
          const force = repel / dist;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          disp[na.id].x += fx;
          disp[na.id].y += fy;
          disp[nb.id].x -= fx;
          disp[nb.id].y -= fy;
        }
      }

      // Attractive forces along edges
      for (const e of edges) {
        const pa = positions[e.from];
        const pb = positions[e.to];
        if (!pa || !pb) continue;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const force = (dist * dist) / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[e.from].x -= fx;
        disp[e.from].y -= fy;
        disp[e.to].x += fx;
        disp[e.to].y += fy;
      }

      // Apply with cooling
      const temp = cooling(i);
      for (const n of nodes) {
        const d = disp[n.id];
        const len = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
        const limited = Math.min(len, temp);
        positions[n.id].x += (d.x / len) * limited;
        positions[n.id].y += (d.y / len) * limited;
        // Keep inside the canvas with margin
        positions[n.id].x = Math.max(20, Math.min(WIDTH - 20, positions[n.id].x));
        positions[n.id].y = Math.max(20, Math.min(HEIGHT - 20, positions[n.id].y));
      }
    }

    // Connected components (union-find)
    const parent = {};
    for (const n of nodes) parent[n.id] = n.id;
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (const e of edges) {
      if (parent[e.from] !== undefined && parent[e.to] !== undefined) {
        union(e.from, e.to);
      }
    }
    const roots = new Set();
    for (const n of nodes) roots.add(find(n.id));
    const components = roots.size;

    return { positions, degree, components };
  }, [graph]);

  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return (
      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-8 text-center">
        <Network size={20} className="mx-auto text-nexus-text-faint mb-2" />
        <p className="text-xs font-mono text-nexus-text-dim">No graph data to visualize.</p>
      </div>
    );
  }

  const { positions, degree, components } = layout;
  const maxDegree = Math.max(1, ...Object.values(degree || {}));
  const nodeRadius = (id) => {
    const d = (degree && degree[id]) || 0;
    return 4 + (d / maxDegree) * 8; // 4..12
  };

  const hovered = hoveredId != null
    ? graph.nodes.find((n) => n.id === hoveredId)
    : null;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard label="Nodes" value={graph.nodes.length} sub="Decisions" />
        <StatCard label="Edges" value={graph.edges?.length || 0} sub="Connections" />
        <StatCard label="Components" value={components} sub={components === 1 ? 'Fully connected' : 'Disconnected clusters'} />
      </div>

      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <div className="relative" style={{ width: WIDTH, height: HEIGHT, maxWidth: '100%' }}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width={WIDTH}
            height={HEIGHT}
            className="block max-w-full"
            style={{ background: '#0a0e1a' }}
          >
            {/* Edges */}
            {(graph.edges || []).map((e) => {
              const a = positions[e.from];
              const b = positions[e.to];
              if (!a || !b) return null;
              const isHi = hoveredId != null && (e.from === hoveredId || e.to === hoveredId);
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={isHi ? '#f59e0b' : '#334155'}
                  strokeOpacity={isHi ? 0.9 : 0.4}
                  strokeWidth={isHi ? 1.5 : 0.8}
                />
              );
            })}

            {/* Nodes */}
            {graph.nodes.map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              const color = hashProjectColor(n.project);
              const r = nodeRadius(n.id);
              const isHi = hoveredId === n.id;
              return (
                <g key={n.id}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isHi ? r + 2 : r}
                    fill={color.fill}
                    fillOpacity={isHi ? 1 : 0.75}
                    stroke={isHi ? '#f59e0b' : color.stroke}
                    strokeOpacity={isHi ? 1 : 0.6}
                    strokeWidth={isHi ? 2 : 1}
                    style={{ cursor: 'pointer', transition: 'r 0.1s' }}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                </g>
              );
            })}

            {/* Hover label rendered on top */}
            {hovered && positions[hovered.id] && (
              <g pointerEvents="none">
                <rect
                  x={Math.min(WIDTH - 220, Math.max(4, positions[hovered.id].x + 10))}
                  y={Math.max(4, positions[hovered.id].y - 22)}
                  width={210}
                  height={22}
                  rx={4}
                  fill="#0a0e1a"
                  stroke="#f59e0b"
                  strokeOpacity={0.6}
                />
                <text
                  x={Math.min(WIDTH - 220, Math.max(4, positions[hovered.id].x + 10)) + 8}
                  y={Math.max(4, positions[hovered.id].y - 22) + 14}
                  fill="#e2e8f0"
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                >
                  #{hovered.id} {String(hovered.label || '').slice(0, 40)}
                </text>
              </g>
            )}
          </svg>
        </div>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Project legend:</span>
          {PROJECT_PALETTE.map((c) => (
            <div key={c.name} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.fill }} />
              <span className="text-[10px] font-mono text-nexus-text-faint">{c.name}</span>
            </div>
          ))}
          {hovered && (
            <span className="text-[10px] font-mono text-nexus-amber ml-auto">
              {String(hovered.project || 'unknown')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
