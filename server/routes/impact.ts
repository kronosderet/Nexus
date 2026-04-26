import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { Decision, GraphEdge } from '../types.ts';

/**
 * Impact Analysis Engine
 *
 * Uses the Knowledge Graph to answer:
 * 1. Blast Radius: "If I change decision X, what else is affected?"
 * 2. Contradictions: "Which decisions conflict with each other?"
 * 3. Structural Holes: "Where are connections missing?"
 * 4. Centrality: "Which decisions are most foundational?"
 */

// v4.3.5 P1 — typed BFS result. traverseDirected returns decisions enriched with depth.
type AffectedDecision = Decision & { _depth: number };

// Contradiction shapes surfaced by /contradictions
interface SupersededContradiction {
  type: 'superseded_with_dependents';
  old: { id: number; decision: string };
  new: { id: number; decision: string };
  orphanedDependents: number;
  message: string;
}
interface PotentialConflict {
  type: 'potential_conflict';
  a: { id: number; decision: string };
  b: { id: number; decision: string };
  trigger: string;
  message: string;
}
type Contradiction = SupersededContradiction | PotentialConflict;

interface CentralityEntry {
  id: number;
  decision: string;
  project: string;
  inbound: number;
  outbound: number;
  total: number;
  // v4.5.10 #302 — week-over-week delta (this week − prior week)
  priorTotal?: number;
  weeklyDelta?: number;
  // v4.5.10 #300 — edge-type breakdown
  byType?: { typed: number; keyword: number; semantic: number; manual: number };
}

// Minimal shapes for the LM Studio /models and /messages responses used by /forecast.
interface AIModelsResponse { data?: Array<{ id?: string }> }
interface AIMessagesResponse { content?: Array<{ type?: string; text?: string }> }

interface ForecastResult {
  decision: Decision;
  affectedCount: number;
  affected: Array<{ id: number; decision: string; project: string; depth: number }>;
  depth: number;
  forecast?: string;
}

