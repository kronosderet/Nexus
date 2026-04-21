import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { UsageEntry, Task } from '../types.ts';
import { getFuelConfig, groupBySessionWindow } from '../lib/fuelConfig.ts';

/**
 * Smart Fuel Intelligence
 *
 * Learns from actual usage history to provide:
 * 1. Learned task costs (correlate task completion with fuel burn)
 * 2. Session pattern analysis (when are you most efficient?)
 * 3. Weekly budget optimizer (how to distribute sessions)
 * 4. Session boundary detection (auto-detect from fuel jumps)
 * 5. Efficiency scoring (compare sessions)
 */

export function createFuelIntelRoutes(store: NexusStore) {
  const router = Router();

  // Full intelligence report
  router.get('/', (_req: Request, res: Response) => {
    const intel = buildFuelIntelligence(store);
    res.json(intel);
  });

  // Learned task costs
  router.get('/task-costs', (_req: Request, res: Response) => {
    res.json(learnTaskCosts(store));
  });

  // Session patterns
  router.get('/patterns', (_req: Request, res: Response) => {
    res.json(analyzeSessionPatterns(store));
  });

  // Weekly optimization plan
  router.get('/weekly-plan', (_req: Request, res: Response) => {
    res.json(buildWeeklyPlan(store));
  });

  return router;
}

// ── Session boundary detection ──────────────────────────
// Uses the known 5h fixed window grid — no heuristic fuel-jump detection
function detectSessions(usage: UsageEntry[], store?: NexusStore): SessionWindow[] {
  if (usage.length < 2) return [];

  // Use real window boundaries from FuelConfig
  const config = store ? getFuelConfig(store) : { plan: 'pro' as const, timezone: 'Europe/Prague', sessionWindowHours: 5, weeklyResetDay: 4, weeklyResetHour: 21 };
  const windows = groupBySessionWindow(usage, config);

  const sessions: SessionWindow[] = [];
  for (const w of windows) {
    if (w.entries.length >= 2) {
      sessions.push(analyzeSessionWindow(w.entries));
    }
  }
  return sessions;
}

interface SessionWindow {
  startTime: string;
  endTime: string;
  startFuel: number;
  endFuel: number;
  burned: number;
  durationHours: number;
  burnRate: number; // %/hour
  dataPoints: number;
  dayOfWeek: number; // 0=Sun
  hourOfDay: number;
  efficiency: number; // burned per hour, lower = more efficient
}

function analyzeSessionWindow(points: UsageEntry[]): SessionWindow {
  const first = points[0];
  const last = points[points.length - 1];
  const startFuel = first.session_percent ?? 100;
  const endFuel = last.session_percent ?? 0;
  const burned = Math.max(0, startFuel - endFuel);
  const startDate = new Date(first.created_at);
  const endDate = new Date(last.created_at);
  const durationHours = Math.max(0.1, (endDate.getTime() - startDate.getTime()) / 3600000);

  return {
    startTime: first.created_at,
    endTime: last.created_at,
    startFuel,
    endFuel,
    burned,
    durationHours: Math.round(durationHours * 10) / 10,
    burnRate: Math.round((burned / durationHours) * 10) / 10,
    dataPoints: points.length,
    dayOfWeek: startDate.getDay(),
    hourOfDay: startDate.getHours(),
    efficiency: Math.round((burned / durationHours) * 10) / 10,
  };
}

// ── Learn task costs from history ───────────────────────
// Correlate task completions with fuel consumption in the same time window
function learnTaskCosts(store: NexusStore) {
  const usage = store.getUsage(200);
  const tasks = store.getAllTasks();
  const sessions = detectSessions(usage, store);

  // Find tasks completed during each session window
  const taskCosts: { title: string; estimatedCost: number; session: string }[] = [];

  for (const session of sessions) {
    const startMs = new Date(session.startTime).getTime();
    const endMs = new Date(session.endTime).getTime();

    // Tasks completed during this window
    const completed = tasks.filter(t => {
      if (t.status !== 'done') return false;
      const updatedMs = new Date(t.updated_at).getTime();
      return updatedMs >= startMs && updatedMs <= endMs;
    });

    if (completed.length > 0 && session.burned > 0) {
      // Distribute burn evenly across tasks (rough estimate)
      const costPerTask = session.burned / completed.length;
      for (const t of completed) {
        taskCosts.push({
          title: t.title,
          estimatedCost: Math.round(costPerTask * 10) / 10,
          session: session.startTime,
        });
      }
    }
  }

  // Aggregate by task title pattern (group similar tasks)
  // v4.4.4 #265 — keep per-category task list so the UI can expand an entry to
  // show the actual tasks that produced the average. Was aggregate-only before;
  // users had no way to inspect whether a category average was real or a one-off.
  const patterns: Record<string, { count: number; totalCost: number; avgCost: number; tasks: { title: string; cost: number; session: string }[] }> = {};
  for (const tc of taskCosts) {
    const category = categorizeTask(tc.title);
    if (!patterns[category]) patterns[category] = { count: 0, totalCost: 0, avgCost: 0, tasks: [] };
    patterns[category].count++;
    patterns[category].totalCost += tc.estimatedCost;
    patterns[category].avgCost = Math.round((patterns[category].totalCost / patterns[category].count) * 10) / 10;
    patterns[category].tasks.push({ title: tc.title, cost: tc.estimatedCost, session: tc.session });
  }
  // Sort each category's tasks by cost desc (highest cost first shown on expand)
  for (const cat of Object.values(patterns)) {
    cat.tasks.sort((a, b) => b.cost - a.cost);
  }

  return {
    individual: taskCosts.slice(0, 20),
    patterns,
    totalTasksAnalyzed: taskCosts.length,
  };
}

