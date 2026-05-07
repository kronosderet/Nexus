import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { GitBranch, Target, AlertTriangle, BarChart3, Link2, RefreshCw, Search, ChevronRight, Network, Check, X, Loader2, Sparkles } from 'lucide-react';
import { api } from '../hooks/useApi.js';
import { useNexusFleet } from '../context/useNexus.js';
import { THEME, PROJECT_PALETTE, EDGE_STYLES, LIFECYCLE_COLORS } from '../lib/theme.js';
import { LAYOUT_FNS, LAYOUTS, DEFAULT_LAYOUT } from '../lib/graphLayouts.js';
import CentralityView from './graph/CentralityView.jsx';
import ContradictionsView from './graph/ContradictionsView.jsx';
import HolesView from './graph/HolesView.jsx';
import DecisionPicker from '../components/DecisionPicker.jsx';

// v4.6.6 #332 — layout-mode persistence key. Single source of truth so reads
// and writes can't drift if we ever rename it.
const LAYOUT_STORAGE_KEY = 'nexus.graph.visual.layout';
function readSavedLayout() {
  try {
    if (typeof window === 'undefined') return DEFAULT_LAYOUT;
    const v = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUTS.some(l => l.id === v) ? v : DEFAULT_LAYOUT;
  } catch { return DEFAULT_LAYOUT; }
}
function writeSavedLayout(id) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, id);
  } catch { /* localStorage unavailable — silent */ }
}

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
    <div className="animate-page-mount">
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
      {view === 'overview' && <OverviewView graph={graph} centrality={centrality} contradictions={contradictions} holes={holes} onSwitchView={setView} />}
      {view === 'blast' && <BlastView blastId={blastId} setBlastId={setBlastId} onRun={runBlast} result={blastResult} graph={graph} centrality={centrality} DecisionPicker={DecisionPicker} onAnalyzeLatest={analyzeLatest} depth={blastDepth} setDepth={setBlastDepth} />}
      {view === 'centrality' && <CentralityView data={centrality} onPickBlast={jumpToBlast} onPickVisual={jumpToVisual} />}
      {view === 'contradictions' && <ContradictionsView data={contradictions} onRefresh={() => graphSlice.refresh()} />}
      {view === 'holes' && <HolesView data={holes} onLinkOrphan={(id) => jumpToBlast(id)} onJumpToVisual={jumpToVisual} onRefresh={() => graphSlice.refresh()} DecisionPicker={DecisionPicker} />}
      {view === 'visual' && <VisualView graph={graph} initialSelectedId={visualFocusId} onSelected={setVisualFocusId} focusProject={focusProject} onFocusConsumed={() => setFocusProject(null)} />}
    </div>
  );
}

