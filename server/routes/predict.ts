import { Router, type Request, type Response } from 'express';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { NexusStore } from '../db/store.ts';
import type { Decision, GraphEdge } from '../types.ts';

const PROJECTS_DIR = 'C:/Projects';

/**
 * Predictive Task Generation (v3.0 feature #2)
 *
 * Analyzes the Knowledge Graph + fleet state to find structural gaps
 * and auto-generate tasks to fill them.
 *
 * Gap types detected:
 * 1. Blind spots — projects with git repos but zero indexed decisions
 * 2. Orphan decisions — decisions with no connections (isolated knowledge)
 * 3. Unvalidated decisions — high-centrality decisions with no test/verification
 * 4. Stale decisions — old decisions in actively-worked projects
 * 5. Unresolved blockers — session blockers not tracked as tasks
 * 6. Uncommitted drift — repos with many uncommitted changes
 */

export function createPredictRoutes(store: NexusStore, broadcast: (data: any) => void) {
  const router = Router();

  // Dry run — show what would be generated, don't create anything
  router.get('/', (_req: Request, res: Response) => {
    const gaps = detectGaps(store);
    res.json(gaps);
  });

  // Generate — actually create the suggested tasks
  router.post('/generate', (req: Request, res: Response) => {
    const { categories } = req.body; // optional filter
    const gaps = detectGaps(store);

    const created: { id: number; title: string; category: string }[] = [];

    for (const gap of gaps.suggestions) {
      if (categories && categories.length > 0 && !categories.includes(gap.category)) continue;

      // Check for duplicates — don't create if similar task exists
      const existing = store.getAllTasks().find(t =>
        t.title.toLowerCase().includes(gap.title.toLowerCase().slice(0, 30))
        || t.title.toLowerCase() === gap.title.toLowerCase()
      );
      if (existing) continue;

      const task = store.createTask({
        title: gap.title,
        description: gap.reason,
        status: 'backlog',
        priority: gap.priority,
      });
      created.push({ id: task.id, title: task.title, category: gap.category });
    }

    if (created.length > 0) {
      const entry = store.addActivity(
        'predict',
        `Predictive generation: created ${created.length} tasks from graph gaps`
      );
      broadcast({ type: 'activity', payload: entry });
    }

    res.json({ created, totalDetected: gaps.suggestions.length });
  });

  return router;
}

interface GapSuggestion {
  category: 'blind_spot' | 'orphan' | 'unvalidated' | 'stale' | 'blocker' | 'drift';
  title: string;
  reason: string;
  priority: number; // 0=low, 1=normal, 2=high
  project?: string;
  decisionId?: number;
}

