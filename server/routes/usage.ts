import { Router, type Request, type Response } from 'express';
import type { NexusStore } from '../db/store.ts';

type BroadcastFn = (data: any) => void;

// ── Reset schedule ─────────────────────────────────────
const TIMEZONE = 'Europe/Prague';

// Session: FIXED 5-hour windows (hard reset, NOT rolling from first use).
// The user reports reset_in_minutes which tells us when the current window
// ends. We store that absolute time and count down to it. When it passes,
// the next window starts. We NEVER auto-start a rolling window.
const SESSION_WINDOW_HOURS = 5;

// Weekly: fixed reset Thursday 21:00 CET
const WEEKLY_RESET_DAY = 4;    // 0=Sun, 4=Thu
const WEEKLY_RESET_HOUR = 21;

// ── Session tracking (persisted in store) ──────────────
// _sessionTiming is stored in store.data so it survives restarts
let _store: NexusStore | null = null;

function getSessionTiming() {
  return (_store as any)?.data?._sessionTiming || {};
}

function nowInTZ() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

function startSession(resetMinutesFromNow: number | null = null) {
  const now = nowInTZ();
  // Only set resetTime when the user explicitly provides reset_in_minutes.
  // Without that, use the last known resetTime or fall back to SESSION_WINDOW_HOURS
  // from NOW (best guess, will be corrected on next user report).
  const existing = getSessionTiming();
  const timing = {
    startTime: now.toISOString(),
    resetTime: resetMinutesFromNow != null
      ? new Date(now.getTime() + resetMinutesFromNow * 60000).toISOString()
      : existing.resetTime || new Date(now.getTime() + SESSION_WINDOW_HOURS * 3600000).toISOString(),
    // Track whether the resetTime came from user input (authoritative) or was guessed
    resetSource: resetMinutesFromNow != null ? 'user' : (existing.resetSource || 'estimated'),
  };
  if (_store) {
    (_store as any).data._sessionTiming = timing;
    (_store as any)._flush();
  }
}

function getNextWeeklyReset() {
  const now = nowInTZ();
  const reset = new Date(now);
  const daysUntil = (WEEKLY_RESET_DAY - now.getDay() + 7) % 7;
  if (daysUntil === 0 && (now.getHours() > WEEKLY_RESET_HOUR || (now.getHours() === WEEKLY_RESET_HOUR && now.getMinutes() > 0))) {
    reset.setDate(reset.getDate() + 7);
  } else {
    reset.setDate(reset.getDate() + daysUntil);
  }
  reset.setHours(WEEKLY_RESET_HOUR, 0, 0, 0);
  return reset;
}

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

export function buildTimingInfo() {
  const now = nowInTZ();
  const nextWeekly = getNextWeeklyReset();
  const weeklyMs = nextWeekly.getTime() - now.getTime();

  const timing = getSessionTiming();
  const sessionResetTime = timing.resetTime ? new Date(timing.resetTime) : null;
  const sessionStartTime = timing.startTime ? new Date(timing.startTime) : null;

  let sessionInfo: any;
  if (sessionResetTime) {
    const sessionMs = sessionResetTime.getTime() - now.getTime();
    const elapsed = sessionStartTime ? now.getTime() - sessionStartTime.getTime() : 0;
    sessionInfo = {
      type: 'rolling',
      windowHours: SESSION_WINDOW_HOURS,
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
      type: 'rolling',
      windowHours: SESSION_WINDOW_HOURS,
      startedAt: null,
      countdown: 'no active session',
      countdownMs: 0,
    };
  }

  return {
    now: now.toISOString(),
    timezone: TIMEZONE,
    session: sessionInfo,
    weekly: {
      resetsAt: `Thursday ${WEEKLY_RESET_HOUR}:00 ${TIMEZONE}`,
      nextReset: nextWeekly.toISOString(),
      countdown: formatCountdown(weeklyMs),
      countdownMs: weeklyMs,
    },
  };
}

export function createUsageRoutes(store: NexusStore, broadcast: BroadcastFn) {
  _store = store; // capture for session timing persistence
  const router = Router();

  // Get usage history
  router.get('/', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(store.getUsage(limit));
  });

  // Get latest reading with timing context
  router.get('/latest', (req: Request, res: Response) => {
    const latest = store.getLatestUsage();
    const timing = buildTimingInfo();
    if (!latest) return res.json({ tracked: false, timing });

    // Calculate burn rate from recent history
    const history = store.getUsage(10);
    let burnRate: any = null;
    // Only use data points from current session window
    const curTiming = getSessionTiming();
    const curStart = curTiming.startTime ? new Date(curTiming.startTime) : null;
    const sessionHistory = curStart
      ? history.filter((h: any) => new Date(h.created_at) >= curStart)
      : history;

    if (sessionHistory.length >= 2) {
      const newest = sessionHistory[0];
      const oldest = sessionHistory[sessionHistory.length - 1];
      const timeDiffH = (new Date(newest.created_at).getTime() - new Date(oldest.created_at).getTime()) / 3600000;
      if (timeDiffH > 0.01 && oldest.session_percent != null && newest.session_percent != null) {
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
    const { session_percent, weekly_percent, note, reset_in_minutes } = req.body;

    if (session_percent == null && weekly_percent == null) {
      return res.status(400).json({ error: 'Provide session_percent and/or weekly_percent.' });
    }

    // Auto-start session tracking on first log, or if reset_in_minutes is provided
    const existingTiming = getSessionTiming();
    if (!existingTiming.startTime || reset_in_minutes != null) {
      startSession(reset_in_minutes);
    }

    const entry = store.logUsage({
      session_percent: session_percent != null ? Number(session_percent) : null,
      weekly_percent: weekly_percent != null ? Number(weekly_percent) : null,
      note,
    });

    const timing = buildTimingInfo();
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
    const timing = buildTimingInfo();
    broadcast({ type: 'usage_update', payload: { timing } });
    res.json({ success: true, timing });
  });

  // Timing info only
  router.get('/timing', (req: Request, res: Response) => {
    res.json(buildTimingInfo());
  });

  return router;
}
