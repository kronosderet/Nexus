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
    const decision = (store as any).data.ledger.find((d: any) => d.id === id);
    if (!decision) return res.status(404).json({ error: 'Decision not found.' });

    // Traverse all downstream decisions (follow 'led_to' and 'depends_on' edges)
    const affected = traverseDirected(store, id, ['led_to', 'depends_on']);
    // Also get anything directly 'related'
    const related = store.getEdgesFor(id)
      .filter((e: any) => e.rel === 'related')
      .map((e: any) => {
        const otherId = e.from === id ? e.to : e.from;
        return (store as any).data.ledger.find((d: any) => d.id === otherId);
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
    const decisions = (store as any).data.ledger || [];
    const contradictions: any[] = [];

    // Strategy 1: Find 'replaced' edges where old decision still has active dependents
    for (const edge of (store as any).data.graph_edges) {
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

    // Strategy 2: Find decisions with opposing keywords in same project
    const opposites: [string, string][] = [
      ['sqlite', 'json'], ['sync', 'async'], ['cloud', 'local'],
      ['typescript', 'javascript'], ['monolith', 'microservice'],
    ];
    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        if (decisions[i].project !== decisions[j].project) continue;
        const textA = decisions[i].decision.toLowerCase();
        const textB = decisions[j].decision.toLowerCase();
        for (const [a, b] of opposites) {
          if ((textA.includes(a) && textB.includes(b)) || (textA.includes(b) && textB.includes(a))) {
            // Check if they're already linked as 'replaced' or 'contradicts'
            const alreadyLinked = (store as any).data.graph_edges.find((e: any) =>
              (e.from === decisions[i].id && e.to === decisions[j].id) ||
              (e.from === decisions[j].id && e.to === decisions[i].id)
            );
            if (alreadyLinked?.rel === 'replaced' || alreadyLinked?.rel === 'contradicts') continue;
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
    const decisions = (store as any).data.ledger || [];
    const edges = (store as any).data.graph_edges || [];

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

  // Structural holes: find clusters with weak cross-links
  router.get('/holes', (req: Request, res: Response) => {
    const decisions = (store as any).data.ledger || [];
    const edges = (store as any).data.graph_edges || [];

    // Group by project
    const projects: Record<string, number[]> = {};
    for (const d of decisions) {
      if (!projects[d.project]) projects[d.project] = [];
      projects[d.project].push(d.id);
    }

    // Count cross-project edges
    const crossLinks: Record<string, number> = {};
    const projectPairs = Object.keys(projects);
    for (let i = 0; i < projectPairs.length; i++) {
      for (let j = i + 1; j < projectPairs.length; j++) {
        const key = `${projectPairs[i]} \u2194 ${projectPairs[j]}`;
        const aIds = new Set(projects[projectPairs[i]]);
        const bIds = new Set(projects[projectPairs[j]]);
        const links = edges.filter((e: any) =>
          (aIds.has(e.from) && bIds.has(e.to)) || (bIds.has(e.from) && aIds.has(e.to))
        );
        crossLinks[key] = links.length;
      }
    }

    // Find weak connections (potential structural holes)
    const holes = Object.entries(crossLinks)
      .filter(([, count]) => count <= 1)
      .map(([pair, count]) => ({ pair, connections: count, note: count === 0 ? 'No connection' : 'Weak connection' }));

    res.json({ crossLinks, holes, totalHoles: holes.length });
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
      const decision = (store as any).data.ledger.find((d: any) => d.id === id);
      if (decision) result.push({ ...decision, _depth: depth });
    }

    // Only follow specified edge types, in the forward direction
    const outEdges = (store as any).data.graph_edges.filter((e: any) => e.from === id && edgeTypes.includes(e.rel));
    for (const edge of outEdges) {
      if (!visited.has(edge.to)) queue.push({ id: edge.to, depth: depth + 1 });
    }
  }

  return result;
}