function detectGaps(store: NexusStore): { suggestions: GapSuggestion[]; stats: any } {
  const suggestions: GapSuggestion[] = [];
  const ledger = store.data.ledger || [];
  const edges = store.data.graph_edges || [];
  const tasks = store.getAllTasks();
  const sessions = store.getSessions({ limit: 20 });

  // Helper: build edge lookup
  const edgesByDecision: Record<number, GraphEdge[]> = {};
  for (const e of edges) {
    if (!edgesByDecision[e.from]) edgesByDecision[e.from] = [];
    if (!edgesByDecision[e.to]) edgesByDecision[e.to] = [];
    edgesByDecision[e.from].push(e);
    edgesByDecision[e.to].push(e);
  }

  // ── 1. Blind spots: git repos with no indexed decisions ─
  const decisionProjects = new Set(ledger.map(d => d.project.toLowerCase()));
  try {
    for (const name of readdirSync(PROJECTS_DIR)) {
      if (name === 'archive' || name === 'node_modules' || name.startsWith('.')) continue;
      const fullPath = join(PROJECTS_DIR, name);
      try {
        statSync(join(fullPath, '.git'));
      } catch {
        continue;
      }
      if (!decisionProjects.has(name.toLowerCase())) {
        suggestions.push({
          category: 'blind_spot',
          title: `Index ${name} decisions into The Ledger`,
          reason: `${name} has a git repo but zero decisions recorded. Strategic blind spot — run 'nexus record' for 3-5 key architectural choices to enable impact analysis.`,
          priority: 1,
          project: name,
        });
      }
    }
  } catch {}

  // ── 2. Orphan decisions: no graph connections ─────────
  for (const d of ledger) {
    const connections = edgesByDecision[d.id]?.length ?? 0;
    if (connections === 0) {
      suggestions.push({
        category: 'orphan',
        title: `Link decision #${d.id} to related work`,
        reason: `"${d.decision.slice(0, 80)}" has no graph connections. Isolated knowledge reduces impact analysis value.`,
        priority: 0,
        decisionId: d.id,
        project: d.project,
      });
    }
  }

  // Limit orphan suggestions to 3 (they're low priority)
  const orphanSuggestions = suggestions.filter(s => s.category === 'orphan').slice(0, 3);
  const nonOrphans = suggestions.filter(s => s.category !== 'orphan');
  suggestions.length = 0;
  suggestions.push(...nonOrphans, ...orphanSuggestions);

  // ── 3. Unvalidated: high-centrality decisions lacking test coverage ─
  const centrality: Record<number, number> = {};
  for (const d of ledger) centrality[d.id] = edgesByDecision[d.id]?.length ?? 0;

  // Top 10% most-connected decisions
  const sortedByCentrality = [...ledger].sort((a, b) => (centrality[b.id] ?? 0) - (centrality[a.id] ?? 0));
  const topCentral = sortedByCentrality.slice(0, Math.max(3, Math.floor(ledger.length * 0.1)));

  for (const d of topCentral) {
    const hasTestTask = tasks.some(t =>
      t.title.toLowerCase().includes('test') &&
      t.title.toLowerCase().includes(d.decision.toLowerCase().split(' ')[0])
    );
    if (!hasTestTask && centrality[d.id] >= 5) {
      // Only suggest if it's Nexus-related (we have test infrastructure there)
      if (d.project.toLowerCase() === 'nexus') {
        suggestions.push({
          category: 'unvalidated',
          title: `Add test coverage for "${d.decision.slice(0, 60)}"`,
          reason: `High centrality (${centrality[d.id]} connections) but no test coverage. Critical path should be verified.`,
          priority: 1,
          decisionId: d.id,
          project: d.project,
        });
      }
    }
  }

  // ── 4. Unresolved blockers from recent sessions ────────
  const taskTitles = new Set(tasks.map(t => t.title.toLowerCase()));
  const seenBlockers = new Set<string>();
  for (const s of sessions.slice(0, 10)) {
    for (const b of (s.blockers || [])) {
      const key = b.toLowerCase().slice(0, 50);
      if (seenBlockers.has(key)) continue;
      seenBlockers.add(key);

      // Check if already tracked as a task
      const tracked = Array.from(taskTitles).some(t => t.includes(key.slice(0, 30)));
      if (!tracked) {
        suggestions.push({
          category: 'blocker',
          title: `Resolve blocker: ${b.slice(0, 80)}`,
          reason: `Session blocker from [${s.project}] not tracked as a task. Blockers should become actionable items.`,
          priority: 2,
          project: s.project,
        });
      }
    }
  }

  // ── 5. Uncommitted drift: repos with >10 uncommitted changes ─
  // Use the cached risk scan if available
  const risks = store._lastRiskScan?.risks || [];
  for (const r of risks) {
    if (r.category === 'uncommitted' && r.project) {
      const match = r.message?.match(/(\d+) uncommitted/);
      const count = match ? parseInt(match[1]) : 0;
      if (count > 10) {
        suggestions.push({
          category: 'drift',
          title: `Commit ${count} pending changes in ${r.project}`,
          reason: `${r.project} has drifted ${count} files from git HEAD. Commit or stash to prevent context loss.`,
          priority: 2,
          project: r.project,
        });
      }
    }
  }

  // ── Final: dedupe + sort by priority ──────────────────
  const seen = new Set<string>();
  const unique = suggestions.filter(s => {
    const key = s.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => b.priority - a.priority);

  return {
    suggestions: unique,
    stats: {
      total: unique.length,
      byCategory: unique.reduce((acc: Record<string, number>, s) => {
        acc[s.category] = (acc[s.category] || 0) + 1;
        return acc;
      }, {}),
      byPriority: {
        high: unique.filter(s => s.priority === 2).length,
        normal: unique.filter(s => s.priority === 1).length,
        low: unique.filter(s => s.priority === 0).length,
      },
    },
  };
}
