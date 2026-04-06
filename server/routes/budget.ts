import { Router, Request, Response } from 'express';
import type { NexusStore } from '../db/store.ts';

/**
 * Budget-aware task suggestions.
 * Based on remaining Claude fuel, suggests appropriately-scoped work.
 */
export function createBudgetRoutes(store: NexusStore): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const usage = store.getLatestUsage();
    if (!usage) return res.json({ suggestions: [], note: 'No usage data. Log with: nexus usage <session%> <weekly%>' });

    const session = usage.session_percent || 100;
    const weekly = usage.weekly_percent || 100;
    const tasks = store.getAllTasks().filter(t => t.status !== 'done');
    const sessions = store.getSessions({ limit: 5 });

    // Determine budget tier
    let tier: string, scope: string;
    if (session <= 10 || weekly <= 10) {
      tier = 'critical';
      scope = 'Wrap up and save context. No new work.';
    } else if (session <= 25 || weekly <= 20) {
      tier = 'low';
      scope = 'Small fixes, commits, documentation, config changes. Avoid large features.';
    } else if (session <= 50 || weekly <= 40) {
      tier = 'moderate';
      scope = 'Medium tasks, bug fixes, refactors. One feature at a time.';
    } else {
      tier = 'healthy';
      scope = 'Full capacity. Complex features, multi-file changes, architecture work.';
    }

    // Generate suggestions based on tier
    const suggestions: { priority: string; action: string; reason: string }[] = [];

    if (tier === 'critical') {
      suggestions.push({ priority: 'urgent', action: 'nexus session "..."', reason: 'Log session summary before fuel runs out' });
      if (tasks.filter(t => t.status === 'in_progress').length > 0) {
        suggestions.push({ priority: 'urgent', action: 'Save WIP state', reason: 'Document in-progress work for next session' });
      }
    }

    if (tier === 'low' || tier === 'critical') {
      // Suggest git cleanup
      suggestions.push({ priority: 'high', action: 'Commit uncommitted changes', reason: 'Secure work before session ends' });
      suggestions.push({ priority: 'medium', action: 'Review and close done tasks', reason: 'Low-cost board cleanup' });
    }

    if (tier === 'moderate') {
      // Suggest finishing in-progress work
      const inProgress = tasks.filter(t => t.status === 'in_progress');
      for (const t of inProgress.slice(0, 3)) {
        suggestions.push({ priority: 'high', action: `Finish: ${t.title}`, reason: 'Complete in-progress work before starting new' });
      }
      // Suggest small backlog items
      const backlog = tasks.filter(t => t.status === 'backlog');
      for (const t of backlog.slice(0, 2)) {
        suggestions.push({ priority: 'medium', action: `Pick up: ${t.title}`, reason: 'Manageable backlog item' });
      }
    }

    if (tier === 'healthy') {
      // Suggest tackling blockers
      const blockers = sessions.flatMap(s => (s.blockers || []).map(b => `[${s.project}] ${b}`));
      for (const b of blockers.slice(0, 2)) {
        suggestions.push({ priority: 'high', action: `Resolve blocker: ${b}`, reason: 'Unblock future work while capacity is high' });
      }
      // Suggest in-progress then backlog
      const inProgress = tasks.filter(t => t.status === 'in_progress');
      for (const t of inProgress) {
        suggestions.push({ priority: 'high', action: `Continue: ${t.title}`, reason: 'In progress' });
      }
      const backlog = tasks.filter(t => t.status === 'backlog');
      for (const t of backlog.slice(0, 3)) {
        suggestions.push({ priority: 'medium', action: `Start: ${t.title}`, reason: 'Backlog item, capacity available' });
      }
    }

    res.json({
      tier,
      scope,
      session_remaining: session,
      weekly_remaining: weekly,
      suggestions: suggestions.slice(0, 6),
    });
  });

  return router;
}
