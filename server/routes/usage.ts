import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import type { SessionTiming, UsageEntry, FuelConfig } from '../types.ts';
import { getFuelConfig, setFuelConfig as saveFuelConfig, nowInTZ as configNowInTZ, getNextWeeklyReset as configGetNextWeeklyReset, PLAN_INFO } from '../lib/fuelConfig.ts';

// v4.3.5 P1 — typed local shapes for this route.
type BroadcastFn = (data: unknown) => void;

interface SessionInfo {
  type: 'fixed';
  windowHours: number;
  startedAt: string | null;
  countdown: string;
  countdownMs: number;
  resetsAt?: string;
  elapsed?: string;
  elapsedMs?: number;
  expired?: boolean;
}

interface BurnRate {
  sessionPerHour: number;
  estimatedEmpty: string | null;
}

// Valid plan values for input sanitization (#161)
const VALID_PLANS = new Set(['free', 'pro', 'max5', 'max20', 'team', 'team_premium', 'enterprise', 'api']);

function formatCountdown(ms: number) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Build timing info — accepts store param to avoid module-level singleton (#160). */
export function buildTimingInfo(store: NexusStore) {
  const config = getFuelConfig(store);
  const now = configNowInTZ(config);
  const nextWeekly = configGetNextWeeklyReset(config);
  const weeklyMs = nextWeekly.getTime() - now.getTime();

  const timing: Partial<SessionTiming> = store.getSessionTiming() || {};
  const sessionResetTime = timing.resetTime ? new Date(timing.resetTime) : null;
  const sessionStartTime = timing.startTime ? new Date(timing.startTime) : null;
  const planInfo = PLAN_INFO[config.plan] || PLAN_INFO.pro;

  let sessionInfo: SessionInfo;
  if (sessionResetTime) {
    const sessionMs = sessionResetTime.getTime() - now.getTime();
    const elapsed = sessionStartTime ? now.getTime() - sessionStartTime.getTime() : 0;
    sessionInfo = {
      type: 'fixed',
      windowHours: config.sessionWindowHours,
      startedAt: sessionStartTime?.toISOString() || null,
      resetsAt: sessionResetTime.toISOString(),
      countdown: formatCountdown(Math.max(0, sessionMs)),
      countdownMs: Math.max(0, sessionMs),
      elapsed: formatCountdown(elapsed),
      elapsedMs: elapsed,
      expired: sessionMs <= 0,
    };
  } else {
    sessionInfo = {
      type: 'fixed',
      windowHours: config.sessionWindowHours,
      startedAt: null,
      countdown: 'no active session',
      countdownMs: 0,
    };
  }

  // v4.5.11 — derive the resetsAt label from the actual next-reset Date so the
  // label reflects the sliding window. When the user has reported a specific
  // weeklyResetTime via nexus_log_usage, the label shows that exact day+hour;
  // when falling back to weeklyResetDay/Hour, the label still reads correctly.
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const resetsAtLabel = `${dayNames[nextWeekly.getDay()]} ${String(nextWeekly.getHours()).padStart(2, '0')}:${String(nextWeekly.getMinutes()).padStart(2, '0')} ${config.timezone}`;

  return {
    now: now.toISOString(),
    timezone: config.timezone,
    plan: { name: config.plan, label: planInfo.label, multiplier: planInfo.multiplier, description: planInfo.description },
    session: sessionInfo,
    weekly: {
      resetsAt: resetsAtLabel,
      nextReset: nextWeekly.toISOString(),
      countdown: formatCountdown(weeklyMs),
      countdownMs: weeklyMs,
      // v4.5.11 — let the UI distinguish user-supplied vs legacy fallback so we
      // can show "since last reading" vs "estimated".
      source: config.weeklyResetTime ? 'reported' : 'estimated',
    },
  };
}

export function createUsageRoutes(store: NexusStore, broadcast: BroadcastFn) {
  // Session start helper — uses store closure, not module-level singleton
  function startSession(resetMinutesFromNow: number | null = null) {
    const config = getFuelConfig(store);
    const now = configNowInTZ(config);
    const existing: Partial<SessionTiming> = store.getSessionTiming() || {};
    const timing = {
      startTime: now.toISOString(),
      resetTime: resetMinutesFromNow != null
        ? new Date(now.getTime() + resetMinutesFromNow * 60000).toISOString()
        : existing.resetTime || new Date(now.getTime() + config.sessionWindowHours * 3600000).toISOString(),
      resetSource: (resetMinutesFromNow != null ? 'user' : (existing.resetSource || 'estimated')) as 'user' | 'estimated',
    };
    store.setSessionTiming(timing);
  }

  const router = Router();

  // Get usage history
  router.get('/', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(store.getUsage(limit));
  });

  // Get latest reading with timing context
  router.get('/latest', (req: Request, res: Response) => {
    const latest = store.getLatestUsage();
    const timing = buildTimingInfo(store);
    if (!latest) return res.json({ tracked: false, timing });

    // Calculate burn rate from recent history
    const history = store.getUsage(10);
    let burnRate: BurnRate | null = null;
    // Only use data points from current session window
    const curTiming: Partial<SessionTiming> = store.getSessionTiming() || {};
    const curStart = curTiming.startTime ? new Date(curTiming.startTime) : null;
    const sessionHistory = curStart
      ? history.filter((h: UsageEntry) => new Date(h.created_at) >= curStart)
      : history;

    // Need 3+ data points spanning >5 minutes for meaningful burn rate
    if (sessionHistory.length >= 3) {
      const newest = sessionHistory[0];
      const oldest = sessionHistory[sessionHistory.length - 1];
      const timeDiffH = (new Date(newest.created_at).getTime() - new Date(oldest.created_at).getTime()) / 3600000;
      if (timeDiffH > 0.08 && oldest.session_percent != null && newest.session_percent != null) {
        const pctBurned = oldest.session_percent - newest.session_percent;
        if (pctBurned > 0) {
          const rate = Math.round((pctBurned / timeDiffH) * 10) / 10;
          burnRate = {
            sessionPerHour: rate,
            estimatedEmpty: rate > 0 && newest.session_percent > 0
              ? formatCountdown((newest.session_percent / rate) * 3600000)
              : null,
          };
        }
      }
    }

    res.json({ tracked: true, ...latest, timing, burnRate });
  });

  // Log a usage data point
  router.post('/', (req: Request, res: Response) => {
    const { session_percent, weekly_percent, sonnet_weekly_percent, extra_usage, note, reset_in_minutes, plan, timezone, weekly_reset_in_hours, weekly_reset_at } = req.body;

    if (session_percent == null && weekly_percent == null) {
      return res.status(400).json({ error: 'Provide session_percent and/or weekly_percent.' });
    }

    // Save plan/timezone config if provided — validate before saving (#161)
    // v4.5.11 — also persist weekly_reset_in_hours (sliding window). Either
    // the explicit ISO `weekly_reset_at` OR `weekly_reset_in_hours` (relative)
    // is accepted; the latter is converted to absolute and stored.
    // v4.5.12 — when storing weeklyResetTime, ALSO derive weeklyResetDay/Hour
    // from the resulting Date. The weekly cycle is fixed (every 7d at the same
    // local time), so updating the fallback fields keeps them correct after
    // weeklyResetTime expires and we fall back to day-of-week + hour.
    if (plan || timezone || weekly_reset_in_hours != null || weekly_reset_at) {
      const updates: Partial<FuelConfig> = {};
      if (plan && VALID_PLANS.has(plan)) updates.plan = plan;
      if (timezone && typeof timezone === 'string' && timezone.includes('/')) updates.timezone = timezone;
      let resetDate: Date | null = null;
      if (weekly_reset_at && typeof weekly_reset_at === 'string') {
        const d = new Date(weekly_reset_at);
        if (!isNaN(d.getTime())) resetDate = d;
      } else if (weekly_reset_in_hours != null) {
        const hours = Number(weekly_reset_in_hours);
        if (Number.isFinite(hours) && hours >= 0) {
          resetDate = new Date(Date.now() + hours * 3600000);
        }
      }
      if (resetDate) {
        updates.weeklyResetTime = resetDate.toISOString();
        // Derive day-of-week + hour fallback from the same Date so the cycle
        // continues correctly once weeklyResetTime passes.
        const cfg = getFuelConfig(store);
        const localized = new Date(resetDate.toLocaleString('en-US', { timeZone: cfg.timezone }));
        updates.weeklyResetDay = localized.getDay();
        updates.weeklyResetHour = localized.getHours();
      }
      if (Object.keys(updates).length > 0) saveFuelConfig(store, updates);
    }

    // Auto-start session tracking on first log, or if reset_in_minutes is provided
    const existingTiming: Partial<SessionTiming> = store.getSessionTiming() || {};
    if (!existingTiming.startTime || reset_in_minutes != null) {
      startSession(reset_in_minutes);
    }

    // Guard against NaN from non-numeric input (#163)
    const parsedSession = session_percent != null ? Number(session_percent) : null;
    const parsedWeekly = weekly_percent != null ? Number(weekly_percent) : null;
    if ((parsedSession != null && isNaN(parsedSession)) || (parsedWeekly != null && isNaN(parsedWeekly))) {
      return res.status(400).json({ error: 'session_percent and weekly_percent must be numbers.' });
    }
    const entry = store.logUsage({
      session_percent: parsedSession,
      weekly_percent: parsedWeekly,
      sonnet_weekly_percent: sonnet_weekly_percent != null ? Number(sonnet_weekly_percent) : undefined,
      extra_usage: extra_usage != null ? !!extra_usage : undefined,
      note,
    });

    const timing = buildTimingInfo(store);
    const payload = { ...entry, timing };
    broadcast({ type: 'usage_update', payload });

    // Smart alerts with countdown context
    if (session_percent != null && session_percent <= 15) {
      broadcast({ type: 'notification', payload: {
        title: 'Nexus',
        message: `Low session fuel: ${session_percent}% remaining. Resets in ${timing.session.countdown}. Log a session summary.`,
      }});
    }
    if (weekly_percent != null && weekly_percent <= 10) {
      broadcast({ type: 'notification', payload: {
        title: 'Nexus',
        message: `Weekly limit critical: ${weekly_percent}% remaining. Resets ${timing.weekly.countdown}. Ration wisely, Captain.`,
      }});
    }

    res.status(201).json(payload);
  });

  // Manually set session timing (e.g., "reset is in 4h 48m")
  router.post('/session', (req: Request, res: Response) => {
    const { reset_in_minutes } = req.body;
    if (reset_in_minutes == null) {
      return res.status(400).json({ error: 'Provide reset_in_minutes.' });
    }
    startSession(Number(reset_in_minutes));
    const timing = buildTimingInfo(store);
    broadcast({ type: 'usage_update', payload: { timing } });
    res.json({ success: true, timing });
  });

  // Timing info only
  router.get('/timing', (req: Request, res: Response) => {
    res.json(buildTimingInfo(store));
  });

  return router;
}