function categorizeTask(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('typescript') || t.includes('migration') || t.includes('convert')) return 'TypeScript/Migration';
  if (t.includes('test') || t.includes('vitest')) return 'Testing';
  if (t.includes('fix') || t.includes('bug') || t.includes('patch')) return 'Bug Fix';
  if (t.includes('overseer') || t.includes('ai') || t.includes('llm')) return 'AI/Overseer';
  if (t.includes('graph') || t.includes('ledger') || t.includes('decision')) return 'Knowledge Graph';
  if (t.includes('search') || t.includes('embed')) return 'Search';
  if (t.includes('fuel') || t.includes('usage') || t.includes('estimator')) return 'Fuel Management';
  if (t.includes('git') || t.includes('commit') || t.includes('push')) return 'Git Operations';
  if (t.includes('dashboard') || t.includes('ui') || t.includes('widget')) return 'Dashboard/UI';
  if (t.includes('audit')) return 'Audit';
  return 'Feature Build';
}

// ── Session patterns ────────────────────────────────────
function analyzeSessionPatterns(store: NexusStore) {
  const usage = store.getUsage(500);
  const sessions = detectSessions(usage, store);

  if (sessions.length < 2) {
    return { insufficient: true, message: 'Need more session data for pattern analysis.' };
  }

  // Average burn rate across all sessions
  const avgBurnRate = sessions.reduce((s, x) => s + x.burnRate, 0) / sessions.length;

  // v4.5.4 #257 — filter outliers before picking most/least efficient. Previously
  // "Most efficient: 0%/h over 2.2h" (a session where fuel wasn't read during work)
  // and "Least efficient: 487.5%/h over 0.2h" (a near-instant reading that divided
  // by ~12 minutes) were leaking in. Require:
  //   - duration ≥ 0.5h (enough work to be a real session)
  //   - burnRate in (0, 200]%/h — anything outside is instrumentation noise
  //   - dataPoints ≥ 2 (already guaranteed by detectSessions, belt-and-braces)
  const validSessions = sessions.filter(s =>
    s.durationHours >= 0.5 &&
    s.burnRate > 0 &&
    s.burnRate <= 200 &&
    s.dataPoints >= 2,
  );
  const sorted = validSessions.length >= 2
    ? [...validSessions].sort((a, b) => a.burnRate - b.burnRate)
    : null;
  const mostEfficient = sorted ? sorted[0] : null;
  const leastEfficient = sorted ? sorted[sorted.length - 1] : null;

  // By time of day (morning/afternoon/evening/night)
  const timeSlots: Record<string, { sessions: number; avgBurn: number; totalBurned: number }> = {
    morning: { sessions: 0, avgBurn: 0, totalBurned: 0 },    // 6-12
    afternoon: { sessions: 0, avgBurn: 0, totalBurned: 0 },  // 12-18
    evening: { sessions: 0, avgBurn: 0, totalBurned: 0 },    // 18-24
    night: { sessions: 0, avgBurn: 0, totalBurned: 0 },      // 0-6
  };

  for (const s of sessions) {
    const slot = s.hourOfDay < 6 ? 'night' : s.hourOfDay < 12 ? 'morning' : s.hourOfDay < 18 ? 'afternoon' : 'evening';
    timeSlots[slot].sessions++;
    timeSlots[slot].totalBurned += s.burned;
  }
  for (const slot of Object.values(timeSlots)) {
    slot.avgBurn = slot.sessions > 0 ? Math.round(slot.totalBurned / slot.sessions * 10) / 10 : 0;
  }

  // Trend: is burn rate improving over time?
  let trend: 'improving' | 'stable' | 'degrading' = 'stable';
  if (sessions.length >= 4) {
    const firstHalf = sessions.slice(0, Math.floor(sessions.length / 2));
    const secondHalf = sessions.slice(Math.floor(sessions.length / 2));
    const firstAvg = firstHalf.reduce((s, x) => s + x.burnRate, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, x) => s + x.burnRate, 0) / secondHalf.length;
    if (secondAvg < firstAvg * 0.85) trend = 'improving';
    else if (secondAvg > firstAvg * 1.15) trend = 'degrading';
  }

  // v4.4.4 #264 — week-over-week delta: split sessions into "last 7d" vs "prior 7d"
  // and compute delta on the three headline metrics so users see direction+magnitude
  // of change, not just the abstract "improving/stable" badge.
  const nowMs = Date.now();
  const weekMs = 7 * 86400000;
  const thisWeek = sessions.filter(s => new Date(s.startTime).getTime() > nowMs - weekMs);
  const priorWeek = sessions.filter(s => {
    const t = new Date(s.startTime).getTime();
    return t > nowMs - 2 * weekMs && t <= nowMs - weekMs;
  });
  function avg(arr: SessionWindow[], key: 'burnRate' | 'durationHours' | 'burned'): number | null {
    if (arr.length === 0) return null;
    return arr.reduce((s, x) => s + x[key], 0) / arr.length;
  }
  function delta(curr: number | null, prev: number | null): number | null {
    if (curr == null || prev == null) return null;
    return Math.round((curr - prev) * 10) / 10;
  }
  const wow = {
    avgBurnRate: delta(avg(thisWeek, 'burnRate'), avg(priorWeek, 'burnRate')),
    avgSessionDuration: delta(avg(thisWeek, 'durationHours'), avg(priorWeek, 'durationHours')),
    avgFuelPerSession: delta(avg(thisWeek, 'burned'), avg(priorWeek, 'burned')),
    thisWeekSessions: thisWeek.length,
    priorWeekSessions: priorWeek.length,
  };

  return {
    totalSessions: sessions.length,
    avgBurnRate: Math.round(avgBurnRate * 10) / 10,
    avgSessionDuration: Math.round(sessions.reduce((s, x) => s + x.durationHours, 0) / sessions.length * 10) / 10,
    avgFuelPerSession: Math.round(sessions.reduce((s, x) => s + x.burned, 0) / sessions.length * 10) / 10,
    wow,
    // v4.5.4 #257 — null when no sessions pass the outlier filter (rare edge case
    // for stores with very few real sessions logged). Client renders "not enough
    // clean data" instead of garbage numbers.
    mostEfficient: mostEfficient ? {
      burnRate: mostEfficient.burnRate,
      time: mostEfficient.startTime,
      duration: mostEfficient.durationHours,
    } : null,
    leastEfficient: leastEfficient ? {
      burnRate: leastEfficient.burnRate,
      time: leastEfficient.startTime,
      duration: leastEfficient.durationHours,
    } : null,
    // v4.5.4 #257 — expose the filtered count so the client can footnote
    // "based on N sessions that passed the outlier filter".
    validSessionCount: validSessions.length,
    timeSlots,
    trend,
    sessions: sessions.map(s => ({
      start: s.startTime,
      burned: s.burned,
      duration: s.durationHours,
      burnRate: s.burnRate,
      hour: s.hourOfDay,
    })),
  };
}