// v4.5.7 #274 — edge-type list with inline expand. Click a row to see the first
// 8 edges of that type with decision endpoints. State local so clicking one row
// doesn't affect others. Decision labels derived from graph.nodes (already loaded).
function EdgeTypesList({ edgeTypes, graph, relatedBreakdown }) {
  const [openType, setOpenType] = useState(null);
  const nodesById = useMemo(() => {
    const m = new Map();
    for (const n of graph?.nodes || []) m.set(n.id, n);
    return m;
  }, [graph]);
  const maxCount = Math.max(...Object.values(edgeTypes), 1);
  return (
    <>
      {Object.entries(edgeTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
        const isOpen = openType === type;
        const sampleEdges = isOpen
          ? (graph?.edges || []).filter(e => e.rel === type).slice(0, 8)
          : [];
        return (
          <div key={type}>
            <button
              type="button"
              onClick={() => setOpenType(isOpen ? null : type)}
              className="flex items-center gap-2 w-full text-left rounded px-1 py-0.5 hover:bg-nexus-bg/50 transition-colors"
              aria-expanded={isOpen}
              title={`Click to ${isOpen ? 'collapse' : 'see a sample of'} ${type} edges`}
            >
              <span className="text-[9px] text-nexus-text-faint w-3">{isOpen ? '▾' : '▸'}</span>
              <span className="text-xs font-mono text-nexus-text-dim w-24">{type}</span>
              <div className="flex-1 h-1.5 bg-nexus-bg rounded-full">
                <div className="h-full bg-nexus-amber/50 rounded-full" style={{ width: `${(count / maxCount) * 100}%` }} />
              </div>
              <span className="text-xs font-mono text-nexus-text-faint w-8 text-right">{count}</span>
            </button>
            {/* v4.3.10 #271 — related-origin breakdown (preserved) */}
            {type === 'related' && count > 0 && (
              <div className="flex items-center gap-3 mt-0.5 ml-8 text-[9px] font-mono text-nexus-text-faint">
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
            {/* v4.5.7 #274 — drill-down preview */}
            {isOpen && sampleEdges.length > 0 && (
              <div className="ml-8 mt-1 mb-2 pl-3 border-l border-nexus-border/60 space-y-1">
                {sampleEdges.map((e) => {
                  const fromDec = nodesById.get(e.from);
                  const toDec = nodesById.get(e.to);
                  return (
                    <div key={e.id} className="text-[10px] font-mono text-nexus-text-faint leading-relaxed">
                      <span className="text-nexus-text-dim">#{e.from}</span>
                      <span className="text-nexus-text-faint"> {fromDec ? fromDec.label.slice(0, 36) : '(deleted)'} </span>
                      <span className="text-nexus-amber">→</span>
                      <span className="text-nexus-text-dim"> #{e.to}</span>
                      <span className="text-nexus-text-faint"> {toDec ? toDec.label.slice(0, 36) : '(deleted)'}</span>
                      {e.note && <span className="text-nexus-text-faint/70 ml-2">· {e.note.slice(0, 60)}</span>}
                    </div>
                  );
                })}
                {count > 8 && (
                  <p className="text-[9px] font-mono text-nexus-text-faint italic">
                    + {count - 8} more — use Visual view to explore the full set
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// v4.5.10 #280 — auto-link similarity threshold setting. Stored in localStorage
// so the preference survives reloads. Currently advisory — the server's
// threshold is still hardcoded; this is a UI control that the future
// /api/ledger/auto-link will read. For v4.5.10, the value is displayed on the
// auto-link preview so users know what's in play and can plan for a future
// server-side hookup. Exposing as a setting now beats shipping no surface.
const AUTOLINK_THRESHOLD_KEY = 'nexus:autolink:similarity';
const AUTOLINK_THRESHOLD_DEFAULT = 0.7;
function getAutolinkThreshold() {
  const raw = typeof window !== 'undefined' ? window.localStorage.getItem(AUTOLINK_THRESHOLD_KEY) : null;
  const n = raw == null ? AUTOLINK_THRESHOLD_DEFAULT : parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : AUTOLINK_THRESHOLD_DEFAULT;
}
function setAutolinkThreshold(v) {
  if (typeof window !== 'undefined') window.localStorage.setItem(AUTOLINK_THRESHOLD_KEY, String(v));
}

// v4.6.5 #281 — By-Project list with sort-mode toggle. Defaults to count-desc
// (most-decisions-first) but lets users switch to alphabetical or count-asc
// for finding small/dormant projects.
function ByProjectPanel({ projects }) {
  const [sortMode, setSortMode] = useState('countDesc');
  const entries = Object.entries(projects);
  if (sortMode === 'alpha') entries.sort((a, b) => a[0].localeCompare(b[0]));
  else if (sortMode === 'countAsc') entries.sort((a, b) => a[1] - b[1]);
  else entries.sort((a, b) => b[1] - a[1]); // countDesc default
  const max = Math.max(...Object.values(projects), 1);
  return (
    <div className="col-span-2 bg-nexus-surface border border-nexus-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">By Project</span>
        <div className="flex gap-1">
          {[
            { key: 'countDesc', label: 'Count ↓' },
            { key: 'alpha', label: 'A → Z' },
            { key: 'countAsc', label: 'Count ↑' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setSortMode(key)}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                sortMode === key
                  ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/30'
                  : 'border-nexus-border text-nexus-text-faint hover:text-nexus-text'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        {entries.map(([proj, count]) => (
          <div key={proj} className="flex items-center gap-2">
            <span className="text-xs font-mono text-nexus-text-dim w-24">{proj}</span>
            <div className="flex-1 h-1.5 bg-nexus-bg rounded-full"><div className="h-full bg-nexus-purple/50 rounded-full" style={{ width: `${(count / max) * 100}%` }} /></div>
            <span className="text-xs font-mono text-nexus-text-faint w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewView({ graph, centrality, contradictions, holes, onSwitchView }) {
  // v4.5.10 #279 — orphan count card links to Holes tab. Card is clickable
  // (matches Conflicts card pattern) so users can jump straight to the
  // "actionable list" from the stat. When zero, card stays decorative.
  const orphansClickable = (holes?.totalOrphans || 0) > 0 && !!onSwitchView;
  // v4.5.10 #280 — threshold state + handler
  const [threshold, setThreshold] = useState(getAutolinkThreshold());
  const saveThreshold = (v) => { setAutolinkThreshold(v); setThreshold(v); };
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
      {/* v4.5.7 #275 — zero-state copy was "All clear" (green), which reads as false
          reassurance: 162 decisions with zero contradicts edges typically means
          nobody has flagged any, not that nothing conflicts. Rephrase so the chip
          honestly tells you the system hasn't been fed data yet. Non-zero case
          retains the "Needs attention" signal. */}
      <StatCard
        label="Conflicts"
        value={contradictions?.total || 0}
        sub={
          contradictions?.total > 0
            ? 'Needs attention'
            : (graph?.nodes?.length || 0) >= 10
            ? 'None flagged yet'
            : 'No graph data'
        }
        color={contradictions?.total > 0 ? 'text-nexus-amber' : 'text-nexus-text-dim'}
      />
      {/* v4.3.9 #313 / v4.5.10 #279 — orphan count card is now clickable, linking
          to the Holes tab when there's something to act on. */}
      <div
        onClick={orphansClickable ? () => onSwitchView('holes') : undefined}
        className={orphansClickable ? 'cursor-pointer hover:scale-[1.01] transition-transform' : ''}
        title={orphansClickable ? 'Open Holes tab' : undefined}
      >
        <StatCard
          label="Holes"
          value={holes?.totalOrphans || 0}
          sub={
            (holes?.totalOrphans || 0) > 0
              ? `orphan decision${holes?.totalOrphans !== 1 ? 's' : ''}${holes?.totalFragmented > 0 ? ` · ${holes?.totalFragmented} fragmented` : ''}${orphansClickable ? ' →' : ''}`
              : 'Well connected'
          }
          color={(holes?.totalOrphans || 0) > 0 ? 'text-nexus-amber' : 'text-nexus-green'}
        />
      </div>

      {/* Edge types — v4.5.7 #274: rows clickable to drill into the edge list
          for that type. Expanded inline (no modal) showing first 8 edges with
          decision endpoints and note snippets. Full paginated drill-down with
          bulk ops lives as follow-up work; this closes the "dead number" UX
          by giving one click between count and content. */}
      <div className="col-span-2 bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Edge Types</span>
        <div className="mt-2 space-y-1">
          <EdgeTypesList edgeTypes={edgeTypes} graph={graph} relatedBreakdown={relatedBreakdown} />
        </div>
      </div>

      {/* Projects — v4.6.5 #281: sort-mode toggle (count desc default · alpha · count asc) */}
      <ByProjectPanel projects={projects} />

      {/* v4.5.10 #280 — auto-link similarity threshold setting. UI-side for now;
          localStorage persists the value. Future server hookup will read this. */}
      <div className="col-span-4 bg-nexus-surface border border-nexus-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <span className="text-xs font-mono text-nexus-text-faint uppercase tracking-wider">Auto-link similarity threshold</span>
            <p className="text-[10px] font-mono text-nexus-text-faint mt-1">
              Minimum semantic similarity for auto-linking two decisions. Higher = fewer but more confident links.
              <span className="text-nexus-text-dim"> Currently advisory — auto-link previews will display this value; server hookup is queued.</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0.4"
              max="0.95"
              step="0.05"
              value={threshold}
              onChange={(e) => saveThreshold(parseFloat(e.target.value))}
              className="w-32"
              title={`threshold = ${threshold}`}
            />
            <span className="text-xs font-mono text-nexus-amber tabular-nums w-10 text-right">{threshold.toFixed(2)}</span>
          </div>
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

  // v4.5.10 #289 — recent analyses quick-pick chips, cached in localStorage.
  // Writes when the user successfully runs an analysis (tracked by result change).
  const RECENT_KEY = 'nexus:blast:recent';
  const [recentPicks, setRecentPicks] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });
  useEffect(() => {
    if (!result?.decision?.id) return;
    setRecentPicks(prev => {
      const entry = {
        id: result.decision.id,
        label: String(result.decision.decision || '').slice(0, 40),
        ts: Date.now(),
      };
      const next = [entry, ...prev.filter(e => e.id !== entry.id)].slice(0, 6);
      try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [result?.decision?.id]);

  // v4.5.10 #290 — "highly connected" strip from Centrality. Shows the top-5
  // architectural hubs as one-click chips. Different affordance from the
  // suggestions above (which includes "most recent" — a temporal signal).
  const highlyConnected = (centrality?.centrality || []).slice(0, 5);

  const runFor = (id) => {
    setBlastId(String(id));
    // onRun reads blastId from parent scope — set + fire in microtask order
    queueMicrotask(() => onRun());
  };

  // v4.5.7 #288 — pre-submit preview. When the user has entered/selected a valid
  // ID but hasn't clicked Analyze yet, render the decision text below the input
  // so they can confirm they have the right target. Uses graph.nodes (already
  // loaded) so no extra fetch. Suppressed when a result is already showing
  // (redundant) and when the input can't be parsed to a number.
  const previewId = (() => {
    const n = parseInt(blastId, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const previewNode = previewId != null ? (graph?.nodes || []).find(n => n.id === previewId) : null;

  return (
    <div>
      {/* v4.6.5 #291 — "What is Blast Radius?" info popover. Renders as a
          dismissible help banner at the top of the view (always-visible —
          no localStorage dismiss, the feature is small enough that it just
          stays out of the way without being annoying). */}
      <details className="mb-3 group">
        <summary className="cursor-pointer text-[10px] font-mono text-nexus-text-faint hover:text-nexus-text inline-flex items-center gap-1.5">
          <span className="text-nexus-blue">ⓘ</span> What is Blast Radius?
        </summary>
        <div className="mt-2 px-3 py-2 rounded-lg bg-nexus-blue/5 border border-nexus-blue/20 text-[11px] font-mono text-nexus-text-dim leading-relaxed">
          <p className="mb-1.5">
            <strong className="text-nexus-blue">Blast Radius</strong> traces every decision connected to a starting decision via typed edges (`led_to`, `depends_on`, `informs`, etc.) up to N hops out.
          </p>
          <p className="mb-1.5">
            <strong>Use it to answer:</strong> "If I deprecate or change this decision, what else is affected?" The result is a depth-ordered tree of downstream decisions, with the blast count colored by severity (green &lt; 2, amber 2-5, red &gt; 5).
          </p>
          <p>
            <strong>Pick a decision:</strong> the textbox accepts an ID or free-text search. The "Latest" button auto-targets the most recent decision. The "Highly connected" chips below feed off the Centrality view — those are the architectural hubs where blast radius matters most.
          </p>
        </div>
      </details>

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
      {/* v4.5.7 #288 — pre-submit preview. Shows up as soon as a valid decision
          ID is in the textbox, BEFORE clicking Analyze, so users can verify
          the target before paying the query cost. */}
      {previewNode && !result && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-nexus-blue/20 bg-nexus-blue/5">
          <span className="text-[10px] font-mono text-nexus-blue uppercase tracking-wider shrink-0 mt-0.5">Will analyze</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-nexus-text">
              <span className="font-mono text-nexus-text-faint mr-1">#{previewNode.id}</span>
              {String(previewNode.label || '').slice(0, 180)}
            </p>
            {previewNode.project && (
              <p className="text-[10px] font-mono text-nexus-text-faint mt-0.5">
                project: {previewNode.project}{previewNode.lifecycle ? ` · ${previewNode.lifecycle}` : ''}
              </p>
            )}
          </div>
        </div>
      )}
      {/* v4.5.10 #289 — recent-analyses strip (above all else when populated).
          localStorage-backed. Ephemeral state so don't mix with suggested/highlyConnected. */}
      {recentPicks.length > 0 && (
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider">Recent:</span>
          {recentPicks.map(s => (
            <button
              key={s.id}
              onClick={() => runFor(s.id)}
              className="px-2 py-0.5 rounded-full border border-nexus-blue/30 hover:bg-nexus-blue/10 text-[10px] font-mono text-nexus-blue transition-colors"
              title={`${s.label} (last analyzed ${new Date(s.ts).toLocaleDateString()})`}
            >
              #{s.id}
            </button>
          ))}
          <button
            onClick={() => { try { window.localStorage.removeItem(RECENT_KEY); } catch {} setRecentPicks([]); }}
            className="text-[9px] font-mono text-nexus-text-faint hover:text-nexus-text"
            title="Clear recent analyses"
          >
            ✕ clear
          </button>
        </div>
      )}

      {/* v4.3.10 #284 — empty-state explainer + suggested chips so users aren't staring at
          a sterile textbox wondering which ID to try.
          v4.5.10 #290 — added "highly connected" strip from Centrality for cross-tab
          intelligence; users who come to Blast via Centrality don't have to re-pick. */}
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
          {highlyConnected.length > 0 && (
            <>
              <span className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-wider block mt-3 mb-1.5">
                Highly connected (from Centrality)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {highlyConnected.map(c => (
                  <button
                    key={c.id}
                    onClick={() => runFor(c.id)}
                    className="px-2.5 py-1 rounded-full border border-nexus-amber/30 hover:bg-nexus-amber/10 text-[10px] font-mono text-nexus-text-dim hover:text-nexus-amber transition-colors text-left max-w-xs"
                    title={String(c.decision || '').slice(0, 180)}
                  >
                    <span className="text-nexus-amber">#{c.id}</span>
                    <span className="text-nexus-text-faint"> · {c.total} edges · </span>
                    <span className="truncate">{String(c.decision || '').slice(0, 36)}</span>
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

// CentralityView + its private SortableHeader helper extracted to
// `./graph/CentralityView.jsx` in v4.7.2 (#217 part 2). Imported above.

// ContradictionsView (and its 4 private helpers — ResolveConflictCard,
// ScanContradictionsPanel, SuggestedContradictionCard, FlagContradictionForm)
// extracted to `./graph/ContradictionsView.jsx` in v4.7.2 (#217 part 2).
// Imported above.

// HolesView (with its private ClusterMiniViz helper) extracted to
// `./graph/HolesView.jsx` in v4.7.2 (#217 part 2). Imported above.

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
  // v4.6.6 #332 — layout mode: 'force' (default) | 'circular' | 'hierarchical'.
  // Persisted in localStorage so the choice survives reloads. Algorithms live
  // in `client/src/lib/graphLayouts.js` (extraction also lays groundwork for #217).
  const [layoutMode, setLayoutMode] = useState(readSavedLayout);
  useEffect(() => { writeSavedLayout(layoutMode); }, [layoutMode]);
  // v4.5.8 #328 — fetched decision details (full text, connections, linked tasks).
  // Thin loading state so the panel doesn't jitter during slice swaps.
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  useEffect(() => {
    if (selectedId == null) { setDetails(null); return; }
    let cancelled = false;
    setDetailsLoading(true);
    api.getLedgerConnections(selectedId)
      .then(r => { if (!cancelled) setDetails(r); })
      .catch(() => { if (!cancelled) setDetails(null); })
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

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

  // v4.6.6 #332 — layout dispatch. Algorithms live in lib/graphLayouts.js so
  // VisualView stays focused on rendering. Switching layoutMode re-runs the
  // memo; same {positions, degree, components, nodeComponent} shape across all
  // three so the render code below is layout-agnostic.
  const layout = useMemo(() => {
    const fn = LAYOUT_FNS[layoutMode] || LAYOUT_FNS[DEFAULT_LAYOUT];
    return fn({
      nodes: graph?.nodes || [],
      edges: graph?.edges || [],
      width: WIDTH,
      height: HEIGHT,
    });
  }, [graph, layoutMode]);

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
          v4.3.10 #326 adds the caption so the chips' legend role is explicit.
          v4.5.10 #333 — caption clarified: these chips FILTER (hide) projects; they don't
          HIGHLIGHT. Previously ambiguous — new users assumed click = highlight. */}
      {(() => {
        const projectSet = [...new Set(graph.nodes.map(n => n.project))].sort();
        return (
          <div className="mb-3">
            <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider block mb-1.5">
              Projects (click to <span className="text-nexus-amber">hide/show</span> · colors match node circles · use search to highlight)
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
        {/* v4.6.6 #332 — layout switcher. Pills mirror by-project/by-cluster style. */}
        <div className="flex gap-0.5 border border-nexus-border rounded" role="group" aria-label="Graph layout">
          {LAYOUTS.map(l => (
            <button
              key={l.id}
              onClick={() => setLayoutMode(l.id)}
              className={`text-[10px] font-mono px-2 py-1 transition-colors ${layoutMode === l.id ? 'bg-nexus-amber/10 text-nexus-amber' : 'text-nexus-text-faint hover:text-nexus-text'}`}
              title={l.tooltip}
              aria-pressed={layoutMode === l.id}
            >
              {l.label}
            </button>
          ))}
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

          {/* Edge type legend — v4.6.5 #282: hover tooltip explains the semantic
              meaning of each rel type (sourced from EDGE_STYLES.tooltip). */}
          <div className="mt-2 flex flex-wrap gap-3">
            {Object.entries(EDGE_STYLES).map(([key, s]) => (
              <div
                key={key}
                className="flex items-center gap-1.5 cursor-help"
                title={s.tooltip ? `${s.label} — ${s.tooltip}` : s.label}
              >
                <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={s.stroke} strokeWidth="1.5" strokeDasharray={s.dash} /></svg>
                <span className="text-[9px] font-mono text-nexus-text-faint border-b border-dashed border-nexus-text-faint/40">{s.label}</span>
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

        {/* Click-to-detail sidebar — v4.5.8 #328 enriched version.
            Fetches /api/ledger/:id/connections for full decision text, tags,
            linked tasks, and connected decisions. Edges grouped by rel type
            so typed backbone is visible at a glance. */}
        {selectedId && (() => {
          const node = graph.nodes.find(n => n.id === selectedId);
          if (!node) return null;
          // Graph-edges fallback so the panel is responsive before the fetch lands.
          const fallbackEdges = (graph.edges || []).filter(e => e.from === selectedId || e.to === selectedId);
          const connected = details?.connected || null;
          const linkedTasks = details?.linkedTasks || [];
          const fullDecision = details?.decision?.decision || node.label;
          const tags = details?.decision?.tags || node.tags || [];
          const lifecycle = details?.decision?.lifecycle || node.lifecycle || 'active';
          const project = details?.decision?.project || node.project;
          const lastReviewed = details?.decision?.last_reviewed_at;
          // Group connected entries by rel for the edges section.
          const byRel = {};
          if (connected) {
            for (const c of connected) {
              const rel = c.edge.rel || 'related';
              if (!byRel[rel]) byRel[rel] = [];
              byRel[rel].push(c);
            }
          }
          const relOrder = ['led_to', 'depends_on', 'contradicts', 'informs', 'experimental', 'replaced', 'related'];
          return (
            <div className="w-72 shrink-0 bg-nexus-bg border border-nexus-border rounded-xl p-4 max-h-[600px] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-nexus-amber">#{node.id}</span>
                <button onClick={() => setSelectedId(null)} className="text-nexus-text-faint hover:text-nexus-text text-xs" title="Close (or click background)">✕</button>
              </div>
              <p className="text-sm text-nexus-text mb-3 leading-snug whitespace-pre-wrap">{fullDecision}</p>
              {detailsLoading && !details && (
                <p className="text-[10px] font-mono text-nexus-text-faint italic mb-2">Loading details…</p>
              )}
              <div className="space-y-2 text-[10px] font-mono text-nexus-text-faint">
                <div className="flex gap-2">
                  <span>Project:</span>
                  <span style={{ color: hashProjectColor(project).fill }}>{project}</span>
                </div>
                <div className="flex gap-2">
                  <span>Lifecycle:</span>
                  <span className={lifecycle === 'validated' ? 'text-nexus-green' : lifecycle === 'deprecated' ? 'text-nexus-text-faint' : 'text-nexus-amber'}>{lifecycle}</span>
                </div>
                {lastReviewed && (
                  <div className="flex gap-2">
                    <span>Reviewed:</span>
                    <span className="text-nexus-text-dim">{new Date(lastReviewed).toISOString().slice(0, 10)}</span>
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="flex gap-2 flex-wrap items-baseline">
                    <span>Tags:</span>
                    <span className="flex flex-wrap gap-1">
                      {tags.map(t => (
                        <span key={t} className="px-1.5 py-0 rounded-full bg-nexus-amber/10 text-nexus-amber border border-nexus-amber/30 text-[9px]">{t}</span>
                      ))}
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span>Connections:</span>
                  <span className="text-nexus-text">{connected ? connected.length : fallbackEdges.length}</span>
                </div>

                {/* Edges grouped by rel type */}
                {connected && connected.length > 0 && (
                  <div className="pt-2 border-t border-nexus-border/50">
                    <p className="mb-1.5 text-nexus-text-faint uppercase tracking-wider">Edges</p>
                    {relOrder.filter(r => byRel[r]?.length).map(rel => {
                      const style = EDGE_STYLES[rel] || EDGE_STYLES.related;
                      return (
                        <div key={rel} className="mb-2 last:mb-0">
                          <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: style.stroke }}>
                            {style.label} <span className="text-nexus-text-faint normal-case">({byRel[rel].length})</span>
                          </p>
                          {byRel[rel].map(c => {
                            const otherId = c.decision.id;
                            return (
                              <button key={c.edge.id} onClick={() => setSelectedId(otherId)}
                                className="block w-full text-left py-0.5 hover:text-nexus-amber transition-colors text-[10px]">
                                <span className="text-nexus-text-dim">→ #{otherId} {String(c.decision.decision || '').slice(0, 32)}{c.decision.decision?.length > 32 ? '…' : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Linked tasks — v4.5.8 #328. Shows tasks whose decision_ids includes this id. */}
                {linkedTasks.length > 0 && (
                  <div className="pt-2 border-t border-nexus-border/50">
                    <p className="mb-1.5 text-nexus-text-faint uppercase tracking-wider">Linked tasks</p>
                    {linkedTasks.map(t => (
                      <div key={t.id} className="py-0.5 text-[10px]">
                        <span className={`mr-1.5 ${t.status === 'done' ? 'text-nexus-green' : t.status === 'in_progress' ? 'text-nexus-amber' : 'text-nexus-text-faint'}`}>
                          [{t.status}]
                        </span>
                        <span className="text-nexus-text-dim">#{t.id} {String(t.title).slice(0, 40)}{t.title.length > 40 ? '…' : ''}</span>
                      </div>
                    ))}
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
