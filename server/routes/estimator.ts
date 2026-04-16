import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { UsageEntry, ActivityEntry, SessionTiming } from '../types.ts';
import { getFuelConfig, groupBySessionWindow } from '../lib/fuelConfig.ts';

// v4.3.5 P1 — workload recommendation shape used by buildWorkloadPlan.
interface WorkloadRecommendation {
  action: 'wrap_up' | 'small_tasks' | 'medium_tasks' | 'full_capacity';
  message: string;
  suggested: string[];
}

/**
 * Smart Fuel Estimator
 *
 * Tracks Claude usage patterns over time and predicts:
 * - Current fuel level (interpolated between reports)
 * - Burn rate per hour and per task
 * - How many "work chunks" remain in current session/week
 * - Optimal task sizing based on remaining fuel
 * - Historical efficiency patterns
 */

export function createEstimatorRoutes(store: NexusStore) {
  const router = Router();

  // Get current estimated fuel + predictions
  router.get('/', (req: Request, res: Response) => {
    res.json(buildEstimate(store));
  });

  // Log a calibration point (user reports actual usage)
  // This is called automatically by the usage POST route
  router.get('/history', (req: Request, res: Response) => {
    const stats = buildHistoricalStats(store);
    res.json(stats);
  });

  // Predict cost of a task type
  router.get('/predict', (req: Request, res: Response) => {
    const { task_type = 'medium' } = req.query;
    const estimate = buildEstimate(store);
    const prediction = predictTaskCost(store, task_type as string, estimate);
    res.json(prediction);
  });

  // Get workload recommendations
  router.get('/workload', (req: Request, res: Response) => {
    const estimate = buildEstimate(store);
    const workload = buildWorkloadPlan(store, estimate);
    res.json(workload);
  });

  return router;
}