export function createImpactRoutes(store: NexusStore) {
  const router = Router();

  // Blast radius for a specific decision
  router.get('/blast/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const decision = store.getDecisionById( id);
    if (!decision) return res.status(404).json({ error: 'Decision not found.' });

    // v4.4.3 #287 — support ?depth=1|2|3|4 query param. Defaults to 4 (traverseDirected's
    // internal default) so existing callers are unaffected.
    const requestedDepth = parseInt(req.query.depth as string, 10);
    const maxDepthArg = Number.isFinite(requestedDepth) && requestedDepth >= 1 && requestedDepth <= 6
      ? requestedDepth
      : undefined;

    // Traverse all downstream decisions (follow 'led_to' and 'depends_on' edges)
    const affected = traverseDirected(store, id, ['led_to', 'depends_on'], maxDepthArg);
    // Also get anything directly 'related'
    const related = store.getEdgesFor(id)
      .filter((e: GraphEdge) => e.rel === 'related')
      .map((e: GraphEdge) => {
        const otherId = e.from === id ? e.to : e.from;
        return store.getDecisionById(otherId);
      })
      .filter((d): d is Decision => Boolean(d));

    res.json({
      decision,
      blastRadius: affected.length,
      affected: affected.map((d) => ({ id: d.id, decision: d.decision, project: d.project, depth: d._depth })),
      related: related.map((d) => ({ id: d.id, decision: d.decision, project: d.project })),
      warning: affected.length > 5
        ? `Changing this decision impacts ${affected.length} downstream decisions. Proceed carefully.`
        : affected.length > 0
        ? `${affected.length} decisions depend on this.`
        : 'No downstream impact detected.',
    });
  });

  // Find potential contradictions across the graph
  router.get('/contradictions', (req: Request, res: Response) => {
    const decisions = store.getAllDecisions();
    const contradictions: Contradiction[] = [];

    // Strategy 1: Find 'replaced' edges where old decision still has active dependents
    for (const edge of store.getAllEdges()) {
      if (edge.rel === 'replaced') {
        const oldDecision = decisions.find((d: Decision) => d.id === edge.from);
        const newDecision = decisions.find((d: Decision) => d.id === edge.to);
        const oldDependents = store.getEdgesFrom(edge.from).filter((e: GraphEdge) => e.rel === 'depends_on' || e.rel === 'led_to');
        if (oldDependents.length > 0 && oldDecision && newDecision) {
          contradictions.push({
            type: 'superseded_with_dependents',
            old: { id: oldDecision.id, decision: oldDecision.decision },
            new: { id: newDecision.id, decision: newDecision.decision },
            orphanedDependents: oldDependents.length,
            message: `"${oldDecision.decision.slice(0, 40)}" was replaced but ${oldDependents.length} decisions still depend on it.`,
          });
        }
      }
    }

    // Strategy 2: Find decisions with genuinely opposing choices
    // Rules to prevent false positives:
    // - Skip deprecated decisions
    // - Skip if EITHER decision contains BOTH words (it's the resolution, not a conflict)
    // - Skip if they're already linked (led_to, depends_on = same thread)
    // - Only flag if the two words appear in DIFFERENT decisions, not as part of the same sentence
    const opposites: [string, string][] = [
      ['cloud', 'local'],
      ['typescript', 'javascript'],
      ['monolith', 'microservice'],
      ['relational', 'document'],
      ['rest', 'graphql'],
    ];
    for (let i = 0; i < decisions.length; i++) {
      if (decisions[i].deprecated) continue;
      for (let j = i + 1; j < decisions.length; j++) {
        if (decisions[j].deprecated) continue;
        if (decisions[i].project !== decisions[j].project) continue;
        const textA = decisions[i].decision.toLowerCase();
        const textB = decisions[j].decision.toLowerCase();
        for (const [a, b] of opposites) {
          // Skip if either decision mentions BOTH terms (it's a comparison/resolution, not a conflict)
          if ((textA.includes(a) && textA.includes(b)) || (textB.includes(a) && textB.includes(b))) continue;

          if ((textA.includes(a) && textB.includes(b)) || (textA.includes(b) && textB.includes(a))) {
            // Skip if already linked in any way (same decision thread)
            const alreadyLinked = store.getAllEdges().find((e: GraphEdge) =>
              (e.from === decisions[i].id && e.to === decisions[j].id) ||
              (e.from === decisions[j].id && e.to === decisions[i].id)
            );
            if (alreadyLinked) continue;
            contradictions.push({
              type: 'potential_conflict',
              a: { id: decisions[i].id, decision: decisions[i].decision },
              b: { id: decisions[j].id, decision: decisions[j].decision },
              trigger: `${a} vs ${b}`,
              message: `Potential conflict: "${decisions[i].decision.slice(0, 40)}" vs "${decisions[j].decision.slice(0, 40)}" (${a}/${b})`,
            });
          }
        }
      }
    }

    // v4.4.4 #309 — historical counter. Count all `contradicts` edges ever created
    // (these are append-only in the current store model — flagging via the UI writes
    // an edge that persists). Classify each as "resolved" when at least one endpoint
    // decision is deprecated, since the conflict no longer reflects an active
    // contradiction in the graph. Gives the tab a meaningful idle-state readout
    // instead of a flat "0 · nothing here".
    const contradictsEdges = store.getAllEdges().filter((e: GraphEdge) => e.rel === 'contradicts');
    let historicalTotal = contradictsEdges.length;
    let historicalResolved = 0;
    const decMap = new Map(decisions.map((d: Decision) => [d.id, d] as const));
    for (const edge of contradictsEdges) {
      const a = decMap.get(edge.from);
      const b = decMap.get(edge.to);
      if ((a?.deprecated) || (b?.deprecated)) historicalResolved++;
    }
    // Potential (auto-detected) contradictions also count toward "ever flagged" so
    // the headline reflects visible conflicts across both strategies.
    historicalTotal += contradictions.filter(c => c.type === 'potential_conflict').length;

    // v4.4.8 #307 — include active Overseer-scan suggestions inline so the Conflicts
    // tab can render the "Suggested" section without a second round-trip. Hydrated
    // with decision text so the card can stand alone.
    const suggestions = store.getActiveSuggestedContradictions()
      .map(s => ({
        ...s,
        from_decision: store.getDecisionById(s.from_id),
        to_decision: store.getDecisionById(s.to_id),
      }))
      .filter(s => s.from_decision && s.to_decision);

    res.json({
      contradictions,
      total: contradictions.length,
      historical: {
        total: historicalTotal,
        resolved: historicalResolved,
      },
      suggestions,
      suggestedCount: suggestions.length,
    });
  });

  // Centrality analysis: which decisions are most connected?
  router.get('/centrality', (req: Request, res: Response) => {
    const decisions = store.getAllDecisions();
    const edges = store.getAllEdges();

    // v4.5.10 #302 — per-entry week-over-week delta.
    // Edges carry `created_at`. Split: "current" = edges as-of now, "prior" =
    // edges that existed as-of 7 days ago. Delta = current.total - prior.total.
    const now = Date.now();
    const WEEK = 7 * 86400000;
    const weekAgo = now - WEEK;
    const edgesAsOfWeekAgo = edges.filter((e: GraphEdge) => new Date(e.created_at).getTime() < weekAgo);

    // v4.5.10 #300 — per-entry edge-type breakdown (auto-linked vs semantic vs manual vs typed).
    // Typed: any rel other than 'related'. For rel='related' split by note provenance.
    const classifyEdge = (e: GraphEdge) => {
      if (e.rel !== 'related') return 'typed';
      const note = String(e.note || '');
      if (note.startsWith('auto-linked')) return 'keyword';
      if (note.startsWith('semantic-linked')) return 'semantic';
      return 'manual';
    };

    const centrality: CentralityEntry[] = decisions.map((d: Decision) => {
      const incidentNow = edges.filter((e: GraphEdge) => e.from === d.id || e.to === d.id);
      const incidentPrior = edgesAsOfWeekAgo.filter((e: GraphEdge) => e.from === d.id || e.to === d.id);
      const inbound = incidentNow.filter((e: GraphEdge) => e.to === d.id).length;
      const outbound = incidentNow.filter((e: GraphEdge) => e.from === d.id).length;
      const total = inbound + outbound;
      // v4.5.10 #300 — edge-type breakdown
      const byType = { typed: 0, keyword: 0, semantic: 0, manual: 0 };
      for (const e of incidentNow) byType[classifyEdge(e) as keyof typeof byType]++;
      return {
        id: d.id,
        decision: d.decision,
        project: d.project,
        inbound,
        outbound,
        total,
        // v4.5.10 #302 — week-over-week delta
        priorTotal: incidentPrior.length,
        weeklyDelta: total - incidentPrior.length,
        // v4.5.10 #300 — per-row edge-type breakdown
        byType,
      };
    });

    centrality.sort((a, b) => b.total - a.total);
    const avg = centrality.reduce((s, c) => s + c.total, 0) / (centrality.length || 1);

    res.json({
      centrality: centrality.slice(0, 20),
      averageConnections: Math.round(avg * 10) / 10,
      mostCentral: centrality[0] || null,
      leastCentral: centrality[centrality.length - 1] || null,
    });
  });

  // AI-powered impact forecast: BFS + LM Studio narrative
  router.get('/forecast/:decisionId', async (req: Request, res: Response) => {
    const id = Number(req.params.decisionId);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid decision id.' });

    const decision = store.getDecisionById( id);
    if (!decision) return res.status(404).json({ error: 'Decision not found.' });

    // BFS along led_to + depends_on edges, tracking depth
    const affectedRaw = traverseDirected(store, id, ['led_to', 'depends_on']);
    const affected = affectedRaw.map((d) => ({
      id: d.id,
      decision: d.decision,
      project: d.project,
      depth: d._depth,
    }));
    const maxDepth = affected.reduce((m, d) => Math.max(m, d.depth || 0), 0);

    const baseResult: ForecastResult = {
      decision,
      affectedCount: affected.length,
      affected,
      depth: maxDepth,
    };

    // Generate AI narrative — graceful fallback if AI is unavailable
    try {
      const list = affected
        .slice(0, 12)
        .map((d) => `- #${d.id} [${d.project}] ${d.decision}`)
        .join('\n');
      const userPrompt = `Given this architectural decision: '${decision.decision}'. ` +
        `If we change or reverse this decision, these ${affected.length} downstream decisions would be affected: ` +
        `${list || '(none)'}. Generate a 3-4 sentence impact forecast describing: (1) what breaks, ` +
        `(2) estimated scope of change, (3) recommended migration approach. Be specific and concise.`;

      // Auto-detect model from LM Studio
      let modelName = 'google/gemma-4-31b';
      try {
        const modelsRes = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(5000) });
        if (modelsRes.ok) {
          const modelsData: AIModelsResponse = await modelsRes.json();
          const first = (modelsData.data || []).find((m) => m.id && !m.id.includes('embed'));
          if (first?.id) modelName = first.id;
        }
      } catch {}
      const aiRes = await fetch('http://localhost:1234/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 400,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (aiRes.ok) {
        const data: AIMessagesResponse = await aiRes.json();
        const textBlocks = (data.content || []).filter((b) => b.type === 'text');
        const forecast = textBlocks.map((b) => b.text || '').join('\n').trim();
        if (forecast) baseResult.forecast = forecast;
      }
    } catch {
      // AI unavailable — silently omit forecast field
    }

    res.json(baseResult);
  });

  // Structural holes: find INTRA-project disconnection via union-find
  // (projects whose decisions form multiple disconnected sub-clusters).
  // The old version flagged every unrelated project pair — meaningless noise
  // for users who run multiple unrelated projects. This version surfaces real
  // signal: "your Nexus decisions split into 3 islands that don't reference
  // each other" is something worth knowing.
  router.get('/holes', (_req: Request, res: Response) => {
    // v4.6.3 — exclude lifecycle=reference decisions from the orphan/holes
    // calculation. cc-memory imports (and other reference material) are a
    // separate documentation layer by design — they're not supposed to be
    // typed graph nodes. Counting them as orphans inflates the metric and
    // hides real fragmentation. The Nexus project had 35 "orphans" pre-fix,
    // 32 of which were intentional reference imports.
    const decisions = store.getAllDecisions().filter(d => d.lifecycle !== 'reference');
    const edges = store.getAllEdges();

    // Group decisions by project
    const projects: Record<string, number[]> = {};
    for (const d of decisions) {
      if (!projects[d.project]) projects[d.project] = [];
      projects[d.project].push(d.id);
    }

    // For each project, run union-find on the subgraph of edges where BOTH
    // endpoints belong to that project. Count connected components.
    const projectAnalysis = Object.entries(projects).map(([project, ids]) => {
      const idSet = new Set(ids);
      const parent: Record<number, number> = {};
      for (const id of ids) parent[id] = id;

      const find = (x: number): number => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };
      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      };

      // Only consider edges where BOTH endpoints are in this project
      const intraEdges = edges.filter(
        (e: GraphEdge) => idSet.has(e.from) && idSet.has(e.to)
      );
      for (const e of intraEdges) union(e.from, e.to);

      // Group ids by component root
      const componentMap: Record<number, number[]> = {};
      for (const id of ids) {
        const root = find(id);
        if (!componentMap[root]) componentMap[root] = [];
        componentMap[root].push(id);
      }

      const components = Object.values(componentMap)
        .map((memberIds) => {
          const idSet = new Set(memberIds);
          // v4.5.8 #318 — intra-cluster edges for mini node-link viz.
          // Thin shape: just what the SVG needs ({from, to, rel}).
          const clusterEdges = intraEdges
            .filter((e) => idSet.has(e.from) && idSet.has(e.to))
            .map((e) => ({ from: e.from, to: e.to, rel: e.rel }));
          return {
            size: memberIds.length,
            memberIds,
            // Sample decision titles for the largest few members so the UI
            // can show what the cluster is "about"
            sampleTitles: memberIds
              .slice(0, 3)
              .map((id) => {
                const d = decisions.find((x: Decision) => x.id === id);
                return d ? d.decision.slice(0, 60) : `#${id}`;
              }),
            edges: clusterEdges,
          };
        })
        .sort((a, b) => b.size - a.size);

      // Orphans are components of size 1 (isolated decisions)
      const orphans = components.filter((c) => c.size === 1).length;
      const isFragmented = components.length > 1;

      // v4.5.10 #320 — fragmentation score per project. Measures how "split"
      // the decision graph is on a 0–1 scale.
      //   0.0 → single connected component (no fragmentation)
      //   1.0 → every decision is its own orphan (maximum fragmentation)
      // Formula: (components − 1) / (decisions − 1) clamped to [0,1].
      // Single-decision projects get 0 (trivially connected).
      const fragmentationScore = ids.length <= 1
        ? 0
        : Math.min(1, Math.max(0, (components.length - 1) / (ids.length - 1)));

      return {
        project,
        decisions: ids.length,
        edges: intraEdges.length,
        components: components.length,
        orphans,
        isFragmented,
        clusters: components,
        fragmentationScore: Math.round(fragmentationScore * 100) / 100,
      };
    });

    // Sort: fragmented projects first (most clusters), then by decision count
    projectAnalysis.sort((a, b) => {
      if (a.isFragmented !== b.isFragmented) return a.isFragmented ? -1 : 1;
      if (a.components !== b.components) return b.components - a.components;
      return b.decisions - a.decisions;
    });

    // Cross-project links are still useful as supplementary info,
    // but no longer flagged as "holes" by default.
    const crossLinks: Record<string, number> = {};
    const projectNames = Object.keys(projects);
    for (let i = 0; i < projectNames.length; i++) {
      for (let j = i + 1; j < projectNames.length; j++) {
        const aIds = new Set(projects[projectNames[i]]);
        const bIds = new Set(projects[projectNames[j]]);
        const links = edges.filter(
          (e: GraphEdge) =>
            (aIds.has(e.from) && bIds.has(e.to)) ||
            (bIds.has(e.from) && aIds.has(e.to))
        );
        if (links.length > 0) {
          crossLinks[`${projectNames[i]} \u2194 ${projectNames[j]}`] = links.length;
        }
      }
    }

    // Total holes = projects with >1 component (i.e. decisions that should
    // probably be linked but aren't)
    const fragmented = projectAnalysis.filter((p) => p.isFragmented);

    res.json({
      projectAnalysis,
      fragmented,
      totalFragmented: fragmented.length,
      totalOrphans: projectAnalysis.reduce((n, p) => n + p.orphans, 0),
      crossLinks,
      // Backwards-compat aliases for any consumer still expecting the old shape
      holes: fragmented.map((p) => ({
        project: p.project,
        components: p.components,
        note: `${p.components} disconnected clusters`,
      })),
      totalHoles: fragmented.length,
    });
  });

  // v4.5.10 #322 — drill-down for a cross-project link pair. Returns the
  // hydrated edge list (edge + both endpoint decisions) so the UI can show
  // "Nexus ↔ Firewall-Godot 77" with actual titles, not just a count.
  router.get('/cross-links/:a/:b', (req: Request, res: Response) => {
    const a = String(req.params.a);
    const b = String(req.params.b);
    const decisions = store.getAllDecisions();
    const edges = store.getAllEdges();
    const byId = new Map(decisions.map((d: Decision) => [d.id, d]));
    const aIds = new Set(decisions.filter((d: Decision) => d.project === a).map(d => d.id));
    const bIds = new Set(decisions.filter((d: Decision) => d.project === b).map(d => d.id));
    const pairs = edges
      .filter((e: GraphEdge) =>
        (aIds.has(e.from) && bIds.has(e.to)) ||
        (bIds.has(e.from) && aIds.has(e.to))
      )
      .map((e: GraphEdge) => ({
        edge: e,
        from: byId.get(e.from),
        to: byId.get(e.to),
      }))
      .filter(p => p.from && p.to);
    res.json({ a, b, count: pairs.length, pairs });
  });

  return router;
}

// Follow directed edges (led_to, depends_on) downstream
function traverseDirected(store: NexusStore, startId: number, edgeTypes: string[], maxDepth = 4): AffectedDecision[] {
  const visited = new Set<number>();
  const result: AffectedDecision[] = [];
  const queue: { id: number; depth: number }[] = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    if (id !== startId) {
      const decision = store.getDecisionById(id);
      if (decision) result.push({ ...decision, _depth: depth });
    }

    // Only follow specified edge types, in the forward direction
    const outEdges = store.getAllEdges().filter((e: GraphEdge) => e.from === id && edgeTypes.includes(e.rel));
    for (const edge of outEdges) {
      if (!visited.has(edge.to)) queue.push({ id: edge.to, depth: depth + 1 });
    }
  }

  return result;
}
