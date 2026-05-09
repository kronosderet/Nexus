/**
 * HolesView — structural-hole detection: fragmented projects, orphan
 * decisions, cross-project link map, batch auto-link.
 *
 * Extracted from Graph.jsx in v4.7.2 (#217 part 2). Lifts HolesView
 * (~354L) plus its private ClusterMiniViz mini-diagram helper into one
 * file. Render code unchanged; only imports moved.
 *
 * Render contract: receives `data` shaped like `/api/impact/holes`
 * (totalFragmented, totalOrphans, fragmented[], projectAnalysis[],
 * crossLinks{}). Three callbacks bridge into other tabs/views:
 * `onLinkOrphan` opens Blast Radius pre-filled, `onJumpToVisual` deep-
 * links into the Visual tab focused on a node, `onRefresh` is invoked
 * after a successful auto-link batch so the parent refetches. The
 * `DecisionPicker` prop is forwarded to the auto-link UI; passing it
 * via props (rather than importing here) preserves the v4.5.10 #322
 * shape and keeps the import surface narrow.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../hooks/useApi.js';
import { THEME, EDGE_STYLES } from '../../lib/theme.js';

// v4.5.8 #318 — tiny node-link diagram for a single cluster. Deterministic
// circle layout so position is stable across renders. Edges colored by rel type
// using the shared EDGE_STYLES palette. Click a node to jump to Visual-tab
// drilldown (onNodeClick fallback: no-op).
function ClusterMiniViz({ cluster, onNodeClick }) {
  const size = cluster.size;
  if (size < 2) return null; // orphans get the "Link →" shortcut, not a viz
  const W = 180;
  const H = 100;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) * 0.38;
  // Circle layout: each member on the perimeter at equal angle. Stable because
  // memberIds is already sorted by cluster formation (stable per scan).
  const pos = {};
  cluster.memberIds.forEach((id, i) => {
    const theta = (i / size) * Math.PI * 2 - Math.PI / 2;
    pos[id] = { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r };
  });
  const nodeR = size <= 4 ? 5 : size <= 8 ? 4 : 3;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block shrink-0">
      {(cluster.edges || []).map((e, i) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        const style = EDGE_STYLES[e.rel] || EDGE_STYLES.related;
        return (
          <line
            key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={style.stroke}
            strokeOpacity={0.6}
            strokeWidth={style.width || 1}
            strokeDasharray={style.dash}
          />
        );
      })}
      {cluster.memberIds.map((id) => {
        const p = pos[id];
        return (
          <circle
            key={id}
            cx={p.x} cy={p.y} r={nodeR}
            fill={THEME.amber}
            fillOpacity={0.7}
            stroke={THEME.amber}
            strokeWidth={1}
            style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            onClick={() => onNodeClick && onNodeClick(id)}
          >
            <title>#{id} — click to open in Visual</title>
          </circle>
        );
      })}
    </svg>
  );
}

export default function HolesView({ data, onLinkOrphan, onJumpToVisual, onRefresh, DecisionPicker }) {
  // v4.5.10 #321 — "Auto-link all orphans" batch action. Uses the existing
  // /api/ledger/auto-link endpoint with orphans_only=true. Two-phase: preview
  // first (dry run), then commit.
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchResult, setBatchResult] = useState(null);
  const runBatchPreview = async () => {
    setBatchBusy(true); setBatchResult(null);
    try { setBatchPreview(await api.autoLinkOrphansPreview()); }
    catch (e) { setBatchResult({ error: e.message }); }
    finally { setBatchBusy(false); }
  };
  const runBatchCommit = async () => {
    setBatchBusy(true);
    try {
      const r = await api.autoLinkOrphansCommit();
      setBatchResult({ linked: r.linked });
      setBatchPreview(null);
      if (onRefresh) onRefresh();
    } catch (e) {
      setBatchResult({ error: e.message });
    } finally { setBatchBusy(false); }
  };

  // v4.5.10 #322 — cross-project drill-down state. Click a pill → fetch hydrated
  // edge list via /api/impact/cross-links/:a/:b and show inline.
  const [drillKey, setDrillKey] = useState(null); // "A::B"
  const [drillData, setDrillData] = useState(null);
  const [drillBusy, setDrillBusy] = useState(false);
  const openDrill = async (a, b) => {
    const key = `${a}::${b}`;
    if (drillKey === key) { setDrillKey(null); setDrillData(null); return; }
    setDrillKey(key); setDrillData(null); setDrillBusy(true);
    try { setDrillData(await api.getCrossLinks(a, b)); }
    catch (e) { setDrillData({ error: e.message }); }
    finally { setDrillBusy(false); }
  };

  // v4.7.7 #323 — sort controls for the fragmented-projects list. Default
  // surfaces the most actionable items first (orphan-count desc); alpha and
  // recency follow the cross-tab pattern (Fleet #256, ByProject #281,
  // Centrality #303). Recency proxies via max memberId across clusters since
  // decision IDs grow monotonically.
  const [sortMode, setSortMode] = useState('orphansDesc');

  if (!data) return null;
  const fragmented = [...(data.fragmented || [])];
  const healthy = (data.projectAnalysis || []).filter((p) => !p.isFragmented);
  const crossLinks = Object.entries(data.crossLinks || {});

  const maxMemberId = (p) => {
    let best = 0;
    for (const c of p.clusters || []) {
      for (const id of c.memberIds || []) if (id > best) best = id;
    }
    return best;
  };
  if (sortMode === 'alpha') fragmented.sort((a, b) => a.project.localeCompare(b.project));
  else if (sortMode === 'recent') fragmented.sort((a, b) => maxMemberId(b) - maxMemberId(a));
  else fragmented.sort((a, b) => (b.orphans || 0) - (a.orphans || 0)); // orphansDesc default

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
            {/* v4.6.5 #324 — copy fix: "1 have" → "1 has" / "N have" so single-fragment case doesn't read like a typo */}
            {data.totalFragmented > 0 ? `${data.totalFragmented === 1 ? 'has' : 'have'} disconnected sub-clusters` : 'all decision graphs connected'}
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
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h3 className="text-[10px] font-mono text-nexus-amber uppercase tracking-[0.2em] flex items-center gap-2">
              <AlertTriangle size={11} /> Fragmented decision graphs
            </h3>
            {fragmented.length > 1 && (
              <div className="flex gap-1" role="group" aria-label="Sort fragmented projects">
                {[
                  { key: 'orphansDesc', label: 'Orphans ↓' },
                  { key: 'alpha',       label: 'A → Z' },
                  { key: 'recent',      label: 'Recent' },
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
            )}
          </div>
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
                  <div className="flex items-baseline gap-3">
                    {/* v4.5.10 #320 — fragmentation score as tracked metric.
                        0 = fully connected, 1 = every decision is an orphan.
                        Color scales with severity. */}
                    {p.fragmentationScore != null && (
                      <span
                        className={`text-[10px] font-mono tabular-nums ${
                          p.fragmentationScore >= 0.6 ? 'text-nexus-red' :
                          p.fragmentationScore >= 0.3 ? 'text-nexus-amber' :
                          'text-nexus-text-faint'
                        }`}
                        title="Fragmentation score: 0 = fully connected, 1 = every decision is its own orphan. Formula: (components − 1) / (decisions − 1)."
                      >
                        frag: {p.fragmentationScore.toFixed(2)}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-nexus-amber">
                      {p.components} clusters · {p.orphans} orphan{p.orphans !== 1 ? 's' : ''}
                    </span>
                  </div>
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
                        {/* Sample titles + mini node-link viz (v4.5.8 #318).
                            Viz shown only for non-orphan clusters; orphans keep the Link shortcut. */}
                        <div className="px-3 py-2 flex items-start gap-3">
                          <div className="flex-1 min-w-0 space-y-0.5">
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
                          {!isOrphan && (
                            <ClusterMiniViz
                              cluster={c}
                              onNodeClick={onJumpToVisual}
                            />
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
          v4.4.3 #319: hygiene badge for known data-quality artifacts ("Projects"
          leaking from CC encoded-dir naming). The v4.3.9-H1 / v4.4.0-H2 migrations
          normalize these; if they show up again it's a regression signal. */}
      {healthy.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-[0.2em] mb-2">
            Healthy projects
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {healthy.map((p) => {
              const hygiene = (p.project === 'Projects');
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

      {/* v4.5.10 #321 — Auto-link all orphans batch action. Preview first, then commit.
          Uses the existing /api/ledger/auto-link with orphans_only=true. */}
      {data.totalOrphans > 0 && (
        <div className="bg-nexus-surface border border-nexus-border rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <h3 className="text-[10px] font-mono text-nexus-amber uppercase tracking-[0.2em] mb-1">
                Auto-link all orphans
              </h3>
              <p className="text-[10px] font-mono text-nexus-text-faint">
                Tries to link {data.totalOrphans} orphan{data.totalOrphans !== 1 ? 's' : ''} via temporal chain · keyword overlap · shared tag.
                Restricted to decisions with zero edges — won't touch connected decisions.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!batchPreview && (
                <button
                  onClick={runBatchPreview}
                  disabled={batchBusy}
                  className="text-[10px] font-mono px-3 py-1 rounded border border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/10 disabled:opacity-50"
                >
                  {batchBusy ? 'Loading…' : 'Preview'}
                </button>
              )}
              {batchPreview && (
                <>
                  <span className="text-[10px] font-mono text-nexus-text-faint">
                    would link {batchPreview.linked} edge{batchPreview.linked !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={runBatchCommit}
                    disabled={batchBusy || batchPreview.linked === 0}
                    className="text-[10px] font-mono px-3 py-1 rounded bg-nexus-amber/10 border border-nexus-amber/30 text-nexus-amber hover:bg-nexus-amber/20 disabled:opacity-50"
                  >
                    {batchBusy ? 'Linking…' : `Commit ${batchPreview.linked}`}
                  </button>
                  <button
                    onClick={() => setBatchPreview(null)}
                    className="text-[10px] font-mono text-nexus-text-faint hover:text-nexus-text"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
          {batchPreview && batchPreview.samples?.length > 0 && (
            <div className="mt-2 pt-2 border-t border-nexus-border/50 space-y-0.5 max-h-32 overflow-y-auto">
              {batchPreview.samples.slice(0, 6).map((s, i) => (
                <p key={i} className="text-[10px] font-mono text-nexus-text-dim">
                  #{s.from} --[<span className="text-nexus-amber">{s.rel}</span>]--&gt; #{s.to}
                  <span className="text-nexus-text-faint"> · {String(s.note).slice(0, 60)}</span>
                </p>
              ))}
              {batchPreview.samples.length > 6 && (
                <p className="text-[10px] font-mono text-nexus-text-faint">+ {batchPreview.samples.length - 6} more samples not shown…</p>
              )}
            </div>
          )}
          {batchResult?.linked != null && (
            <p className="text-[10px] font-mono text-nexus-green mt-2">✓ Linked {batchResult.linked} new edge{batchResult.linked !== 1 ? 's' : ''}.</p>
          )}
          {batchResult?.error && (
            <p className="text-[10px] font-mono text-nexus-red mt-2">Error: {batchResult.error}</p>
          )}
        </div>
      )}

      {/* Cross-project links — v4.5.10 #322: pills now clickable to drill into the
          hydrated edge list. */}
      {crossLinks.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-nexus-text-faint uppercase tracking-[0.2em] mb-2">
            Cross-project links ({crossLinks.length})
          </h3>
          <div className="bg-nexus-surface border border-nexus-border rounded-xl p-3 space-y-1">
            {crossLinks.map(([pair, count]) => {
              // Parse "A ↔ B" back into the two project names.
              const [a, b] = pair.split(' ↔ ');
              const key = `${a}::${b}`;
              const isOpen = drillKey === key;
              return (
                <div key={pair}>
                  <button
                    onClick={() => openDrill(a, b)}
                    className="w-full flex items-center justify-between text-xs font-mono hover:text-nexus-amber transition-colors py-0.5"
                    title="Click to see edge list"
                  >
                    <span className="text-nexus-text-dim">
                      {isOpen ? '▾' : '▸'} {pair}
                    </span>
                    <span className="text-nexus-text-faint">{count}</span>
                  </button>
                  {isOpen && (
                    <div className="ml-4 mt-1 mb-2 pl-2 border-l border-nexus-amber/30 space-y-0.5 max-h-48 overflow-y-auto">
                      {drillBusy && <p className="text-[10px] font-mono text-nexus-text-faint italic">Loading…</p>}
                      {drillData?.error && <p className="text-[10px] font-mono text-nexus-red">{drillData.error}</p>}
                      {drillData?.pairs && drillData.pairs.slice(0, 20).map((pp, i) => (
                        <p key={i} className="text-[10px] font-mono text-nexus-text-dim">
                          <span className="text-nexus-amber">#{pp.from.id}</span>
                          <span className="text-nexus-text-faint"> --[{pp.edge.rel}]--&gt; </span>
                          <span className="text-nexus-amber">#{pp.to.id}</span>
                          <span className="text-nexus-text-faint">
                            {' '}{String(pp.from.decision || '').slice(0, 22)}… ↔ {String(pp.to.decision || '').slice(0, 22)}…
                          </span>
                        </p>
                      ))}
                      {drillData?.pairs?.length > 20 && (
                        <p className="text-[10px] font-mono text-nexus-text-faint">+ {drillData.pairs.length - 20} more edges</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
