import { useState, useEffect } from 'react';
import { GitBranch, Target, AlertTriangle, BarChart3, Link2, RefreshCw, Search, ChevronRight } from 'lucide-react';

export default function GraphModule() {
  const [view, setView] = useState('overview'); // overview, blast, centrality, contradictions, holes
  const [graph, setGraph] = useState(null);
  const [centrality, setCentrality] = useState(null);
  const [contradictions, setContradictions] = useState(null);
  const [holes, setHoles] = useState(null);
  const [blastId, setBlastId] = useState('');
  const [blastResult, setBlastResult] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchAll() {
    setLoading(true);
    const [g, c, con, h] = await Promise.all([
      fetch('/api/ledger/graph/full').then(r => r.json()),
      fetch('/api/impact/centrality').then(r => r.json()),
      fetch('/api/impact/contradictions').then(r => r.json()),
      fetch('/api/impact/holes').then(r => r.json()),
    ]);
    setGraph(g);
    setCentrality(c);
    setContradictions(con);
    setHoles(h);
    setLoading(false);
  }

  async function autoLink() {
    await fetch('/api/ledger/auto-link', { method: 'POST' });
    fetchAll();
  }

  async function runBlast() {
    if (!blastId) return;
    const data = await fetch(`/api/impact/blast/${blastId}`).then(r => r.json());
    setBlastResult(data);
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
      <div className="flex gap-1 mb-4 border-b border-nexus-border pb-2">
        {[
          { key: 'overview', label: 'Overview', icon: BarChart3 },
          { key: 'blast', label: 'Blast Radius', icon: Target },
          { key: 'centrality', label: 'Centrality', icon: Link2 },
          { key: 'contradictions', label: 'Conflicts', icon: AlertTriangle },
          { key: 'holes', label: 'Holes', icon: Search },
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