function buildEstimate(store: NexusStore) {
  const history = store.getUsage(50);
  if (history.length === 0) return { tracked: false };

  const latest = history[0];
  const now = Date.now();
  const latestTime = new Date(latest.created_at).getTime();
  const minutesSinceReport = (now - latestTime) / 60000;

  // Calculate burn rates from history
  const rates = calculateBurnRates(history);

  // Reported values are ALWAYS the primary reading. Extrapolation is secondary.
  // The user explicitly asked for this: fuel values tick down during breaks when
  // the user isn't actually consuming fuel, which is misleading. The reported
  // value is the last authoritative reading; extrapolation is labeled as such.
  const reportedSession = latest.session_percent ?? 0;
  const reportedWeekly = latest.weekly_percent ?? 0;

  // Extrapolated values (secondary — only useful as a rough estimate during active work)
  let extrapolatedSession = reportedSession;
  let extrapolatedWeekly = reportedWeekly;
  if (rates.sessionPerMinute > 0 && minutesSinceReport > 1) {
    extrapolatedSession = Math.max(0, reportedSession - (rates.sessionPerMinute * minutesSinceReport));
    extrapolatedWeekly = Math.max(0, reportedWeekly - (rates.weeklyPerMinute * minutesSinceReport));
  }

  // PRIMARY estimated values = REPORTED (static until user reports new numbers)
  let estimatedSession = reportedSession;
  let estimatedWeekly = reportedWeekly;

  // Session timing
  const timing: Partial<SessionTiming> = store.getSessionTiming() || {};
  const resetTime = timing.resetTime ? new Date(timing.resetTime) : null;
  const minutesUntilReset = resetTime ? Math.max(0, (resetTime.getTime() - now) / 60000) : null;

  // Estimate remaining work capacity
  // KEY: session and weekly are DIFFERENT SCALES.
  // Session = per 5h window (~225 msgs on Max 5x). Burns fast per interaction.
  // Weekly = total across ALL sessions in 7 days. Much larger pool.
  // For current-session planning, SESSION fuel + session window are the constraints.
  // Weekly only matters for multi-day planning.
  const sessionMinutesLeft = rates.sessionPerMinute > 0
    ? estimatedSession / rates.sessionPerMinute
    : null;

  // For current session: constraint is session fuel or window timer (NOT weekly)
  const sessionConstraints = [sessionMinutesLeft, minutesUntilReset]
    .filter((v): v is number => v != null && v > 0);
  const constrainingMinutes = sessionConstraints.length > 0 ? Math.min(...sessionConstraints) : null;

  // Weekly is a separate longer-term gauge
  const weeklyHoursLeft = rates.weeklyPerHour > 0
    ? estimatedWeekly / rates.weeklyPerHour
    : null;

  let constraint = 'none';
  if (constrainingMinutes === minutesUntilReset) constraint = 'session_window';
  else if (constrainingMinutes === sessionMinutesLeft) constraint = 'session_fuel';

  // Work chunks: how many ~15min tasks can we do in THIS session?
  const chunksRemaining = constrainingMinutes ? Math.floor(constrainingMinutes / 15) : null;

  // Weekly planning: how many full sessions left this week?
  // Learn from historical data, but cap at sane range (2-15% per session)
  const historicalStats = buildHistoricalStats(store);
  const learnedBurn = historicalStats.averageBurnRate;
  const defaultSessionBurn = 5; // 5% of weekly per session (conservative default for Max 5x)
  const sessionBurn = (learnedBurn > 2 && learnedBurn < 15) ? learnedBurn : defaultSessionBurn;
  const sessionsLeftThisWeek = estimatedWeekly > 0 ? Math.floor(estimatedWeekly / sessionBurn) : 0;

  // Event-based costs (derived from actual activity vs fuel data)
  const eventCosts = calculateEventCosts(store);

  // Better capacity: how many prompts/tasks fit in remaining fuel
  const promptsRemaining = eventCosts?.sessionPerEvent
    ? Math.floor(estimatedSession / eventCosts.sessionPerEvent)
    : null;
  const tasksRemaining = eventCosts?.sessionPerTask
    ? Math.floor(estimatedSession / eventCosts.sessionPerTask)
    : null;
  const weeklyTasksRemaining = eventCosts?.weeklyPerTask
    ? Math.floor(estimatedWeekly / eventCosts.weeklyPerTask)
    : null;

  return {
    tracked: true,
    reported: {
      session: reportedSession,
      weekly: reportedWeekly,
      at: latest.created_at,
      minutesAgo: Math.round(minutesSinceReport),
    },
    estimated: {
      session: Math.round(estimatedSession * 10) / 10,
      weekly: Math.round(estimatedWeekly * 10) / 10,
      confidence: minutesSinceReport < 5 ? 'high' : minutesSinceReport < 30 ? 'medium' : 'low',
      source: 'reported',
    },
    extrapolated: {
      session: Math.round(extrapolatedSession * 10) / 10,
      weekly: Math.round(extrapolatedWeekly * 10) / 10,
      source: 'extrapolated',
    },
    rates: {
      sessionPerHour: rates.sessionPerHour,
      weeklyPerHour: rates.weeklyPerHour,
      sessionPerMinute: Math.round(rates.sessionPerMinute * 1000) / 1000,
    },
    // Per-event costs derived from actual usage data
    costs: eventCosts ? {
      sessionPerPrompt: eventCosts.sessionPerEvent,
      weeklyPerPrompt: eventCosts.weeklyPerEvent,
      sessionPerTask: eventCosts.sessionPerTask,
      weeklyPerTask: eventCosts.weeklyPerTask,
      minutesPerPrompt: eventCosts.minutesPerEvent,
      sampleSize: eventCosts.sampleSize,
    } : null,
    capacity: {
      promptsRemaining,
      tasksRemaining,
      weeklyTasksRemaining,
    },
    session: {
      constrainingFactor: constraint,
      minutesRemaining: constrainingMinutes ? Math.round(constrainingMinutes) : null,
      hoursRemaining: constrainingMinutes ? Math.round(constrainingMinutes / 60 * 10) / 10 : null,
      chunksRemaining,
      emptyAt: constrainingMinutes
        ? new Date(now + constrainingMinutes * 60000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
        : null,
      resetWindow: minutesUntilReset ? Math.round(minutesUntilReset) : null,
    },
    weekly: {
      remaining: Math.round(estimatedWeekly * 10) / 10,
      sessionsLeft: sessionsLeftThisWeek,
      note: `~${sessionsLeftThisWeek} full sessions before Thursday reset`,
    },
    // Weekly forecast: when will the weekly limit be hit at current pace?
    forecast: (() => {
      if (estimatedWeekly >= 95) return { status: 'fresh', message: 'Weekly limit barely touched' };
      const weeklyUsed = 100 - estimatedWeekly;
      // How many days since weekly reset? (Thursday 21:00)
      const daysSinceReset = Math.max(0.5, (7 * 86400000 - (minutesUntilReset ? minutesUntilReset * 60000 : 0)) / 86400000 || 1);
      const burnPerDay = weeklyUsed / daysSinceReset;
      if (burnPerDay <= 0) return { status: 'stable', message: 'No weekly burn detected' };
      const daysUntilEmpty = estimatedWeekly / burnPerDay;
      const daysUntilReset = minutesUntilReset ? minutesUntilReset / 1440 : 7;
      if (daysUntilEmpty > daysUntilReset) return { status: 'safe', message: `On track — will last until reset` };
      const emptyDate = new Date(Date.now() + daysUntilEmpty * 86400000);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return { status: 'warning', message: `At current pace, limit hit ${dayNames[emptyDate.getDay()]} ~${emptyDate.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` };
    })(),
  };
}

function calculateBurnRates(history: UsageEntry[]) {
  // Sort by timestamp descending (newest first) — don't assume array order
  const sorted = [...history].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  // Calculate from consecutive report pairs
  const sessionRates: number[] = [];
  const weeklyRates: number[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const newer = sorted[i];
    const older = sorted[i + 1];
    const minutes = (new Date(newer.created_at).getTime() - new Date(older.created_at).getTime()) / 60000;

    if (minutes < 1 || minutes > 360) continue; // skip weird gaps

    if (older.session_percent != null && newer.session_percent != null) {
      const burned = older.session_percent - newer.session_percent;
      if (burned > 0) sessionRates.push(burned / minutes);
    }
    if (older.weekly_percent != null && newer.weekly_percent != null) {
      const burned = older.weekly_percent - newer.weekly_percent;
      if (burned > 0) weeklyRates.push(burned / minutes);
    }
  }

  // Weighted average: recent rates matter more
  const avgSession = weightedAvg(sessionRates);
  const avgWeekly = weightedAvg(weeklyRates);

  // Session fuel is NOT time-proportional — it's compute-proportional.
  // A heavy session can burn 100% in 30 min, a light one lasts 4h.
  // We still calculate rate for internal estimates but cap aggressively.
  const rawSessionPerHour = Math.round(avgSession * 60 * 10) / 10;
  const rawWeeklyPerHour = Math.round(avgWeekly * 60 * 10) / 10;
  return {
    sessionPerMinute: avgSession,
    weeklyPerMinute: avgWeekly,
    sessionPerHour: rawSessionPerHour,
    weeklyPerHour: rawWeeklyPerHour,
  };
}

function weightedAvg(values: number[]) {
  if (values.length === 0) return 0;
  let sum = 0, weightSum = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = values.length - i; // newer = higher weight
    sum += values[i] * weight;
    weightSum += weight;
  }
  return sum / weightSum;
}