// ── Weekly optimization ─────────────────────────────────
function buildWeeklyPlan(store: NexusStore) {
  const usage = store.getUsage(500);
  const sessions = detectSessions(usage, store);
  const latestUsage = store.getLatestUsage();
  const weeklyRemaining = latestUsage?.weekly_percent ?? 100;

  const patterns = analyzeSessionPatterns(store);
  if ('insufficient' in patterns) {
    return { available: false, reason: 'Need more data.' };
  }

  const avgFuelPerSession = patterns.avgFuelPerSession || 15;

  // How many sessions can we afford this week?
  // Weekly % is a different scale than session %. Estimate: each session costs ~3% of weekly.
  // Refine from actual data if available
  let weeklyPerSession = 3; // default estimate
  if (sessions.length >= 3) {
    // Count how many sessions happened in the last 7 days and how much weekly dropped
    const weekAgo = Date.now() - 7 * 86400000;
    const recentSessions = sessions.filter(s => new Date(s.startTime).getTime() > weekAgo);
    const weeklyUsage = usage.filter(u => new Date(u.created_at).getTime() > weekAgo && u.weekly_percent != null);
    if (weeklyUsage.length >= 2 && recentSessions.length > 0) {
      const weeklyStart = Math.max(...weeklyUsage.map(u => u.weekly_percent!));
      const weeklyEnd = Math.min(...weeklyUsage.map(u => u.weekly_percent!));
      const weeklyBurned = weeklyStart - weeklyEnd;
      weeklyPerSession = Math.round((weeklyBurned / recentSessions.length) * 10) / 10;
    }
  }

  const sessionsAffordable = weeklyPerSession > 0 ? Math.floor(weeklyRemaining / weeklyPerSession) : 10;

  // v4.5.4 #258 — suppress low-n timing claims. Previously "Best efficiency during
  // night sessions (avg 11% burned per session)" could ride on n=1. Require ≥ 3
  // sessions per slot before claiming optimal timing. Slots with n < 3 still render
  // in the time-of-day chart (with sample size visible) but don't drive the headline
  // recommendation.
  const MIN_SLOT_N = 3;
  const timingCandidates = Object.entries(patterns.timeSlots as Record<string, { sessions: number; avgBurn: number; totalBurned: number }>)
    .filter(([, v]) => v.sessions >= MIN_SLOT_N);
  const bestSlot = timingCandidates.sort((a, b) => a[1].avgBurn - b[1].avgBurn)[0];
  const timingConfidence: 'none' | 'low' | 'normal' = !bestSlot
    ? 'none'
    : bestSlot[1].sessions < 5 ? 'low' : 'normal';

  // Task backlog sizing
  const tasks = store.getAllTasks().filter(t => t.status !== 'done');
  const backlogCount = tasks.filter(t => t.status === 'backlog').length;
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
  const estimatedSessions = Math.ceil(backlogCount / 3); // ~3 tasks per session average

  // v4.5.4 #260 — spell out the clear-time math users were doing in their heads.
  // estimatedSessions / sessionsAffordable-per-week = weeks-to-clear. Render as
  // plain language so "Est. sessions ~26" + "Sessions affordable 10 this week"
  // doesn't leave the reader multiplying.
  let clearTimePlain: string | null = null;
  if (sessionsAffordable > 0 && backlogCount > 0) {
    const weeksToClear = estimatedSessions / sessionsAffordable;
    if (weeksToClear < 0.5) {
      clearTimePlain = 'At current pace, backlog clears within this week.';
    } else if (weeksToClear < 1.2) {
      clearTimePlain = 'At current pace, backlog clears in ~1 week.';
    } else {
      clearTimePlain = `At current pace, backlog clears in ~${Math.round(weeksToClear)} weeks.`;
    }
  }

  return {
    weeklyRemaining,
    weeklyPerSession: weeklyPerSession || 3,
    sessionsAffordable,
    recommendation: sessionsAffordable > 5
      ? `Healthy budget: ${sessionsAffordable} sessions available. Work freely.`
      : sessionsAffordable > 2
      ? `Budget tightening: ${sessionsAffordable} sessions left. Prioritize high-impact work.`
      : `Low fuel: ${sessionsAffordable} sessions max. Focus on commits, handoffs, and small fixes.`,
    optimalTiming: bestSlot
      ? `Best efficiency during ${bestSlot[0]} sessions (avg ${bestSlot[1].avgBurn}% burned, n=${bestSlot[1].sessions}).`
      : `Insufficient data for timing recommendation (need ≥${MIN_SLOT_N} sessions per time slot).`,
    timingConfidence,
    trend: patterns.trend,
    backlog: {
      total: backlogCount,
      inProgress: inProgressCount,
      estimatedSessions,
      clearTimePlain,
    },
  };
}

// ── Composite intelligence report ───────────────────────
function buildFuelIntelligence(store: NexusStore) {
  const patterns = analyzeSessionPatterns(store);
  const taskCosts = learnTaskCosts(store);
  const weeklyPlan = buildWeeklyPlan(store);
  const latestUsage = store.getLatestUsage();

  return {
    current: {
      session: latestUsage?.session_percent ?? null,
      weekly: latestUsage?.weekly_percent ?? null,
      lastReport: latestUsage?.created_at ?? null,
    },
    patterns: 'insufficient' in patterns ? null : patterns,
    taskCosts,
    weeklyPlan: 'available' in weeklyPlan && !weeklyPlan.available ? null : weeklyPlan,
  };
}
