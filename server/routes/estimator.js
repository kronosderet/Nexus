import { Router } from 'express';

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

export function createEstimatorRoutes(store) {
  const router = Router();

  // Get current estimated fuel + predictions
  router.get('/', (req, res) => {
    res.json(buildEstimate(store));
  });

  // Log a calibration point (user reports actual usage)
  // This is called automatically by the usage POST route
  router.get('/history', (req, res) => {
    const stats = buildHistoricalStats(store);
    res.json(stats);
  });

  // Predict cost of a task type
  router.get('/predict', (req, res) => {
    const { task_type = 'medium' } = req.query;
    const estimate = buildEstimate(store);
    const prediction = predictTaskCost(store, task_type, estimate);
    res.json(prediction);
  });

  // Get workload recommendations
  router.get('/workload', (req, res) => {
    const estimate = buildEstimate(store);
    const workload = buildWorkloadPlan(store, estimate);
    res.json(workload);
  });

  return router;
}

function buildEstimate(store) {
  const history = store.getUsage(50);
  if (history.length === 0) return { tracked: false };

  const latest = history[0];
  const now = Date.now();
  const latestTime = new Date(latest.created_at).getTime();
  const minutesSinceReport = (now - latestTime) / 60000;

  // Calculate burn rates from history
  const rates = calculateBurnRates(history);

  // Interpolate current fuel
  let estimatedSession = latest.session_percent;
  let estimatedWeekly = latest.weekly_percent;

  if (rates.sessionPerMinute > 0 && minutesSinceReport > 1) {
    estimatedSession = Math.max(0, latest.session_percent - (rates.sessionPerMinute * minutesSinceReport));
    estimatedWeekly = Math.max(0, latest.weekly_percent - (rates.weeklyPerMinute * minutesSinceReport));
  }

  // Session timing
  const timing = store.data._sessionTiming || {};
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
    .filter(v => v != null && v > 0);
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
  // A session typically burns 50-80% fuel, so sessions left ≈ weekly% / avg_session_burn
  const avgSessionBurn = 3; // ~3% of weekly per session (rough estimate, improves with data)
  const sessionsLeftThisWeek = estimatedWeekly > 0 ? Math.floor(estimatedWeekly / avgSessionBurn) : 0;

  return {
    tracked: true,
    reported: {
      session: latest.session_percent,
      weekly: latest.weekly_percent,
      at: latest.created_at,
      minutesAgo: Math.round(minutesSinceReport),
    },
    estimated: {
      session: Math.round(estimatedSession * 10) / 10,
      weekly: Math.round(estimatedWeekly * 10) / 10,
      confidence: minutesSinceReport < 5 ? 'high' : minutesSinceReport < 30 ? 'medium' : 'low',
    },
    rates: {
      sessionPerHour: rates.sessionPerHour,
      weeklyPerHour: rates.weeklyPerHour,
      sessionPerMinute: Math.round(rates.sessionPerMinute * 1000) / 1000,
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
  };
}

function calculateBurnRates(history) {
  // Calculate from consecutive report pairs
  const sessionRates = [];
  const weeklyRates = [];

  for (let i = 0; i < history.length - 1; i++) {
    const newer = history[i];
    const older = history[i + 1];
    const minutes = (new Date(newer.created_at) - new Date(older.created_at)) / 60000;

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

  return {
    sessionPerMinute: avgSession,
    weeklyPerMinute: avgWeekly,
    sessionPerHour: Math.round(avgSession * 60 * 10) / 10,
    weeklyPerHour: Math.round(avgWeekly * 60 * 10) / 10,
  };
}

function weightedAvg(values) {
  if (values.length === 0) return 0;
  let sum = 0, weightSum = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = values.length - i; // newer = higher weight
    sum += values[i] * weight;
    weightSum += weight;
  }
  return sum / weightSum;
}

function buildHistoricalStats(store) {
  const history = store.getUsage(200);
  if (history.length < 2) return { insufficient: true };

  // Group by session windows (detect resets: when session% jumps up)
  const sessions = [];
  let currentSession = { reports: [history[0]], startFuel: history[history.length - 1].session_percent };

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    // Detect session reset: fuel jumps up significantly
    if (curr.session_percent != null && prev.session_percent != null &&
        curr.session_percent > prev.session_percent + 20) {
      sessions.push(currentSession);
      currentSession = { reports: [curr] };
    } else {
      currentSession.reports.push(curr);
    }
  }
  sessions.push(currentSession);

  // Per-session stats
  const sessionStats = sessions.filter(s => s.reports.length >= 2).map(s => {
    const first = s.reports[s.reports.length - 1];
    const last = s.reports[0];
    const duration = (new Date(last.created_at) - new Date(first.created_at)) / 3600000;
    const burned = (first.session_percent || 100) - (last.session_percent || 0);
    return {
      duration: Math.round(duration * 10) / 10,
      burned: Math.round(burned),
      rate: duration > 0 ? Math.round((burned / duration) * 10) / 10 : 0,
      reports: s.reports.length,
    };
  });

  // Average burn rate across all sessions
  const avgRate = sessionStats.length > 0
    ? Math.round(sessionStats.reduce((s, x) => s + x.rate, 0) / sessionStats.length * 10) / 10
    : 0;

  return {
    totalReports: history.length,
    sessionsDetected: sessions.length,
    sessionStats,
    averageBurnRate: avgRate,
    averageSessionDuration: sessionStats.length > 0
      ? Math.round(sessionStats.reduce((s, x) => s + x.duration, 0) / sessionStats.length * 10) / 10
      : 0,
  };
}

// Task size presets (in estimated minutes of Claude interaction)
const TASK_SIZES = {
  tiny: { minutes: 5, label: 'Quick fix, config change, single edit', fuelCost: 3 },
  small: { minutes: 15, label: 'Bug fix, small feature, review', fuelCost: 8 },
  medium: { minutes: 30, label: 'Feature, refactor, multi-file change', fuelCost: 15 },
  large: { minutes: 60, label: 'Architecture, new module, migration', fuelCost: 25 },
  huge: { minutes: 120, label: 'Full system build, major rewrite', fuelCost: 45 },
};

function predictTaskCost(store, taskType, estimate) {
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

function buildWorkloadPlan(store, estimate) {
  if (!estimate.tracked || !estimate.session?.minutesRemaining) {
    return { available: false, reason: 'Insufficient data for workload planning.' };
  }

  const remaining = estimate.session.minutesRemaining;
  const fuel = estimate.estimated.session;
  const constraint = estimate.session.constrainingFactor;

  // What fits in the remaining runway?
  const fits = {};
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
  let recommendation;
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
