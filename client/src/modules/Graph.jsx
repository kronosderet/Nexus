import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { GitBranch, Target, AlertTriangle, BarChart3, Link2, RefreshCw, Search, ChevronRight, Network, Check, X, Loader2, Sparkles } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { useNexusFleet } from '../context/useNexus.js';
import { THEME, PROJECT_PALETTE, EDGE_STYLES, LIFECYCLE_COLORS } from '../lib/theme.js';
import DecisionPicker from '../components/DecisionPicker.jsx';

// v4.3.5 P4: shared tabs constant so the inline render + keyboard handler agree on order.
const GRAPH_TABS = [
  { key: 'overview',       label: 'Overview',     icon: BarChart3 },
  { key: 'blast',          label: 'Blast Radius', icon: Target },
  { key: 'centrality',     label: 'Centrality',   icon: Link2 },
  { key: 'contradictions', label: 'Conflicts',    icon: AlertTriangle },
  { key: 'holes',          label: 'Holes',        icon: Search },
  { key: 'visual',         label: 'Visual',       icon: Network },
];

export default function GraphModule({ navOptions }) {
  const { graph: graphSlice } = useNexusFleet();
  const [view, setView] = useState('overview');
  const [blastId, setBlastId] = useState('');
  const [blastResult, setBlastResult] = useState(null);
  // v4.4.5 #380 — project focus hint from nav payload. When set, Visual view seeds
  // hiddenProjects to hide everything BUT this project. Consumed once per navigation.
  const [focusProject, setFocusProject] = useState(null);
  useEffect(() => {
    if (navOptions?.graphView) setView(navOptions.graphView);
    if (navOptions?.focusProject) setFocusProject(navOptions.focusProject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navOptions]);

  // v4.3.5 I4: delegated tab handler — one stable useCallback instead of 6 inline closures per render.
  const onSelectTab = useCallback((e) => {
    const tab = e.currentTarget.dataset.tab;
    if (tab) setView(tab);
  }, []);

  // v4.3.5 P4: keyboard nav for the tablist — ArrowLeft/Right cycles, Home/End jump to edges.
  // Follows the ARIA Authoring Practices "tabs with automatic activation" pattern.
  const onTabKeyDown = useCallback((e) => {
    const keys = GRAPH_TABS.map(t => t.key);
    const currentIdx = keys.indexOf(view);
    if (currentIdx < 0) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % keys.length;
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + keys.length) % keys.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = keys.length - 1;
    if (nextIdx === -1) return;
    e.preventDefault();
    const nextKey = keys[nextIdx];
    setView(nextKey);
    // Focus the newly-active tab so keyboard users see selection follow focus.
    const btn = document.getElementById(`graph-tab-${nextKey}`);
    if (btn && typeof btn.focus === 'function') btn.focus();
  }, [view]);

  const graph = graphSlice.data?.graph || null;
  const centrality = graphSlice.data?.centrality || null;
  const contradictions = graphSlice.data?.contradictions || null;
  const holes = graphSlice.data?.holes || null;
  const loading = graphSlice.loading;

  // v4.3.10 #272 — two-phase auto-link: preview then confirm. Users get a count +
  // sample edges before any writes happen, so they can see whether to proceed.
  const [autoLinkPreview, setAutoLinkPreview] = useState(null);
  const [autoLinkBusy, setAutoLinkBusy] = useState(false);
  async function autoLinkPreviewRun() {
    setAutoLinkBusy(true);
    try {
      const preview = await api.autoLinkGraphPreview();
      setAutoLinkPreview(preview);
    } catch {} finally { setAutoLinkBusy(false); }
  }
  async function autoLinkConfirm() {
    setAutoLinkBusy(true);
    try {
      await api.autoLinkGraph();
      setAutoLinkPreview(null);
      graphSlice.refresh();
    } catch {} finally { setAutoLinkBusy(false); }
  }
  function autoLinkCancel() { setAutoLinkPreview(null); }

  // v4.4.3 #287 — depth slider state shared between BlastView and the analysis call.
  const [blastDepth, setBlastDepth] = useState(3);
  async function runBlast() {
    if (!blastId) return;
    try { setBlastResult(await api.getImpactBlast(blastId, { depth: blastDepth })); } catch {}
  }

  // v4.4.2 #286, #296, #329 — cross-tab navigation helpers. Other views call these to
  // jump into Blast Radius or Visual with a decision pre-focused.
  const [visualFocusId, setVisualFocusId] = useState(null);
  async function jumpToBlast(decisionId) {
    const idStr = String(decisionId);
    setBlastId(idStr);
    setView('blast');
    // Fire the analysis in the next tick so setBlastId takes effect before runBlast reads it
    try {
      setBlastResult(await api.getImpactBlast(idStr, { depth: blastDepth }));
    } catch {}
  }
  function jumpToVisual(decisionId) {
    setVisualFocusId(decisionId);
    setView('visual');
  }
  function analyzeLatest() {
    if (!graph?.nodes?.length) return;
    const latest = [...graph.nodes].sort((a, b) => b.id - a.id)[0];
    if (latest) jumpToBlast(latest.id);
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
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-nexus-text flex items-center gap-2">
            <GitBranch size={18} className="text-nexus-amber" />
            Knowledge Graph
          </h2>
          <p className="text-xs font-mono text-nexus-text-faint mt-1">
            {graph?.nodes.length || 0} decisions, {graph?.edges.length || 0} connections. The architecture in context.
          </p>
        </div>
        {/* v4.4.2 #277 — freshness stamp + manual refresh for the graph slice. Pairs with
            Fuel view's "read Nm ago" pattern; makes it clear the graph isn't live. */}
        <button
          onClick={() => graphSlice.refresh()}
          disabled={graphSlice.loading}
          className="flex items-center gap-1 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber px-2 py-1 rounded border border-transparent hover:border-nexus-border transition-colors"
          title="Refresh graph data (edges, centrality, holes, contradictions)"
        >
          <RefreshCw size={10} className={graphSlice.loading ? 'animate-spin' : ''} />
          {graphSlice.loading ? 'refreshing…' : 'refresh'}
        </button>
      </div>

      {/* Tab bar — v4.3.5 P4: ARIA tablist + keyboard nav (Arrow/Home/End) */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-nexus-border pb-2" role="tablist" aria-label="Knowledge graph views" onKeyDown={onTabKeyDown}>
        {GRAPH_TABS.map(tab => {
          const Icon = tab.icon;
          const selected = view === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              id={`graph-tab-${tab.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              data-tab={tab.key}
              onClick={onSelectTab}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                selected
                  ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20'
                  : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
              }`}
            >
              <Icon size={12} aria-hidden="true" />{tab.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={autoLinkPreviewRun}
          disabled={autoLinkBusy || !!autoLinkPreview}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber border border-nexus-border rounded transition-colors disabled:opacity-50"
          title="Preview proposed auto-links before committing"
        >
          <RefreshCw size={10} /> Auto-link
        </button>
      </div>

      {/* v4.3.10 #272 — preview panel shown when autoLinkPreview is populated.
          Displays proposed count + up to 10 sample edges, with Confirm/Cancel. */}
      {autoLinkPreview && (
        <div className="mb-4 bg-nexus-surface border border-nexus-amber/30 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm text-nexus-text">
              Auto-link preview &mdash; would create <span className="text-nexus-amber">{autoLinkPreview.linked}</span> new edge{autoLinkPreview.linked !== 1 ? 's' : ''}
            </h3>
            <span className="text-[10px] font-mono text-nexus-text-faint">
              graph would grow to {autoLinkPreview.totalEdges + autoLinkPreview.linked}
            </span>
          </div>
          {autoLinkPreview.samples?.length > 0 && (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {autoLinkPreview.samples.map((s, i) => (
                <div key={i} className="text-[10px] font-mono text-nexus-text-faint flex items-baseline gap-2">
                  <span className="text-nexus-amber shrink-0">#{s.from}</span>
                  <span className="text-nexus-text-dim">&rarr;</span>
                  <span className="text-nexus-amber shrink-0">#{s.to}</span>
                  <span className="text-nexus-blue shrink-0">[{s.rel}]</span>
                  <span className="truncate" title={s.note}>{s.note}</span>
                </div>
              ))}
              {autoLinkPreview.linked > autoLinkPreview.samples.length && (
                <p className="text-[10px] font-mono text-nexus-text-faint pl-2">
                  &hellip; +{autoLinkPreview.linked - autoLinkPreview.samples.length} more (samples capped at 10)
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={autoLinkConfirm}
              disabled={autoLinkBusy || autoLinkPreview.linked === 0}
              className="px-3 py-1 rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/30 text-xs font-mono hover:bg-nexus-amber/20 disabled:opacity-50"
            >
              {autoLinkBusy ? 'Committing&hellip;' : `Commit ${autoLinkPreview.linked} edge${autoLinkPreview.linked !== 1 ? 's' : ''}`}
            </button>
            <button
              onClick={autoLinkCancel}
              disabled={autoLinkBusy}
              className="px-3 py-1 rounded border border-nexus-border text-xs font-mono text-nexus-text-faint hover:text-nexus-text disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Views */}
      {view === 'overview' && <OverviewView graph={graph} centrality={centrality} contradictions={contradictions} holes={holes} />}
      {view === 'blast' && <BlastView blastId={blastId} setBlastId={setBlastId} onRun={runBlast} result={blastResult} graph={graph} centrality={centrality} DecisionPicker={DecisionPicker} onAnalyzeLatest={analyzeLatest} depth={blastDepth} setDepth={setBlastDepth} />}
      {view === 'centrality' && <CentralityView data={centrality} onPickBlast={jumpToBlast} onPickVisual={jumpToVisual} />}
      {view === 'contradictions' && <ContradictionsView data={contradictions} onRefresh={() => graphSlice.refresh()} />}
      {view === 'holes' && <HolesView data={holes} onLinkOrphan={(id) => jumpToBlast(id)} onRefresh={() => graphSlice.refresh()} DecisionPicker={DecisionPicker} />}
      {view === 'visual' && <VisualView graph={graph} initialSelectedId={visualFocusId} onSelected={setVisualFocusId} focusProject={focusProject} onFocusConsumed={() => setFocusProject(null)} />}
    </div>
  );
}

function OverviewView({ graph, centrality, contradictions, holes }) {
  // Edge type breakdown
  const edgeTypes = {};
  for (const e of graph?.edges || []) edgeTypes[e.rel] = (edgeTypes[e.rel] || 0) + 1;

  // v4.3.10 #271 — classify `related` edges by origin. store.ts marks them:
  //   "auto-linked (N% keyword overlap)"      → keyword-auto (sync)
  //   "semantic-linked (N% cosine similarity)" → semantic-auto (async embeddings)
  //   everything else                          → manual (user-created via nexus_link_decisions)
  // Surfaces signal-vs-noise ratio on the dominant edge type (~76% `related` today).
  const relatedBreakdown = (() => {
    const bk = { keyword: 0, semantic: 0, manual: 0 };
    for (const e of graph?.edges || []) {
      if (e.rel !== 'related') continue;
      const note = String(e.note || '');
      if (note.includes('auto-linked')) bk.keyword++;
      else if (note.includes('semantic-linked')) bk.semantic++;
      else bk.manual++;
    }
    return bk;
  })();

  // Project breakdown
  const projects = {};
  for (const n of graph?.nodes || []) projects[n.project] = (projects[n.project] || 0) + 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard label="Decisions" value={graph?.nodes.length || 0} sub="Total indexed" />
      <StatCard label="Connections" value={graph?.edges.length || 0} sub={`Avg ${centrality?.averageConnections || '?'} per node`} />
      <StatCard label="Conflicts" value={contradictions?.total || 0} sub={contradictions?.total > 0 ? 'Needs attention' : 'All clear'} color={contradictions?.total > 0 ? 'text-nexus-amber' : 'text-nexus-green'} />
      {/* v4.3.9 #313 — Overview chip was showing totalHoles (fragmented-project count = 1) while
          the Holes tab headlines totalOrphans (= 7). Same concept, different metric. Align on
          totalOrphans (more actionable — isolated decisions you can fix) and show fragmented
          projects in the sub-label so both numbers are visible. */}
      <StatCard
        label="Holes"
        value={holes?.totalOrphans || 0}
        sub={
          (holes?.totalOrphans || 0) > 0
            ? `orphan decision${holes?.totalOrphans !== 1 ? 's' : ''}${holes?.totalFragmented > 0 ? ` · ${holes?.totalFragmented} fragmented` : ''}`
            : 'Well connected'
        }
        color={(holes?.totalOrphans || 0) > 0 ? 'text-nexus-amber' : 'text-nexus-green'}
      />

      {/* Edge types */}
      <div className="col-span-2 bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Edge Types</span>
        <div className="mt-2 space-y-1">
          {Object.entries(edgeTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <div key={type}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-nexus-text-dim w-24">{type}</span>
                <div className="flex-1 h-1.5 bg-nexus-bg rounded-full"><div className="h-full bg-nexus-amber/50 rounded-full" style={{ width: `${(count / (Math.max(...Object.values(edgeTypes)) || 1)) * 100}%` }} /></div>
                <span className="text-xs font-mono text-nexus-text-faint w-8 text-right">{count}</span>
              </div>
              {/* v4.3.10 #271 — `related` origin breakdown so auto-link noise is separable from
                  real manual links. Only shown for the dominant type. */}
              {type === 'related' && count > 0 && (
                <div className="flex items-center gap-3 pl-26 mt-0.5 ml-24 text-[9px] font-mono text-nexus-text-faint">
                  <span title="Auto-linked by keyword overlap (store.ts _autoLinkDecision)">
                    keyword-auto <span className="text-nexus-text-dim">{relatedBreakdown.keyword}</span>
                  </span>
                  <span className="text-nexus-border">·</span>
                  <span title="Auto-linked by semantic similarity (embeddings + cosine)">
                    semantic-auto <span className="text-nexus-text-dim">{relatedBreakdown.semantic}</span>
                  </span>
                  <span className="text-nexus-border">·</span>
                  <span title="Manually linked via nexus_link_decisions">
                    manual <span className={relatedBreakdown.manual > 0 ? 'text-nexus-green' : 'text-nexus-text-dim'}>{relatedBreakdown.manual}</span>
                  </span>
                </div>
              )}
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

function BlastView({ blastId, setBlastId, onRun, result, graph, centrality, DecisionPicker, onAnalyzeLatest, depth = 3, setDepth }) {
  // v4.3.10 #284 — build 3-5 suggested decision chips from graph + centrality data so
  // first-time users have zero-cost starting points. Previously an empty textbox with a
  // placeholder "e.g. 44" (arbitrary, no context). Suggestions:
  //   - most-recent decision (highest ID, likely what user just recorded)
  //   - top 3 highest-centrality (architectural hubs — interesting blast targets)
  const suggestions = (() => {
    const picks = [];
    const seen = new Set();
    const push = (id, reason, label) => {
      if (id == null || seen.has(id)) return;
      seen.add(id);
      picks.push({ id, reason, label });
    };
    // Most-recent decision (highest numeric ID)
    if (graph?.nodes?.length) {
      const latest = [...graph.nodes].sort((a, b) => b.id - a.id)[0];
      if (latest) push(latest.id, 'most recent', String(latest.label || '').slice(0, 40));
    }
    // Top-3 highest centrality
    const topCentral = (centrality?.centrality || []).slice(0, 3);
    for (const c of topCentral) {
      push(c.id, `${c.total} edges`, String(c.decision || '').slice(0, 40));
    }
    return picks;
  })();

  const runFor = (id) => {
    setBlastId(String(id));
    // onRun reads blastId from parent scope — set + fire in microtask order
    queueMicrotask(() => onRun());
  };

  return (
    <div>
      {/* v4.4.1 #285 — DecisionPicker replaces plain numeric input. Type-search by ID,
          text, project, or tag; dropdown shows top-8 matches; Enter or click to select. */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="w-80">
          <DecisionPicker
            value={blastId}
            onChange={setBlastId}
            onSelect={() => queueMicrotask(() => onRun())}
            placeholder="Decision ID or text search..."
          />
        </div>
        <button onClick={onRun} className="px-4 py-2 rounded-lg bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/20 text-xs font-mono hover:bg-nexus-amber/20">
          Analyze
        </button>
        {/* v4.4.2 #286 — one-click shortcut to analyze the most recent decision. Uses
            graph.nodes (already loaded) to find the highest ID; no extra fetch. */}
        {onAnalyzeLatest && (
          <button
            onClick={onAnalyzeLatest}
            className="px-3 py-2 rounded-lg border border-nexus-border hover:border-nexus-amber/30 hover:text-nexus-amber text-xs font-mono text-nexus-text-dim transition-colors"
            title="Analyze the most recently recorded decision"
          >
            Latest
          </button>
        )}
        {/* v4.4.3 #287 — depth slider (1-4 hops). Default 3. Higher = more diffuse, shallower
            = focus on immediate neighbors. */}
        {setDepth && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-nexus-border bg-nexus-bg">
            <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider">Depth</span>
            {[1, 2, 3, 4].map(n => (
              <button
                key={n}
                onClick={() => setDepth(n)}
                className={`w-6 h-6 rounded text-[10px] font-mono transition-colors ${
                  depth === n
                    ? 'bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/30'
                    : 'text-nexus-text-faint hover:text-nexus-text border border-transparent'
                }`}
                title={`${n} hop${n !== 1 ? 's' : ''} — ${n === 1 ? 'immediate neighbors only' : n >= 4 ? 'full transitive closure' : 'moderate reach'}`}
              >
                {n}
              </button>
            ))}
            <span className="text-[9px] font-mono text-nexus-text-faint">hops</span>
          </div>
        )}
      </div>
      {/* v4.3.10 #284 — empty-state explainer + suggested chips so users aren't staring at
          a sterile textbox wondering which ID to try. */}
      {!result && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5 mb-2">
          <p className="text-xs text-nexus-text-dim mb-3">
            Blast Radius traces all decisions connected to a starting decision, up to 3 hops
            out. Use it to understand the architectural impact of changing or deprecating a
            decision.
          </p>
          {suggestions.length > 0 && (
            <>
              <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider block mb-1.5">
                Try one
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => runFor(s.id)}
                    className="px-2.5 py-1 rounded-full border border-nexus-border hover:border-nexus-amber/50 hover:bg-nexus-amber/5 text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber transition-colors text-left max-w-xs"
                    title={s.label}
                  >
                    <span className="text-nexus-amber">#{s.id}</span>
                    <span className="text-nexus-text-dim"> · {s.reason} · </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
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

function CentralityView({ data, onPickBlast, onPickVisual }) {
  // v4.4.3 #298 — pagination beyond the top-15 cap. Most users care about top hubs, but
  // scrolling through the long tail matters for orphan-hunting and validation work.
  const [page, setPage] = useState(15);
  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-mono text-nexus-text-faint">Avg {data?.averageConnections} connections per decision</p>
        {/* v4.3.10 #295 — quick explainer so newcomers know what they're reading */}
        <span
          className="text-[10px] font-mono text-nexus-text-faint cursor-help border-b border-dashed border-nexus-text-faint"
          title="Centrality = number of edges (connections) per decision. High-centrality decisions are architectural hubs — changing them affects a lot. This ranks by degree centrality."
        >
          what&rsquo;s this?
        </span>
      </div>
      {/* v4.3.10 #293 — column header so the count column is no longer ambiguous */}
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-nexus-border">
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider w-8">ID</span>
        <span className="flex-1 text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Centrality</span>
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider w-6 text-right">Edges</span>
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider w-48">Decision</span>
      </div>
      <div className="space-y-1.5">
        {data?.centrality?.slice(0, page).map(c => (
          // v4.4.2 #296 — entire row is a clickable button that jumps to Blast Radius
          // with this decision pre-filled and auto-analyzed. Also shows a "view in graph"
          // icon on hover for deep-linking into Visual (#329).
          <div key={c.id} className="flex items-center gap-2 group">
            <button
              onClick={() => onPickBlast && onPickBlast(c.id)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-nexus-amber/5 rounded px-1 -mx-1 py-0.5 transition-colors"
              title="Open Blast Radius for this decision"
            >
              <span className="text-xs font-mono text-nexus-text-faint w-8">#{c.id}</span>
              <div className="flex-1 h-2 bg-nexus-bg rounded-full">
                <div className="h-full bg-nexus-amber/60 rounded-full" style={{ width: `${Math.min(100, c.total * 5)}%` }} />
              </div>
              <span
                className="text-xs font-mono text-nexus-text-dim w-6 text-right"
                title={`${c.total} edge${c.total !== 1 ? 's' : ''} in the knowledge graph`}
              >{c.total}</span>
              <span
                className="text-xs text-nexus-text-dim truncate w-48 cursor-pointer"
                title={`${c.decision}\n\nClick: open Blast Radius`}
              >{c.decision}</span>
            </button>
            {/* v4.4.2 #329 — jump to Visual tab focused on this node */}
            {onPickVisual && (
              <button
                onClick={() => onPickVisual(c.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-nexus-text-faint hover:text-nexus-amber px-1.5 py-0.5 rounded border border-transparent hover:border-nexus-border"
                title="Focus this node in the Visual tab"
              >
                <Network size={10} />
              </button>
            )}
          </div>
        ))}
        {/* v4.4.3 #298 — pagination footer */}
        {data?.centrality?.length > page && (
          <div className="pt-3 flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.min(data.centrality.length, p + 15))}
              className="text-[10px] font-mono text-nexus-amber hover:text-nexus-amber/80 px-3 py-1 rounded border border-nexus-amber/30 hover:bg-nexus-amber/5"
            >
              Show {Math.min(15, data.centrality.length - page)} more
            </button>
            <span className="text-[9px] font-mono text-nexus-text-faint">
              Showing {page} of {data.centrality.length}
            </span>
            {data.centrality.length > page && (
              <button
                onClick={() => setPage(data.centrality.length)}
                className="text-[9px] font-mono text-nexus-text-faint hover:text-nexus-amber"
              >
                Show all
              </button>
            )}
          </div>
        )}
        {data?.centrality?.length > 0 && page >= data.centrality.length && data.centrality.length > 15 && (
          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setPage(15)}
              className="text-[9px] font-mono text-nexus-text-faint hover:text-nexus-amber"
            >
              Collapse to top 15
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ContradictionsView({ data, onRefresh }) {
  // v4.4.4 #309 — lifetime counter row. Even when active=0, show how many conflicts
  // have ever been flagged and how many resolved (one side marked deprecated) so the
  // tab communicates state instead of looking dead. `historical` is computed server-side.
  const hist = data?.historical;
  const suggestions = data?.suggestions || [];
  return (
    <div className="space-y-4">
      {/* v4.4.8 #307 — Overseer scan panel. Async runs the LLM contradiction scan,
          polls for completion, then refreshes the graph slice so suggestions appear
          inline. Lives at the top of the view because it's the primary "act on this
          tab" affordance now. */}
      <ScanContradictionsPanel onComplete={onRefresh} />

      {/* v4.4.8 #307 — suggestions section. Shows Overseer-proposed contradictions
          with accept/dismiss. Only renders when there are active suggestions. */}
      {suggestions.length > 0 && (
        <div className="bg-nexus-surface border border-nexus-blue/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-nexus-blue" />
            <h3 className="text-xs font-mono text-nexus-blue uppercase tracking-wider">Suggested by Overseer</h3>
            <span className="text-[10px] font-mono text-nexus-text-faint ml-auto">{suggestions.length} pending review</span>
          </div>
          <div className="space-y-2">
            {suggestions.map(s => <SuggestedContradictionCard key={s.id} suggestion={s} onDecision={onRefresh} />)}
          </div>
        </div>
      )}

      {/* v4.4.4 #309 — always-visible historical counter row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 text-center">
          <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Active</p>
          <p className={`text-xl font-light tabular-nums ${data?.total > 0 ? 'text-nexus-amber' : 'text-nexus-green'}`}>{data?.total ?? 0}</p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 text-center" title="Conflicts ever flagged — potential auto-detected plus manually marked via rel=contradicts edges.">
          <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Ever flagged</p>
          <p className="text-xl font-light tabular-nums text-nexus-text-dim">{hist?.total ?? 0}</p>
        </div>
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 text-center" title="Flagged conflicts where at least one decision was later marked deprecated — the opposition no longer applies to an active decision.">
          <p className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider mb-1">Resolved</p>
          <p className="text-xl font-light tabular-nums text-nexus-green">{hist?.resolved ?? 0}</p>
        </div>
      </div>

      {/* v4.4.4 #308 — expanded educational copy. The v4.3.10 version answered "what
          is this tab" but not "how do I use it" or "why should I care". Three Q/A
          blocks cover: definition, motivation, workflow. Still dismissible feel via
          the "No conflicts flagged" lead when empty. */}
      {data?.total === 0 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-nexus-amber shrink-0 mt-0.5" />
            <div className="space-y-3 text-xs font-mono text-nexus-text-faint leading-relaxed">
              <p className="text-sm text-nexus-text font-sans">No active conflicts.</p>

              <div>
                <p className="text-nexus-text-dim mb-1">What is a conflict?</p>
                <p>
                  Two decisions that oppose each other — different paths chosen at different times, or the same question answered two ways across projects.
                  Conflicts are tracked via <code className="mx-0.5 px-1 py-0.5 rounded bg-nexus-bg text-nexus-amber">rel=&lsquo;contradicts&rsquo;</code> edges in the knowledge graph.
                </p>
              </div>

              <div>
                <p className="text-nexus-text-dim mb-1">Why should I care?</p>
                <p>
                  Without this view, contradictions sit silently in the Ledger — you rediscover them only when re-reading. Flagging makes them visible next session,
                  so you (or the Overseer) can either reconcile the two, mark the old one deprecated, or split the context by project.
                </p>
              </div>

              <div>
                <p className="text-nexus-text-dim mb-1">How do I use it?</p>
                <p>
                  Use the form below to flag a conflict — pick the two decisions, optionally add a note explaining the contradiction. The counter row above tracks
                  lifetime flags and resolutions. Useful when: you changed direction, two projects took opposing paths, or a decision was superseded without being marked deprecated.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* v4.4.1 #306 — manual "Flag contradiction" form. Two DecisionPickers + note + submit.
          Creates a rel='contradicts' edge via /api/ledger/link. Tab was previously read-only. */}
      <FlagContradictionForm onFlagged={onRefresh} />

      {data?.contradictions?.map((c, i) => (
        <div key={i} className="bg-nexus-red/5 border border-nexus-red/20 rounded-lg p-3">
          <p className="text-xs text-nexus-text-dim">{c.message}</p>
          {c.trigger && <span className="text-[10px] font-mono text-nexus-red mt-1 inline-block">Trigger: {c.trigger}</span>}
        </div>
      ))}
    </div>
  );
}

// v4.4.8 #307 — Overseer scan panel. Kicks off the async contradiction scan
// and polls until the Overseer returns, then calls onComplete so the parent
// ContradictionsView refetches and renders the new suggestions. The scan itself
// persists results server-side (via _suggestedContradictions), so the client
// only needs to poll for completion and trigger a refresh.
function ScanContradictionsPanel({ onComplete }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [elapsed, setElapsed] = useState(0);
  const [taskId, setTaskId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function startScan() {
    setStatus('running');
    setError(null);
    setResult(null);
    setElapsed(0);
    try {
      const start = await api.scanContradictions({
        max_pairs: 20,
        similarity_threshold: 0.65,
        confidence_threshold: 0.55,
      });
      if (start.error) {
        setStatus('error'); setError(start.error); return;
      }
      setTaskId(start.taskId);
    } catch (e) {
      setStatus('error');
      setError(e.message || 'Failed to start scan');
    }
  }

  // Poll every 3s while running. Stop when done/error or taskId cleared.
  useEffect(() => {
    if (!taskId || status !== 'running') return;
    const started = Date.now();
    const tick = setInterval(async () => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const poll = await api.getScanContradictionsResult(taskId);
        if (poll.status === 'done') {
          clearInterval(tick);
          setStatus('done');
          try { setResult(JSON.parse(poll.answer || '{}')); } catch { setResult({}); }
          // Refresh parent so the hydrated /impact/contradictions response with
          // fresh suggestions lands in the Graph slice.
          if (onComplete) onComplete();
        } else if (poll.status === 'error') {
          clearInterval(tick);
          setStatus('error');
          setError(poll.error || 'Overseer error');
        }
      } catch (e) {
        clearInterval(tick);
        setStatus('error');
        setError(e.message);
      }
    }, 3000);
    return () => clearInterval(tick);
  }, [taskId, status, onComplete]);

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-nexus-blue" />
          <span className="text-xs font-mono text-nexus-blue uppercase tracking-wider">Overseer Scan</span>
          <span className="text-[10px] font-mono text-nexus-text-faint hidden sm:inline">
            Find contradictions via embedding pairing + LLM classification
          </span>
        </div>
        <button
          onClick={startScan}
          disabled={status === 'running'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg border border-nexus-blue/30 text-nexus-blue hover:bg-nexus-blue/10 transition-colors disabled:opacity-50"
          title="Scans same-project decision pairs with cosine similarity ≥0.65; asks the Overseer to classify each. Stores accepted/dismissed decisions so pairs don't re-surface."
        >
          {status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {status === 'running' ? `Scanning… (${elapsed}s)` : 'Scan for contradictions'}
        </button>
      </div>
      {status === 'done' && result && (
        <p className="text-[10px] font-mono text-nexus-text-faint mt-2">
          {result.suggestions?.length > 0
            ? `◈ ${result.suggestions.length} new suggestion${result.suggestions.length === 1 ? '' : 's'} · evaluated ${result.pairs_evaluated ?? '?'} pairs.`
            : result.note || `No new contradictions found${result.pairs_evaluated ? ` (evaluated ${result.pairs_evaluated} pairs)` : ''}.`}
        </p>
      )}
      {status === 'error' && (
        <p className="text-[10px] font-mono text-nexus-red mt-2">◈ {error}</p>
      )}
    </div>
  );
}

// v4.4.8 #307 — card rendering for a single Overseer-proposed contradiction.
// Accept promotes to a real `rel='contradicts'` edge; dismiss marks as handled
// so the same pair doesn't re-surface on the next scan.
function SuggestedContradictionCard({ suggestion, onDecision }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const confPct = Math.round((suggestion.confidence || 0) * 100);
  const simPct = Math.round((suggestion.similarity || 0) * 100);

  async function act(action) {
    setBusy(true); setError(null);
    try {
      if (action === 'accept') await api.acceptSuggestedContradiction(suggestion.id);
      else await api.dismissSuggestedContradiction(suggestion.id);
      if (onDecision) onDecision();
    } catch (e) {
      setError(e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-nexus-bg border border-nexus-blue/20 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-nexus-blue/10 text-nexus-blue border border-nexus-blue/20" title="Overseer confidence × cosine similarity at pairing time">
          {confPct}% · sim {simPct}%
        </span>
        <span className="text-[10px] font-mono text-nexus-text-faint">
          #{suggestion.from_id} ↔ #{suggestion.to_id}
        </span>
      </div>
      <p className="text-xs text-nexus-text-dim italic mb-2 leading-relaxed">&ldquo;{suggestion.reason}&rdquo;</p>
      <div className="space-y-1 mb-3">
        <p className="text-[11px] text-nexus-text">
          <span className="font-mono text-nexus-text-faint">A </span>
          {suggestion.from_decision?.decision?.slice(0, 160)}
          {suggestion.from_decision?.lifecycle && (
            <span className="ml-1 text-[9px] font-mono text-nexus-text-faint">· {suggestion.from_decision.lifecycle}</span>
          )}
        </p>
        <p className="text-[11px] text-nexus-text">
          <span className="font-mono text-nexus-text-faint">B </span>
          {suggestion.to_decision?.decision?.slice(0, 160)}
          {suggestion.to_decision?.lifecycle && (
            <span className="ml-1 text-[9px] font-mono text-nexus-text-faint">· {suggestion.to_decision.lifecycle}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => act('accept')}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-nexus-red/30 text-nexus-red text-[10px] font-mono hover:bg-nexus-red/10 transition-colors disabled:opacity-50"
          title="Promote to a rel='contradicts' edge in the Ledger"
        >
          <Check size={10} /> Flag as conflict
        </button>
        <button
          onClick={() => act('dismiss')}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-nexus-border text-nexus-text-faint text-[10px] font-mono hover:text-nexus-text hover:border-nexus-text-faint transition-colors disabled:opacity-50"
          title="Hide this suggestion. The same pair won't re-surface in future scans."
        >
          <X size={10} /> Dismiss
        </button>
        {busy && <Loader2 size={10} className="animate-spin text-nexus-blue" />}
        {error && <span className="text-[10px] font-mono text-nexus-red">{error}</span>}
      </div>
    </div>
  );
}

function FlagContradictionForm({ onFlagged }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok'|'err', msg }

  async function submit() {
    const from = parseInt(fromId, 10);
    const to = parseInt(toId, 10);
    if (!from || !to || from === to) {
      setStatus({ type: 'err', msg: 'Pick two different decisions.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api.linkDecisions({ from, to, rel: 'contradicts', note: note.trim() || undefined });
      setStatus({ type: 'ok', msg: `Flagged #${from} ↔ #${to} as contradicting.` });
      setFromId(''); setToId(''); setNote('');
      if (onFlagged) onFlagged();
    } catch (e) {
      setStatus({ type: 'err', msg: (e?.message || 'Failed to flag').slice(0, 140) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-nexus-amber" />
        <h3 className="text-xs font-mono text-nexus-amber uppercase tracking-wider">Flag a contradiction</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <div>
          <span className="text-[10px] font-mono text-nexus-text-faint block mb-1">Decision A</span>
          <DecisionPicker value={fromId} onChange={setFromId} placeholder="Pick or type ID..." />
        </div>
        <div>
          <span className="text-[10px] font-mono text-nexus-text-faint block mb-1">Decision B (contradicts A)</span>
          <DecisionPicker value={toId} onChange={setToId} placeholder="Pick or type ID..." />
        </div>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note — why does A contradict B?"
        className="w-full mb-3 bg-nexus-bg border border-nexus-border rounded-lg px-3 py-2 text-xs text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !fromId || !toId}
          className="px-4 py-1.5 rounded bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/30 text-xs font-mono hover:bg-nexus-amber/20 disabled:opacity-50"
        >
          {busy ? 'Flagging…' : 'Flag contradiction'}
        </button>
        {status && (
          <span className={`text-[10px] font-mono ${status.type === 'ok' ? 'text-nexus-green' : 'text-nexus-red'}`}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}

function HolesView({ data, onLinkOrphan, onRefresh, DecisionPicker }) {
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

                {/* v4.4.1 #315 — rearchitected cluster rendering. Each cluster is a clearly
                    delimited card: prominent pill-shaped size badge, "Cluster of N" header,
                    then indented sample titles. Orphans get distinct styling (isolated, amber
                    border) because they're actionable differently from multi-decision clusters. */}
                <div className="space-y-2">
                  {p.clusters.slice(0, 5).map((c, i) => {
                    const isOrphan = c.size === 1;
                    const orphanId = isOrphan && Array.isArray(c.memberIds) ? c.memberIds[0] : null;
                    return (
                      <div
                        key={i}
                        className={`rounded-lg ${
                          isOrphan
                            ? 'bg-nexus-amber/5 border border-nexus-amber/30'
                            : 'bg-nexus-bg/40 border border-nexus-border'
                        }`}
                      >
                        {/* Badge + header row */}
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nexus-border/40">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0 ${
                              isOrphan
                                ? 'bg-nexus-amber/20 text-nexus-amber border border-nexus-amber/40'
                                : 'bg-nexus-text-faint/10 text-nexus-text-dim border border-nexus-border'
                            }`}
                          >
                            {isOrphan ? 'orphan' : `${c.size} decisions`}
                          </span>
                          <span className="text-[10px] font-mono text-nexus-text-faint flex-1">
                            {isOrphan ? 'isolated — no edges' : `cluster of ${c.size}`}
                          </span>
                          {/* v4.4.2 #316 — "Link this orphan" shortcut: jumps to Blast Radius
                              on the orphan, which is often enough to find its neighbors manually.
                              A dedicated link-picker modal is a future enhancement. */}
                          {isOrphan && orphanId != null && onLinkOrphan && (
                            <button
                              onClick={() => onLinkOrphan(orphanId)}
                              className="text-[10px] font-mono text-nexus-amber hover:text-nexus-amber/80 px-2 py-0.5 rounded border border-nexus-amber/30 hover:bg-nexus-amber/10 shrink-0"
                              title="Open Blast Radius for this orphan — find candidates to link via Auto-link preview."
                            >
                              Link →
                            </button>
                          )}
                        </div>
                        {/* Sample titles — clearly separated region */}
                        <div className="px-3 py-2 space-y-0.5">
                          {c.sampleTitles.map((title, j) => (
                            <p key={j} className="text-xs text-nexus-text-dim truncate" title={title}>
                              · {title}
                            </p>
                          ))}
                          {c.size > c.sampleTitles.length && (
                            <p className="text-[10px] font-mono text-nexus-text-faint pl-2 pt-0.5">
                              +{c.size - c.sampleTitles.length} more decision{c.size - c.sampleTitles.length !== 1 ? 's' : ''} in this cluster
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {p.clusters.length > 5 && (
                    <p className="text-[10px] font-mono text-nexus-text-faint pl-2 pt-1">
                      +{p.clusters.length - 5} more cluster{p.clusters.length - 5 !== 1 ? 's' : ''} not shown
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

      {/* Healthy projects summary — v4.4.3 #317: explicit "×N decisions" label;
          v4.4.3 #319: hygiene badge for known data-quality artifacts (DIREWOLF casing
          drift, "Projects" CC encoded-dir leak). Both were normalized by v4.3.9-H1 +
          v4.4.0-H2 migrations; if they show up again here, it's a regression signal. */}
      {healthy.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-[0.2em] mb-2">
            Healthy projects
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {healthy.map((p) => {
              const hygiene = (p.project === 'DIREWOLF' || p.project === 'Projects');
              return (
                <div
                  key={p.project}
                  className={`px-2 py-1 rounded-full text-[10px] font-mono border ${hygiene
                    ? 'bg-nexus-amber/5 text-nexus-amber border-nexus-amber/30'
                    : 'bg-nexus-green/5 text-nexus-green border-nexus-green/20'}`}
                  title={hygiene
                    ? `${p.project}: ${p.decisions} decision${p.decisions !== 1 ? 's' : ''} — data-quality artifact (should have been normalized by v4.3.9-H1 / v4.4.0-H2). Regression signal.`
                    : `${p.project}: ${p.decisions} decision${p.decisions !== 1 ? 's' : ''} — single connected graph`}
                >
                  {p.project} <span className="opacity-60">×{p.decisions} decision{p.decisions !== 1 ? 's' : ''}</span>
                  {hygiene && <span className="ml-1 text-[9px]">⚠</span>}
                </div>
              );
            })}
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

// v4.3.5 I5: palette + edge styles now live in lib/theme.js (mirror of index.css tokens).
function hashProjectColor(project) {
  if (!project) return PROJECT_PALETTE[0];
  let h = 0;
  for (let i = 0; i < project.length; i++) {
    h = (h * 31 + project.charCodeAt(i)) | 0;
  }
  return PROJECT_PALETTE[Math.abs(h) % PROJECT_PALETTE.length];
}

function VisualView({ graph, initialSelectedId, onSelected, focusProject, onFocusConsumed }) {
  const HEIGHT = 400;
  const [hoveredId, setHoveredId] = useState(null);
  // v4.4.2 #329 — accept initialSelectedId from parent so cross-tab "focus this node"
  // clicks (from Centrality or Holes) land on the Visual tab with the target already
  // selected + its detail sidebar open.
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? null);
  useEffect(() => {
    if (initialSelectedId != null) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);
  const [hiddenProjects, setHiddenProjects] = useState(new Set());
  // v4.4.5 #380 — seed hiddenProjects from Fleet "open in graph" jump.
  // Hides every project EXCEPT the focus target so user lands on a project-
  // isolated view. Consumed once; parent clears focusProject via onFocusConsumed.
  useEffect(() => {
    if (focusProject && graph?.nodes?.length) {
      const allProjects = new Set(graph.nodes.map(n => n.project).filter(Boolean));
      const hide = new Set([...allProjects].filter(p => p !== focusProject));
      setHiddenProjects(hide);
      if (onFocusConsumed) onFocusConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProject, graph]);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);
  // v4.4.3 #330 — search input state. Highlights matching node IDs + focuses first match.
  const [searchQuery, setSearchQuery] = useState('');
  // v4.4.3 #334 — edge-type filter: hide auto-linked `related` edges (keyword + semantic).
  // With 76% of edges being auto-linked `related`, this toggle exposes the typed backbone
  // (led_to / depends_on / contradicts / informs) for architectural clarity.
  const [hideAutoLinked, setHideAutoLinked] = useState(false);
  // v4.4.3 #335 — color mode: 'project' (default) or 'cluster' (connected-component).
  // Cluster mode makes the "5 disconnected clusters" claim visually verifiable.
  const [colorMode, setColorMode] = useState('project');

  // v4.3.5 I4: delegated project-toggle handler — one stable callback for N buttons.
  const onToggleProject = useCallback((e) => {
    const p = e.currentTarget.dataset.project;
    if (!p) return;
    setHiddenProjects(prev => {
      const s = new Set(prev);
      s.has(p) ? s.delete(p) : s.add(p);
      return s;
    });
  }, []);

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
    const nodeComponent = {};  // v4.4.3 #335 — node id → root (component) id
    for (const n of nodes) {
      const root = find(n.id);
      roots.add(root);
      nodeComponent[n.id] = root;
    }
    const components = roots.size;

    return { positions, degree, components, nodeComponent };
  }, [graph]);

  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return (
      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-8 text-center">
        <Network size={20} className="mx-auto text-nexus-text-faint mb-2" />
        <p className="text-xs font-mono text-nexus-text-dim">No graph data to visualize.</p>
      </div>
    );
  }

  const { positions, degree, components, nodeComponent } = layout;
  const maxDegree = Math.max(1, ...Object.values(degree || {}));
  const nodeRadius = (id) => {
    const d = (degree && degree[id]) || 0;
    return 4 + (d / maxDegree) * 8; // 4..12
  };

  const hovered = hoveredId != null
    ? graph.nodes.find((n) => n.id === hoveredId)
    : null;

  // v4.4.3 #330 — search matches: node IDs that match the query (by ID, text, project).
  // Matching nodes get a pulse ring; non-matching fade.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null; // no search = show all normally
    const matches = new Set();
    for (const n of (graph?.nodes || [])) {
      const idStr = String(n.id);
      const label = String(n.label || n.decision || '').toLowerCase();
      const project = String(n.project || '').toLowerCase();
      if (idStr === q || idStr.includes(q) || label.includes(q) || project.includes(q)) {
        matches.add(n.id);
      }
    }
    return matches;
  }, [searchQuery, graph?.nodes]);

  // v4.4.3 #335 — palette for cluster coloring. Cycles through a fixed set so
  // cluster identity is visually distinct without relying on project hash.
  const CLUSTER_PALETTE = ['#f5b043', '#4ec3e0', '#a78bfa', '#60d97e', '#f07178', '#d8b4fe', '#fbbf24', '#38bdf8'];
  const clusterColorFor = (nodeId) => {
    const root = nodeComponent?.[nodeId];
    if (!root) return { fill: '#94a3b8', stroke: '#64748b' };
    // Map root id to a palette index
    const idx = Math.abs(root) % CLUSTER_PALETTE.length;
    return { fill: CLUSTER_PALETTE[idx], stroke: CLUSTER_PALETTE[idx] };
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard label="Nodes" value={graph.nodes.length} sub="Decisions" />
        <StatCard label="Edges" value={graph.edges?.length || 0} sub="Connections" />
        <StatCard label="Components" value={components} sub={components === 1 ? 'Fully connected' : 'Disconnected clusters'} />
      </div>

      {/* Project toggle chips — double as color legend (each chip's color = its node color).
          v4.3.10 #326 adds the caption so the chips' legend role is explicit. */}
      {(() => {
        const projectSet = [...new Set(graph.nodes.map(n => n.project))].sort();
        return (
          <div className="mb-3">
            <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider block mb-1.5">
              Projects (click to filter · colors match node circles)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {projectSet.map(p => {
                const c = hashProjectColor(p);
                const hidden = hiddenProjects.has(p);
                return (
                  <button key={p} data-project={p} onClick={onToggleProject}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all ${hidden ? 'opacity-30 border-nexus-border text-nexus-text-faint' : 'border-current'}`}
                    style={{ color: hidden ? undefined : c.fill, borderColor: hidden ? undefined : c.fill + '40' }}>
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* v4.4.3 #330 + #334 + #335 — search input + edge filter + color mode toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-nexus-text-faint" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search node by ID / text / project..."
            className="w-full bg-nexus-bg border border-nexus-border rounded-lg pl-7 pr-2 py-1 text-[10px] text-nexus-text font-mono focus:border-nexus-amber focus:outline-none"
          />
          {searchMatches != null && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-nexus-text-faint">
              {searchMatches.size} match
            </span>
          )}
        </div>
        <button
          onClick={() => setHideAutoLinked(v => !v)}
          className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${hideAutoLinked ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/30' : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'}`}
          title={hideAutoLinked ? 'Showing typed backbone only (led_to / depends_on / contradicts / informs). Click to show all edges including auto-linked related.' : 'Click to hide auto-linked related edges (keyword + semantic) and reveal the typed backbone.'}
        >
          {hideAutoLinked ? '◆ Typed only' : 'Hide auto-linked'}
        </button>
        <div className="flex gap-0.5 border border-nexus-border rounded">
          <button
            onClick={() => setColorMode('project')}
            className={`text-[10px] font-mono px-2 py-1 transition-colors ${colorMode === 'project' ? 'bg-nexus-amber/10 text-nexus-amber' : 'text-nexus-text-faint hover:text-nexus-text'}`}
            title="Color nodes by project (default)"
          >
            by project
          </button>
          <button
            onClick={() => setColorMode('cluster')}
            className={`text-[10px] font-mono px-2 py-1 transition-colors ${colorMode === 'cluster' ? 'bg-nexus-amber/10 text-nexus-amber' : 'text-nexus-text-faint hover:text-nexus-text'}`}
            title="Color nodes by connected component (visualizes the 'N disconnected clusters' claim)"
          >
            by cluster
          </button>
        </div>
      </div>

      {/* v4.4.3 #331 — on-screen hint for interactive controls that were previously undocumented. */}
      <p className="text-[9px] font-mono text-nexus-text-faint mb-2 pl-1">
        drag node to move · click node for details · click outside to deselect
      </p>
      <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4 flex gap-4">
        <div ref={containerRef} className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            height={HEIGHT}
            className="block"
            style={{ background: THEME.bg, borderRadius: 8 }}
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
              // v4.4.3 #334 — hide auto-linked `related` edges when toggle is on.
              // Detection: edge.note prefixed with "auto-linked" (keyword) or
              // "semantic-linked" (semantic embeddings) — matches store.ts notes.
              if (hideAutoLinked && e.rel === 'related') {
                const note = String(e.note || '');
                if (note.startsWith('auto-linked') || note.startsWith('semantic-linked')) return null;
              }
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
              // v4.4.3 #335 — color mode toggle
              const color = colorMode === 'cluster' ? clusterColorFor(n.id) : hashProjectColor(n.project);
              const r = nodeRadius(n.id);
              const isHi = hoveredId === n.id;
              const isSel = selectedId === n.id;
              // v4.4.3 #330 — search fade: matching nodes stay opaque, non-matching dim
              const isSearchMatch = searchMatches == null || searchMatches.has(n.id);
              const searchFade = !isSearchMatch;
              const lc = n.lifecycle;
              const lcColor = LIFECYCLE_COLORS[lc] || LIFECYCLE_COLORS.active;
              // v4.3.10 #327 — added 'R' for v4.3.8 reference decisions (imported CC memories).
              // Previously reference lifecycle rendered as 'A', mislabeling nodes.
              const lcLetter = lc === 'validated' ? 'V' : lc === 'proposed' ? 'P' : lc === 'deprecated' ? 'D' : lc === 'reference' ? 'R' : 'A';
              return (
                <g key={n.id} opacity={searchFade ? 0.2 : 1}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isHi || isSel ? r + 2 : r}
                    fill={color.fill}
                    fillOpacity={isHi || isSel ? 1 : 0.75}
                    stroke={isSel ? THEME.white : isHi ? THEME.amber : color.stroke}
                    strokeOpacity={isHi || isSel ? 1 : 0.6}
                    strokeWidth={isSel ? 2.5 : isHi ? 2 : 1}
                    style={{ cursor: 'pointer', transition: 'r 0.1s' }}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={(ev) => { ev.stopPropagation(); setSelectedId(prev => prev === n.id ? null : n.id); }}
                  />
                  {/* v4.4.3 #330 — pulse ring on search-matched nodes to draw the eye */}
                  {searchMatches != null && isSearchMatch && searchQuery.trim() && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 4}
                      fill="none"
                      stroke={THEME.amber}
                      strokeOpacity={0.7}
                      strokeWidth={1.5}
                      pointerEvents="none"
                    >
                      <animate attributeName="r" values={`${r + 3};${r + 7};${r + 3}`} dur="1.5s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values="0.7;0.2;0.7" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}
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
                  fill={THEME.bg}
                  stroke={THEME.amber}
                  strokeOpacity={0.6}
                />
                <text
                  x={Math.min(WIDTH - 220, Math.max(4, positions[hovered.id].x + 10)) + 8}
                  y={Math.max(4, positions[hovered.id].y - 22) + 14}
                  fill={THEME.text}
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                >
                  {/* v4.3.10 #325 — include project so hover tooltip tells the full story. */}
                  #{hovered.id} [{hovered.project || 'general'} · {hovered.lifecycle || 'active'}] {String(hovered.label || '').slice(0, 30)}
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

          {/* v4.3.10 #327 — lifecycle letter legend. Letters inside node circles were cryptic
              without this key: V=validated, A=active, D=deprecated, P=proposed,
              R=reference (imported CC memory, v4.3.8). */}
          <div className="mt-2 flex flex-wrap gap-3 pt-2 border-t border-nexus-border/50">
            <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider mr-1">Lifecycle</span>
            {[
              { letter: 'A', label: 'active' },
              { letter: 'V', label: 'validated' },
              { letter: 'P', label: 'proposed' },
              { letter: 'D', label: 'deprecated' },
              { letter: 'R', label: 'reference (imported)' },
            ].map(({ letter, label }) => (
              <div key={letter} className="flex items-center gap-1">
                <span className="text-[9px] font-mono text-nexus-amber font-bold">{letter}</span>
                <span className="text-[9px] font-mono text-nexus-text-faint">= {label}</span>
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