/**
 * Derive per-event and per-task fuel costs from actual historical data.
 *
 * Instead of just burn-rate-per-hour, this correlates usage readings with
 * activity events between them to calculate how much each interaction costs.
 * This gives us: "a prompt costs ~0.8% session fuel" instead of just "burning 20%/hour".
 */
function calculateEventCosts(store: NexusStore) {
  const usage = store.getUsage(100).sort(
    (a: UsageEntry, b: UsageEntry) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const activity = store.getActivity(500);

  if (usage.length < 2) return null;

  let totalEvents = 0;
  let totalSessionBurned = 0;
  let totalWeeklyBurned = 0;
  let totalMinutes = 0;
  let validPairs = 0;

  for (let i = 1; i < usage.length; i++) {
    const older = usage[i - 1];
    const newer = usage[i];
    const t1 = new Date(older.created_at).getTime();
    const t2 = new Date(newer.created_at).getTime();
    const mins = (t2 - t1) / 60000;

    if (mins < 1 || mins > 120) continue;

    const sessionBurned = (older.session_percent || 0) - (newer.session_percent || 0);
    const weeklyBurned = (older.weekly_percent || 0) - (newer.weekly_percent || 0);

    if (sessionBurned <= 0) continue;

    // Count activity events in this window
    const events = activity.filter((a: ActivityEntry) => {
      const at = new Date(a.created_at).getTime();
      return at >= t1 && at <= t2;
    }).length;

    if (events > 0) {
      totalEvents += events;
      totalSessionBurned += sessionBurned;
      totalWeeklyBurned += Math.max(0, weeklyBurned);
      totalMinutes += mins;
      validPairs++;
    }
  }

  if (validPairs === 0 || totalEvents === 0) return null;

  const sessionPerEvent = totalSessionBurned / totalEvents;
  const weeklyPerEvent = totalWeeklyBurned / totalEvents;
  const minutesPerEvent = totalMinutes / totalEvents;

  // Task cost: average events per task completion
  const tasksDone = store.getAllTasks().filter(t => t.status === 'done');
  const eventsPerTask = totalEvents > 0 && tasksDone.length > 0
    ? Math.max(3, Math.round(totalEvents / Math.max(1, tasksDone.length))) // events per completed task (direct ratio)
    : 8; // default: 8 events per task (conservative estimate)

  return {
    sessionPerEvent: Math.round(sessionPerEvent * 1000) / 1000,
    weeklyPerEvent: Math.round(weeklyPerEvent * 1000) / 1000,
    minutesPerEvent: Math.round(minutesPerEvent * 10) / 10,
    sessionPerTask: Math.round(sessionPerEvent * eventsPerTask * 10) / 10,
    weeklyPerTask: Math.round(weeklyPerEvent * eventsPerTask * 10) / 10,
    eventsPerTask,
    sampleSize: validPairs,
    totalEventsMeasured: totalEvents,
  };
}

function buildHistoricalStats(store: NexusStore) {
  const raw = store.getUsage(200);
  if (raw.length < 2) return { insufficient: true };

  // Group by real 5h window boundaries (not fuel-jump heuristic)
  const config = getFuelConfig(store);
  const windows = groupBySessionWindow(raw, config);

  // Per-window stats: highest fuel = session start, lowest = session end
  const sessionStats = windows
    .filter(w => w.entries.length >= 2)
    .map(w => {
      const entries = w.entries;
      const first = entries[0];
      const last = entries[entries.length - 1];
      const durationMs = new Date(last.created_at).getTime() - new Date(first.created_at).getTime();
      const durationH = durationMs / 3600000;

      // Find highest and lowest session_percent in this window
      const maxFuel = Math.max(...entries.map((e: UsageEntry) => e.session_percent ?? 0));
      const minFuel = Math.min(...entries.map((e: UsageEntry) => e.session_percent ?? 100));
      const burned = Math.max(0, maxFuel - minFuel);

      // Weekly burn: first weekly reading vs last in this window
      const weeklyStart = first.weekly_percent ?? 0;
      const weeklyEnd = last.weekly_percent ?? 0;
      const weeklyBurned = Math.max(0, weeklyStart - weeklyEnd);

      return {
        duration: Math.round(durationH * 10) / 10,
        burned: Math.round(burned),
        weeklyBurned: Math.round(weeklyBurned),
        rate: durationH > 0.1 ? Math.round((burned / durationH) * 10) / 10 : 0,
        reports: entries.length,
        date: new Date(w.windowStart).toLocaleDateString(),
        windowStart: w.windowStart,
      };
    })
    .filter(s => s.burned > 0); // skip empty windows (already newest-first from groupBySessionWindow)

  const avgRate = sessionStats.length > 0
    ? Math.round(sessionStats.reduce((s, x) => s + x.rate, 0) / sessionStats.length * 10) / 10
    : 0;

  return {
    totalReports: raw.length,
    sessionsDetected: sessionStats.length,
    sessionStats, // all sessions (client handles pagination)
    averageBurnRate: avgRate,
    averageSessionDuration: sessionStats.length > 0
      ? Math.round(sessionStats.reduce((s, x) => s + x.duration, 0) / sessionStats.length * 10) / 10
      : 0,
  };
}

// Task size presets (in estimated minutes of Claude interaction)
const TASK_SIZES: Record<string, { minutes: number; label: string; fuelCost: number }> = {
  tiny: { minutes: 5, label: 'Quick fix, config change, single edit', fuelCost: 3 },
  small: { minutes: 15, label: 'Bug fix, small feature, review', fuelCost: 8 },
  medium: { minutes: 30, label: 'Feature, refactor, multi-file change', fuelCost: 15 },
  large: { minutes: 60, label: 'Architecture, new module, migration', fuelCost: 25 },
  huge: { minutes: 120, label: 'Full system build, major rewrite', fuelCost: 45 },
};

function predictTaskCost(store: NexusStore, taskType: string, estimate: ReturnType<typeof buildEstimate>) {
  const preset = TASK_SIZES[taskType] || TASK_SIZES.medium;
  const rate = estimate.rates?.sessionPerMinute || 0;

  // Estimate fuel cost based on burn rate or preset
  const estimatedCost = rate > 0
    ? Math.round(rate * preset.minutes * 10) / 10
    : preset.fuelCost;

  const canAfford = estimate.estimated
    ? estimate.estimated.session >= estimatedCost
    : null;

  return {
    taskType,
    ...preset,
    estimatedFuelCost: estimatedCost,
    canAfford,
    currentFuel: estimate.estimated?.session,
    afterTask: canAfford ? Math.round((estimate.estimated.session - estimatedCost) * 10) / 10 : null,
  };
}

function buildWorkloadPlan(store: NexusStore, estimate: ReturnType<typeof buildEstimate>) {
  if (!estimate.tracked || !estimate.session?.minutesRemaining) {
    return { available: false, reason: 'Insufficient data for workload planning.' };
  }

  const remaining = estimate.session.minutesRemaining;
  const fuel = estimate.estimated.session;
  const constraint = estimate.session.constrainingFactor;

  // What fits in the remaining runway?
  interface TaskFit { count: number; label: string; fuelEach: number }
  const fits: Record<string, TaskFit> = {};
  for (const [type, preset] of Object.entries(TASK_SIZES)) {
    const rate = estimate.rates.sessionPerMinute || (preset.fuelCost / preset.minutes);
    const fuelNeeded = rate * preset.minutes;
    const count = Math.floor(fuel / fuelNeeded);
    fits[type] = {
      count,
      label: preset.label,
      fuelEach: Math.round(fuelNeeded * 10) / 10,
    };
  }

  // Smart recommendation
  let recommendation: WorkloadRecommendation;
  if (fuel <= 10) {
    recommendation = {
      action: 'wrap_up',
      message: 'Low fuel. Log a session summary and stop. Save remaining fuel for emergencies.',
      suggested: ['nexus session "..."', 'git commit'],
    };
  } else if (fuel <= 25) {
    recommendation = {
      action: 'small_tasks',
      message: `${fits.small.count} small tasks remaining. Focus on quick wins and bug fixes.`,
      suggested: fits.small.count > 0 ? ['Bug fixes', 'Config changes', 'Documentation'] : ['Log session and stop'],
    };
  } else if (fuel <= 50) {
    recommendation = {
      action: 'medium_tasks',
      message: `${fits.medium.count} medium tasks or ${fits.small.count} small tasks. One feature at a time.`,
      suggested: ['Single feature', 'Refactor', 'Code review'],
    };
  } else {
    recommendation = {
      action: 'full_capacity',
      message: `Full capacity: ${fits.large.count} large tasks or ${fits.medium.count} medium. Build freely.`,
      suggested: ['New module', 'Architecture work', 'Multi-file refactor'],
    };
  }

  return {
    currentSession: {
      fuel: Math.round(fuel),
      constraint,
      minutesRemaining: Math.round(remaining),
      taskCapacity: fits,
      recommendation,
    },
    weeklyOutlook: {
      remaining: estimate.weekly?.remaining,
      sessionsLeft: estimate.weekly?.sessionsLeft,
      note: estimate.weekly?.note,
    },
  };
}
