/**
 * CentralityView — degree-centrality ranking of decisions.
 *
 * Extracted from Graph.jsx in v4.7.2 (#217 part 2). Lifts the centrality
 * sub-view (~205L) plus its private SortableHeader helper into its own
 * module. Render code unchanged; only imports moved.
 *
 * Render contract: receives `data` shaped like `/api/impact/centrality`
 * (centrality[] with id/total/byType/weeklyDelta/priorTotal/decision/project,
 * averageConnections), plus two cross-tab callbacks (`onPickBlast` jumps to
 * the Blast Radius tab pre-filled, `onPickVisual` deep-links into the Visual
 * tab focused on the node).
 */
import { useState, useMemo } from 'react';
import { Network } from 'lucide-react';
import { PROJECT_PALETTE } from '../../lib/theme.js';

// v4.6.5 #303 — column header that flips its arrow on click. Co-located here
// because Centrality is currently the only consumer; lift to a shared module
// when a second view adopts sortable columns.
function SortableHeader({ label, sortKey, currentKey, currentDir, onSort, className = '', title }) {
  const active = currentKey === sortKey;
  const arrow = active ? (currentDir === 'desc' ? '↓' : '↑') : '';
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`text-[9px] font-mono uppercase tracking-wider hover:text-nexus-amber transition-colors text-left ${active ? 'text-nexus-amber' : 'text-nexus-text-faint'} ${className}`}
      title={title}
    >
      {label} {arrow && <span className="ml-0.5">{arrow}</span>}
    </button>
  );
}

