import { useState, useMemo, useRef, useEffect } from 'react';
import { GitBranch, Target, AlertTriangle, BarChart3, Link2, RefreshCw, Search, ChevronRight, Network } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { useNexusFleet } from '../context/useNexus.js';

export default function GraphModule() {
  const { graph: graphSlice } = useNexusFleet();
  const [view, setView] = useState('overview');
  const [blastId, setBlastId] = useState('');
  const [blastResult, setBlastResult] = useState(null);

  const graph = graphSlice.data?.graph || null;
  const centrality = graphSlice.data?.centrality || null;
  const contradictions = graphSlice.data?.contradictions || null;
  const holes = graphSlice.data?.holes || null;
  const loading = graphSlice.loading;

  async function autoLink() {
    try { await api.autoLinkGraph(); graphSlice.refresh(); } catch {}
  }

  async function runBlast() {
    if (!blastId) return;
    try { setBlastResult(await api.getImpactBlast(blastId)); } catch {}
  }

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
              <div className="flex-1 h-1.5 bg-nexus-bg rounded-full"><div className="h-full bg-nexus-amber/50 rounded-full" style={{ width: `${(count / (Math.max(...Object.values(edgeTypes)) || 1)) * 100}%` }} /></div>
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
              <div className="flex-1 h-1.5 bg-nexus-bg rounded-full"><div className="h-full bg-nexus-purple/50 rounded-full" style={{ width: `${(count / (Math.max(...Object.values(projects)) || 1)) * 100}%` }} /></div>
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
  if (!data) return null;
  const fragmented = data.fragmented || [];
  const healthy = (data.projectAnalysis || []).filter((p) => !p.isFragmented);
  const crossLinks = Object.entries(data.crossLinks || {});

  return (
    <div className="space-y-4">
      {/* Headline summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Fragmented projects</span>
          <p className={`text-2xl font-light mt-1 ${data.totalFragmented > 0 ? 'text-nexus-amber' : 'text-nexus-green'}`}>
            {data.totalFragmented || 0}
          </p>
          <p className="text-[10px] font-mono text-nexus-text-faint mt-1">
            {data.totalFragmented > 0 ? 'have disconnected sub-clusters' : 'all decision graphs connected'}
          </p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Orphan decisions</span>
          <p className={`text-2xl font-light mt-1 ${data.totalOrphans > 0 ? 'text-nexus-amber' : 'text-nexus-green'}`}>
            {data.totalOrphans || 0}
          </p>
          <p className="text-[10px] font-mono text-nexus-text-faint mt-1">
            isolated, no edges
          </p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Healthy projects</span>
          <p className="text-2xl font-light text-nexus-green mt-1">{healthy.length}</p>
          <p className="text-[10px] font-mono text-nexus-text-faint mt-1">
            single connected graph
          </p>
        </div>
      </div>

      {/* Fragmented projects detail */}
      {fragmented.length > 0 ? (
        <div>
          <h3 className="text-[10px] font-mono text-nexus-amber uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
            <AlertTriangle size={11} /> Fragmented decision graphs
          </h3>
          <div className="space-y-3">
            {fragmented.map((p) => (
              <div key={p.project} className="bg-nexus-surface border border-nexus-amber/20 rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-nexus-text font-medium">{p.project}</span>
                    <span className="text-[10px] font-mono text-nexus-text-faint">
                      {p.decisions} decisions · {p.edges} internal edges
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-nexus-amber">
                    {p.components} clusters · {p.orphans} orphan{p.orphans !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {p.clusters.slice(0, 5).map((c, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded ${
                        c.size === 1 ? 'bg-nexus-bg/40 border border-nexus-border' : 'bg-nexus-amber/5 border border-nexus-amber/10'
                      }`}
                    >
                      <span className="text-[10px] font-mono text-nexus-text-faint w-12 shrink-0 mt-0.5">
                        {c.size === 1 ? 'orphan' : `×${c.size}`}
                      </span>
                      <div className="flex-1 min-w-0">
                        {c.sampleTitles.map((title, j) => (
                          <p key={j} className="text-xs text-nexus-text-dim truncate">
                            {title}
                          </p>
                        ))}
                        {c.size > c.sampleTitles.length && (
                          <p className="text-[10px] font-mono text-nexus-text-faint">
                            +{c.size - c.sampleTitles.length} more
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {p.clusters.length > 5 && (
                    <p className="text-[10px] font-mono text-nexus-text-faint pl-2">
                      +{p.clusters.length - 5} more clusters
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-nexus-green/5 border border-nexus-green/20 rounded-xl p-6 text-center">
          <p className="text-xs font-mono text-nexus-green">
            All decision graphs are fully connected. No structural holes detected.
          </p>
        </div>
      )}

      {/* Healthy projects summary */}
      {healthy.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-[0.2em] mb-2">
            Healthy projects
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {healthy.map((p) => (
              <div
                key={p.project}
                className="px-2 py-1 rounded-full text-[10px] font-mono bg-nexus-green/5 text-nexus-green border border-nexus-green/20"
              >
                {p.project} <span className="opacity-60">×{p.decisions}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-project links (supplementary, not flagged as holes) */}
      {crossLinks.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-[0.2em] mb-2">
            Cross-project links ({crossLinks.length})
          </h3>
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 space-y-1">
            {crossLinks.map(([pair, count]) => (
              <div key={pair} className="flex items-center justify-between text-xs font-mono">
                <span className="text-nexus-text-dim">{pair}</span>
                <span className="text-nexus-text-faint">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
  { name: 'amber',  stroke: '#f59e0b', fill: '#f59e0b' },
  { name: 'green',  stroke: '#22c55e', fill: '#22c55e' },
  { name: 'blue',   stroke: '#3b82f6', fill: '#3b82f6' },
  { name: 'purple', stroke: '#a855f7', fill: '#a855f7' },
  { name: 'red',    stroke: '#ef4444', fill: '#ef4444' },
  { name: 'cyan',   stroke: '#06b6d4', fill: '#06b6d4' },
  { name: 'pink',   stroke: '#ec4899', fill: '#ec4899' },
  { name: 'lime',   stroke: '#84cc16', fill: '#84cc16' },
];

function hashProjectColor(project) {
  if (!project) return PROJECT_PALETTE[0];
  let h = 0;
  for (let i = 0; i < project.length; i++) {
    h = (h * 31 + project.charCodeAt(i)) | 0;
  }
  return PROJECT_PALETTE[Math.abs(h) % PROJECT_PALETTE.length];
}

// Edge type visual styles
const EDGE_STYLES = {
  led_to:     { stroke: '#f59e0b', dash: 'none',   label: 'Led to' },
  depends_on: { stroke: '#3b82f6', dash: '6,3',    label: 'Depends on' },
  contradicts:{ stroke: '#ef4444', dash: '2,3',     label: 'Contradicts' },
  replaced:   { stroke: '#6b7280', dash: '8,4',     label: 'Replaced' },
  related:    { stroke: '#64748b', dash: '2,2',     label: 'Related' },
};

function VisualView({ graph }) {
  const HEIGHT = 400;
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hiddenProjects, setHiddenProjects] = useState(new Set());
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Responsive width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const WIDTH = containerWidth;

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

      {/* Project toggle chips */}
      {(() => {
        const projectSet = [...new Set(graph.nodes.map(n => n.project))].sort();
        return (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {projectSet.map(p => {
              const c = hashProjectColor(p);
              const hidden = hiddenProjects.has(p);
              return (
                <button key={p} onClick={() => setHiddenProjects(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; })}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all ${hidden ? 'opacity-30 border-nexus-border text-nexus-text-faint' : 'border-current'}`}
                  style={{ color: hidden ? undefined : c.fill, borderColor: hidden ? undefined : c.fill + '40' }}>
                  {p}
                </button>
              );
            })}
          </div>
        );
      })()}

      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex gap-4">
        <div ref={containerRef} className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            height={HEIGHT}
            className="block"
            style={{ background: '#0a0e1a', borderRadius: 8 }}
            onClick={() => setSelectedId(null)}
          >
            {/* Edges with type-based styling */}
            {(graph.edges || []).map((e) => {
              const a = positions[e.from];
              const b = positions[e.to];
              if (!a || !b) return null;
              const nodeA = graph.nodes.find(n => n.id === e.from);
              const nodeB = graph.nodes.find(n => n.id === e.to);
              if (nodeA && hiddenProjects.has(nodeA.project)) return null;
              if (nodeB && hiddenProjects.has(nodeB.project)) return null;
              const isHi = hoveredId != null && (e.from === hoveredId || e.to === hoveredId);
              const isSel = selectedId != null && (e.from === selectedId || e.to === selectedId);
              const style = EDGE_STYLES[e.rel] || EDGE_STYLES.related;
              return (
                <line
                  key={e.id}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={style.stroke}
                  strokeOpacity={isHi || isSel ? 0.9 : 0.4}
                  strokeWidth={isHi || isSel ? 2 : 0.8}
                  strokeDasharray={style.dash}
                />
              );
            })}

            {/* Nodes */}
            {graph.nodes.map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              if (hiddenProjects.has(n.project)) return null;
              const color = hashProjectColor(n.project);
              const r = nodeRadius(n.id);
              const isHi = hoveredId === n.id;
              const isSel = selectedId === n.id;
              const lc = n.lifecycle;
              const lcColor = lc === 'validated' ? '#22c55e' : lc === 'proposed' ? '#60a5fa' : lc === 'deprecated' ? '#6b7280' : '#f59e0b';
              const lcLetter = lc === 'validated' ? 'V' : lc === 'proposed' ? 'P' : lc === 'deprecated' ? 'D' : 'A';
              return (
                <g key={n.id}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isHi || isSel ? r + 2 : r}
                    fill={color.fill}
                    fillOpacity={isHi || isSel ? 1 : 0.75}
                    stroke={isSel ? '#fff' : isHi ? '#f59e0b' : color.stroke}
                    strokeOpacity={isHi || isSel ? 1 : 0.6}
                    strokeWidth={isSel ? 2.5 : isHi ? 2 : 1}
                    style={{ cursor: 'pointer', transition: 'r 0.1s' }}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={(ev) => { ev.stopPropagation(); setSelectedId(prev => prev === n.id ? null : n.id); }}
                  />
                  {lc && r >= 6 && (
                    <text x={p.x} y={p.y + 3} textAnchor="middle" fill={lcColor} fontSize={8} fontWeight="bold" fontFamily="ui-monospace" pointerEvents="none">
                      {lcLetter}
                    </text>
                  )}
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
                  #{hovered.id} [{hovered.lifecycle || 'active'}] {String(hovered.label || '').slice(0, 35)}
                </text>
              </g>
            )}
          </svg>

          {/* Edge type legend */}
          <div className="mt-2 flex flex-wrap gap-3">
            {Object.entries(EDGE_STYLES).map(([key, s]) => (
              <div key={key} className="flex items-center gap-1.5">
                <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={s.stroke} strokeWidth="1.5" strokeDasharray={s.dash} /></svg>
                <span className="text-[9px] font-mono text-nexus-text-faint">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Click-to-detail sidebar */}
        {selectedId && (() => {
          const node = graph.nodes.find(n => n.id === selectedId);
          if (!node) return null;
          const edges = (graph.edges || []).filter(e => e.from === selectedId || e.to === selectedId);
          return (
            <div className="w-64 shrink-0 bg-nexus-bg border border-nexus-border rounded-xl p-4 max-h-[400px] overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-nexus-amber">#{node.id}</span>
                <button onClick={() => setSelectedId(null)} className="text-nexus-text-faint hover:text-nexus-text text-xs">✕</button>
              </div>
              <p className="text-sm text-nexus-text mb-2">{node.label}</p>
              <div className="space-y-2 text-[10px] font-mono text-nexus-text-faint">
                <div className="flex gap-2">
                  <span className="text-nexus-text-faint">Project:</span>
                  <span className="text-nexus-text" style={{ color: hashProjectColor(node.project).fill }}>{node.project}</span>
                </div>
                <div className="flex gap-2">
                  <span>Lifecycle:</span>
                  <span className={node.lifecycle === 'validated' ? 'text-nexus-green' : node.lifecycle === 'deprecated' ? 'text-nexus-text-faint' : 'text-nexus-amber'}>{node.lifecycle || 'active'}</span>
                </div>
                <div className="flex gap-2">
                  <span>Connections:</span>
                  <span className="text-nexus-text">{edges.length}</span>
                </div>
                {edges.length > 0 && (
                  <div className="pt-2 border-t border-nexus-border/50">
                    <p className="mb-1 text-nexus-text-faint uppercase tracking-wider">Edges</p>
                    {edges.slice(0, 10).map(e => {
                      const otherId = e.from === selectedId ? e.to : e.from;
                      const other = graph.nodes.find(n => n.id === otherId);
                      const style = EDGE_STYLES[e.rel] || EDGE_STYLES.related;
                      return (
                        <button key={e.id} onClick={() => setSelectedId(otherId)}
                          className="block w-full text-left py-1 hover:text-nexus-amber transition-colors">
                          <span style={{ color: style.stroke }}>{style.label}</span>
                          <span className="text-nexus-text-dim"> → #{otherId} {other?.label?.slice(0, 30) || '?'}</span>
                        </button>
                      );
                    })}
                    {edges.length > 10 && <p className="text-nexus-text-faint">+{edges.length - 10} more</p>}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
