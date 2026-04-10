import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Impact Analysis Engine
 *
 * Uses the Knowledge Graph to answer:
 * 1. Blast Radius: "If I change decision X, what else is affected?"
 * 2. Contradictions: "Which decisions conflict with each other?"
 * 3. Structural Holes: "Where are connections missing?"
 * 4. Centrality: "Which decisions are most foundational?"
 */

export function createImpactRoutes(store: NexusStore) {
  const router = Router();

  // Blast radius for a specific decision
  router.get('/blast/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const decision = store.getDecisionById( id);
    if (!decision) return res.status(404).json({ error: 'Decision not found.' });

    // Traverse all downstream decisions (follow 'led_to' and 'depends_on' edges)
    const affected = traverseDirected(store, id, ['led_to', 'depends_on']);
    // Also get anything directly 'related'
    const related = store.getEdgesFor(id)
      .filter((e: any) => e.rel === 'related')
      .map((e: any) => {
        const otherId = e.from === id ? e.to : e.from;
        return store.getDecisionById( otherId);
      })
      .filter(Boolean);

    res.json({
      decision,
      blastRadius: affected.length,
      affected: affected.map((d: any) => ({ id: d.id, decision: d.decision, project: d.project, depth: d._depth })),
      related: related.map((d: any) => ({ id: d.id, decision: d.decision, project: d.project })),
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
    const contradictions: any[] = [];

    // Strategy 1: Find 'replaced' edges where old decision still has active dependents
    for (const edge of store.getAllEdges()) {
      if (edge.rel === 'replaced') {
        const oldDecision = decisions.find((d: any) => d.id === edge.from);
        const newDecision = decisions.find((d: any) => d.id === edge.to);
        const oldDependents = store.getEdgesFrom(edge.from).filter((e: any) => e.rel === 'depends_on' || e.rel === 'led_to');
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
            const alreadyLinked = store.getAllEdges().find((e: any) =>
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

    res.json({ contradictions, total: contradictions.length });
  });

  // Centrality analysis: which decisions are most connected?
  router.get('/centrality', (req: Request, res: Response) => {
    const decisions = store.getAllDecisions();
    const edges = store.getAllEdges();

    const centrality = decisions.map((d: any) => {
      const inbound = edges.filter((e: any) => e.to === d.id).length;
      const outbound = edges.filter((e: any) => e.from === d.id).length;
      const total = inbound + outbound;
      return {
        id: d.id,
        decision: d.decision,
        project: d.project,
        inbound,
        outbound,
        total,
      };
    });

    centrality.sort((a: any, b: any) => b.total - a.total);
    const avg = centrality.reduce((s: number, c: any) => s + c.total, 0) / (centrality.length || 1);

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
    const affected = affectedRaw.map((d: any) => ({
      id: d.id,
      decision: d.decision,
      project: d.project,
      depth: d._depth,
    }));
    const maxDepth = affected.reduce((m: number, d: any) => Math.max(m, d.depth || 0), 0);

    const baseResult: any = {
      decision,
      affectedCount: affected.length,
      affected,
      depth: maxDepth,
    };

    // Generate AI narrative — graceful fallback if AI is unavailable
    try {
      const list = affected
        .slice(0, 12)
        .map((d: any) => `- #${d.id} [${d.project}] ${d.decision}`)
        .join('\n');
      const userPrompt = `Given this architectural decision: '${decision.decision}'. ` +
        `If we change or reverse this decision, these ${affected.length} downstream decisions would be affected: ` +
        `${list || '(none)'}. Generate a 3-4 sentence impact forecast describing: (1) what breaks, ` +
        `(2) estimated scope of change, (3) recommended migration approach. Be specific and concise.`;

      const aiRes = await fetch('http://localhost:1234/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'none' },
        body: JSON.stringify({
          model: 'google/gemma-4-26b-a4b',
          max_tokens: 400,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (aiRes.ok) {
        const data: any = await aiRes.json();
        const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');
        const forecast = textBlocks.map((b: any) => b.text).join('\n').trim();
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
    const decisions = store.getAllDecisions();
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
        (e: any) => idSet.has(e.from) && idSet.has(e.to)
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
        .map((memberIds) => ({
          size: memberIds.length,
          memberIds,
          // Sample decision titles for the largest few members so the UI
          // can show what the cluster is "about"
          sampleTitles: memberIds
            .slice(0, 3)
            .map((id) => {
              const d = decisions.find((x: any) => x.id === id);
              return d ? d.decision.slice(0, 60) : `#${id}`;
            }),
        }))
        .sort((a, b) => b.size - a.size);

      // Orphans are components of size 1 (isolated decisions)
      const orphans = components.filter((c) => c.size === 1).length;
      const isFragmented = components.length > 1;

      return {
        project,
        decisions: ids.length,
        edges: intraEdges.length,
        components: components.length,
        orphans,
        isFragmented,
        clusters: components,
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
          (e: any) =>
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

  return router;
}

// Follow directed edges (led_to, depends_on) downstream
function traverseDirected(store: NexusStore, startId: number, edgeTypes: string[], maxDepth = 4) {
  const visited = new Set<number>();
  const result: any[] = [];
  const queue: { id: number; depth: number }[] = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    if (id !== startId) {
      const decision = store.getDecisionById( id);
      if (decision) result.push({ ...decision, _depth: depth });
    }

    // Only follow specified edge types, in the forward direction
    const outEdges = store.getAllEdges().filter((e: any) => e.from === id && edgeTypes.includes(e.rel));
    for (const edge of outEdges) {
      if (!visited.has(edge.to)) queue.push({ id: edge.to, depth: depth + 1 });
    }
  }

  return result;
}
