import { Router, Request, Response } from 'express';
import type { NexusStore } from '../db/store.ts';

export function createHeatmapRoutes(store: NexusStore): Router {
  const router = Router();

  // Get heatmap data: activity bucketed by day for the last N weeks
  router.get('/', (req: Request, res: Response) => {
    const weeks = parseInt(req.query.weeks as string) || 12;
    const project = (req.query.project as string) || null;

    const now = new Date();
    const cutoff = new Date(now.getTime() - weeks * 7 * 86400000);
    let activity = store.getActivity(2000);

    // Filter by date
    activity = activity.filter(a => new Date(a.created_at) >= cutoff);

    // Filter by project if specified
    if (project) {
      const p = project.toLowerCase();
      activity = activity.filter(a => a.message.toLowerCase().includes(`[${p}]`));
    }

    // Bucket by date (YYYY-MM-DD)
    const buckets: Record<string, number> = {};
    for (const a of activity) {
      const day = new Date(a.created_at).toISOString().slice(0, 10);
      buckets[day] = (buckets[day] || 0) + 1;
    }

    // Build calendar grid: array of { date, count, dayOfWeek }
    const days: { date: string; count: number; dayOfWeek: number }[] = [];
    const d = new Date(cutoff);
    d.setHours(0, 0, 0, 0);
    // Start from the nearest Sunday
    d.setDate(d.getDate() - d.getDay());

    while (d <= now) {
      const key = d.toISOString().slice(0, 10);
      days.push({
        date: key,
        count: buckets[key] || 0,
        dayOfWeek: d.getDay(),
      });
      d.setDate(d.getDate() + 1);
    }

    // Find max for color scaling
    const maxCount = Math.max(1, ...days.map(d => d.count));

    // Hour-of-day distribution
    const hourBuckets = new Array(24).fill(0) as number[];
    for (const a of activity) {
      const h = new Date(a.created_at).getHours();
      hourBuckets[h]++;
    }

    res.json({
      weeks,
      days,
      maxCount,
      totalEvents: activity.length,
      hourDistribution: hourBuckets,
    });
  });

  return router;
}