export default function CentralityView({ data, onPickBlast, onPickVisual }) {
  // v4.4.3 #298 — pagination beyond the top-15 cap. Most users care about top hubs, but
  // scrolling through the long tail matters for orphan-hunting and validation work.
  const [page, setPage] = useState(15);
  // v4.5.7 #299 — filter to a single project. "most central Nexus decisions" is a
  // different question than "most central across the whole graph." Project list
  // derived from the current data rather than hardcoded so it stays in sync.
  const [projectFilter, setProjectFilter] = useState('all');
  const projects = useMemo(() => {
    const set = new Set();
    for (const c of data?.centrality || []) {
      if (c.project) set.add(c.project);
    }
    return Array.from(set).sort();
  }, [data]);
  // v4.6.5 #303 — sortable columns. Default centrality desc (count of edges).
  // Click a header to switch sort key + flip direction.
  const [sortKey, setSortKey] = useState('total');
  const [sortDir, setSortDir] = useState('desc');
  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };
  // v4.7.7 #304 — auto-generated insight on top-N project distribution.
  // Computes from the unfiltered centrality so the callout reflects the true
  // graph shape regardless of what the user has filtered to. Rotates as the
  // graph evolves; suppressed when sample is too thin to draw a conclusion.
  const insight = useMemo(() => {
    const TOP_N = 8;
    const all = data?.centrality || [];
    if (all.length < TOP_N) return null;
    const sorted = [...all].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const top = sorted.slice(0, TOP_N);
    const counts = {};
    for (const c of top) {
      const p = c.project || 'general';
      counts[p] = (counts[p] || 0) + 1;
    }
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return null;
    const [topProj, topCount] = ranked[0];
    const ratio = topCount / TOP_N;
    if (ratio >= 0.6) {
      return { tone: 'strong',  text: `Top-${TOP_N} centrality clusters around ${topProj} (${topCount}/${TOP_N}).` };
    }
    if (ratio >= 0.4) {
      return { tone: 'lean',    text: `Top-${TOP_N} leans toward ${topProj} (${topCount}/${TOP_N}, ${ranked.length - 1} other project${ranked.length - 1 !== 1 ? 's' : ''} represented).` };
    }
    return { tone: 'diverse',   text: `Top-${TOP_N} centrality spreads across ${ranked.length} projects.` };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.centrality) return [];
    let list = projectFilter === 'all'
      ? data.centrality
      : data.centrality.filter(c => (c.project || '').toLowerCase() === projectFilter.toLowerCase());
    list = [...list].sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'id') return (a.id - b.id) * dir;
      if (sortKey === 'wow') return ((a.weeklyDelta ?? 0) - (b.weeklyDelta ?? 0)) * dir;
      if (sortKey === 'project') return ((a.project || '').localeCompare(b.project || '')) * dir;
      // default: total
      return ((a.total ?? 0) - (b.total ?? 0)) * dir;
    });
    return list;
  }, [data, projectFilter, sortKey, sortDir]);

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
      {/* v4.7.7 #304 — auto-generated insight callout on top-N project distribution.
          Rotates as graph structure shifts (recomputes from current data). */}
      {insight && (
        <p className={`text-[11px] font-mono leading-relaxed mb-3 px-3 py-1.5 rounded-md border ${
          insight.tone === 'strong'
            ? 'text-nexus-amber bg-nexus-amber/5 border-nexus-amber/20'
            : insight.tone === 'lean'
              ? 'text-nexus-text-dim bg-nexus-bg/40 border-nexus-border'
              : 'text-nexus-text-faint bg-nexus-bg/40 border-nexus-border'
        }`}>
          ◈ {insight.text}
        </p>
      )}
      {/* v4.5.7 #299 — project filter chips. Only rendered when ≥2 projects are
          represented so single-project stores don't see a dead "All" toggle. */}
      {projects.length >= 2 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <span className="text-[9px] font-mono text-nexus-text-faint mr-1">Filter:</span>
          {['all', ...projects].map(p => (
            <button
              key={p}
              onClick={() => { setProjectFilter(p); setPage(15); }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition-colors ${
                projectFilter === p
                  ? 'bg-nexus-amber/10 text-nexus-amber border-nexus-amber/20'
                  : 'text-nexus-text-faint border-nexus-border hover:text-nexus-text'
              }`}
              style={p !== 'all' ? { borderLeftWidth: 3, borderLeftColor: PROJECT_PALETTE[p] || PROJECT_PALETTE.default } : undefined}
            >
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      )}
      {/* v4.3.10 #293 + v4.5.10 #300/#302 + v4.6.5 #303 — sortable column headers */}
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-nexus-border">
        <span className="w-1 shrink-0" />{/* color bar spacer */}
        <SortableHeader label="ID" sortKey="id" currentKey={sortKey} currentDir={sortDir} onSort={onSort} className="w-8" title="Sort by decision ID" />
        <SortableHeader label="Centrality" sortKey="total" currentKey={sortKey} currentDir={sortDir} onSort={onSort} className="flex-1" title="Sort by edge count (default)" />
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider w-6 text-right">Edges</span>
        <SortableHeader label="WoW" sortKey="wow" currentKey={sortKey} currentDir={sortDir} onSort={onSort} className="w-10 text-right" title="Sort by week-over-week edge delta" />
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider w-12" title="Edge types: typed (amber) · keyword-auto (cyan) · semantic-auto (purple) · manual (gray)">Types</span>
        <span className="text-[9px] font-mono text-nexus-text-faint uppercase tracking-wider w-48">Decision</span>
      </div>
      <div className="space-y-1.5">
        {filtered.slice(0, page).map(c => (
          // v4.4.2 #296 — entire row is a clickable button that jumps to Blast Radius
          // with this decision pre-filled and auto-analyzed. Also shows a "view in graph"
          // icon on hover for deep-linking into Visual (#329).
          <div key={c.id} className="flex items-center gap-2 group">
            {/* v4.5.7 #297 — project color-bar on the left edge so users can
                scan by domain without reading every line. Falls back to neutral
                when the project isn't in the palette. Tooltip reveals the name. */}
            <span
              className="w-1 h-5 rounded-full shrink-0"
              style={{ backgroundColor: c.project ? (PROJECT_PALETTE[c.project] || PROJECT_PALETTE.default) : '#334155' }}
              title={c.project ? `Project: ${c.project}` : 'No project'}
            />
            <button
              onClick={() => onPickBlast && onPickBlast(c.id)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-nexus-amber/5 rounded px-1 -mx-1 py-0.5 transition-colors"
              title={`Open Blast Radius for this decision${c.project ? ` · project: ${c.project}` : ''}`}
            >
              <span className="text-xs font-mono text-nexus-text-faint w-8">#{c.id}</span>
              <div className="flex-1 h-2 bg-nexus-bg rounded-full">
                <div className="h-full bg-nexus-amber/60 rounded-full" style={{ width: `${Math.min(100, c.total * 5)}%` }} />
              </div>
              <span
                className="text-xs font-mono text-nexus-text-dim w-6 text-right"
                title={`${c.total} edge${c.total !== 1 ? 's' : ''} in the knowledge graph`}
              >{c.total}</span>
              {/* v4.5.10 #302 — WoW delta chip. Shows +/− vs 7d ago. Muted when 0. */}
              {c.weeklyDelta != null && (
                <span
                  className={`text-[9px] font-mono tabular-nums w-10 text-right ${
                    c.weeklyDelta > 0 ? 'text-nexus-green' : c.weeklyDelta < 0 ? 'text-nexus-red' : 'text-nexus-text-faint'
                  }`}
                  title={`Week-over-week change: ${c.priorTotal} edges 7d ago → ${c.total} now`}
                >
                  {c.weeklyDelta > 0 ? `+${c.weeklyDelta}` : c.weeklyDelta === 0 ? '·' : c.weeklyDelta}
                </span>
              )}
              {/* v4.5.10 #300 — edge-type breakdown dots (typed / keyword / semantic / manual).
                  Each dot sized by count. Tooltip gives the exact numbers. */}
              {c.byType && (
                <span
                  className="flex items-center gap-0.5 w-12 shrink-0"
                  title={`Edge types: typed=${c.byType.typed} · keyword-auto=${c.byType.keyword} · semantic-auto=${c.byType.semantic} · manual=${c.byType.manual}`}
                >
                  {['typed', 'keyword', 'semantic', 'manual'].map((k, idx) => {
                    const n = c.byType[k] || 0;
                    const size = n === 0 ? 3 : n < 3 ? 5 : n < 8 ? 7 : 9;
                    const colors = { typed: '#f5b043', keyword: '#4ec3e0', semantic: '#a78bfa', manual: '#94a3b8' };
                    return (
                      <span
                        key={k}
                        className="rounded-full shrink-0"
                        style={{
                          width: size,
                          height: size,
                          backgroundColor: n === 0 ? 'transparent' : colors[k],
                          border: n === 0 ? `1px dashed ${colors[k]}40` : 'none',
                          opacity: n === 0 ? 0.3 : 0.8,
                        }}
                      />
                    );
                  })}
                </span>
              )}
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
        {filtered.length > page && (
          <div className="pt-3 flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.min(data.centrality.length, p + 15))}
              className="text-[10px] font-mono text-nexus-amber hover:text-nexus-amber/80 px-3 py-1 rounded border border-nexus-amber/30 hover:bg-nexus-amber/5"
            >
              Show {Math.min(15, filtered.length - page)} more
            </button>
            <span className="text-[9px] font-mono text-nexus-text-faint">
              Showing {page} of {filtered.length}{projectFilter !== 'all' ? ` (filtered: ${projectFilter})` : ''}
            </span>
            {filtered.length > page && (
              <button
                onClick={() => setPage(filtered.length)}
                className="text-[9px] font-mono text-nexus-text-faint hover:text-nexus-amber"
              >
                Show all
              </button>
            )}
          </div>
        )}
        {filtered.length > 0 && page >= filtered.length && filtered.length > 15 && (
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
