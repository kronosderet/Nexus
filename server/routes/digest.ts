import { Router, Request, Response } from 'express';
import type { NexusStore } from '../db/store.ts';

export function createDigestRoutes(store: NexusStore): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const range = (req.query.range as string) || '7d';
    const digest = buildDigest(store, range);
    res.json(digest);
  });

  return router;
}

function buildDigest(store: NexusStore, range: string) {
  const now = Date.now();
  const DAY = 86400000;
  const ms = range === '24h' ? DAY : range === '30d' ? 30 * DAY : 7 * DAY;
  const cutoff = now - ms;

  const activity = store.getActivity(500).filter(a => new Date(a.created_at).getTime() > cutoff);
  const allTasks = store.getAllTasks();
  const sessions = store.getSessions({ limit: 100 }).filter(s => new Date(s.created_at).getTime() > cutoff);

  // Count by type
  const typeCounts: Record<string, number> = {};
  for (const a of activity) {
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  }

  // Count by project (extract [ProjectName] from messages)
  const IGNORED_PROJECTS = new Set(['.claude', 'claude', 'Projects', 'unknown', '']);
  const projectCounts: Record<string, number> = {};
  for (const a of activity) {
    const match = a.message.match(/\[([^\]]+)\]/);
    if (match && !IGNORED_PROJECTS.has(match[1])) projectCounts[match[1]] = (projectCounts[match[1]] || 0) + 1;
  }

  // Sort projects by activity
  const projectRanking = Object.entries(projectCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Tasks completed in range
  const completedTasks = allTasks.filter(t =>
    t.status === 'done' && new Date(t.updated_at).getTime() > cutoff
  );

  // Tasks still open
  const openTasks = allTasks.filter(t => t.status !== 'done');

  // Commits (git_commit type)
  const commits = activity.filter(a => a.type === 'git_commit').length;

  // File changes
  const fileChanges = activity.filter(a => a.type === 'file_change').length;

  // Sessions in range
  const sessionCount = sessions.length;

  // Blockers from sessions
  const activeBlockers = sessions
    .flatMap(s => s.blockers || [])
    .filter(Boolean);

  // Decisions from sessions
  const recentDecisions = sessions
    .flatMap(s => (s.decisions || []).map(d => ({ decision: d, project: s.project })))
    .slice(0, 10);

  // Most active day
  const dayBuckets: Record<string, number> = {};
  for (const a of activity) {
    const day = new Date(a.created_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    dayBuckets[day] = (dayBuckets[day] || 0) + 1;
  }
  const busiestDay = Object.entries(dayBuckets).sort((a, b) => b[1] - a[1])[0] || null;

  // Build summary sentence
  const parts: string[] = [];
  if (activity.length > 0) parts.push(`${activity.length} events`);
  if (commits > 0) parts.push(`${commits} commits`);
  if (completedTasks.length > 0) parts.push(`${completedTasks.length} tasks completed`);
  if (projectRanking.length > 0) parts.push(`${projectRanking[0].name} most active`);

  const rangeLabel = range === '24h' ? 'today' : range === '30d' ? 'this month' : 'this week';
  const summary = parts.length > 0
    ? `${rangeLabel}: ${parts.join(', ')}.`
    : `${rangeLabel}: calm waters. No activity recorded.`;

  return {
    range,
    rangeLabel,
    summary,
    stats: {
      totalEvents: activity.length,
      commits,
      fileChanges,
      tasksCompleted: completedTasks.length,
      tasksOpen: openTasks.length,
      sessions: sessionCount,
    },
    projectRanking,
    busiestDay: busiestDay ? { day: busiestDay[0], count: busiestDay[1] } : null,
    completedTasks: completedTasks.map(t => ({ id: t.id, title: t.title })),
    activeBlockers,
    recentDecisions,
    typeCounts,
  };
}
