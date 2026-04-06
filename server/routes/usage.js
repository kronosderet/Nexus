import { Router } from 'express';

// ── Reset schedule ─────────────────────────────────────
const TIMEZONE = 'Europe/Prague';

// Session: rolling 5-hour window from session start
const SESSION_WINDOW_HOURS = 5;

// Weekly: fixed reset Thursday 21:00 CET
const WEEKLY_RESET_DAY = 4;    // 0=Sun, 4=Thu
const WEEKLY_RESET_HOUR = 21;

// ── Session tracking ───────────────────────────────────
let sessionStartTime = null;    // set when first usage is logged or via /session/start
let sessionResetTime = null;

function nowInTZ() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

function startSession(resetMinutesFromNow = null) {
  const now = nowInTZ();
  sessionStartTime = new Date(now);
  if (resetMinutesFromNow != null) {
    // User told us exactly when the reset is
    sessionResetTime = new Date(now.getTime() + resetMinutesFromNow * 60000);
  } else {
    sessionResetTime = new Date(now.getTime() + SESSION_WINDOW_HOURS * 3600000);
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

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function buildTimingInfo() {
  const now = nowInTZ();
  const nextWeekly = getNextWeeklyReset();
  const weeklyMs = nextWeekly.getTime() - now.getTime();

  let sessionInfo;
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

export function createUsageRoutes(store, broadcast) {
  const router = Router();

  // Get usage history
  router.get('/', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(store.getUsage(limit));
  });

  // Get latest reading with timing context
  router.get('/latest', (req, res) => {
    const latest = store.getLatestUsage();
    const timing = buildTimingInfo();
    if (!latest) return res.json({ tracked: false, timing });

    // Calculate burn rate from recent history
    const history = store.getUsage(10);
    let burnRate = null;
    // Only use data points from current session window
    const sessionHistory = sessionStartTime
      ? history.filter(h => new Date(h.created_at) >= sessionStartTime)
      : history;

    if (sessionHistory.length >= 2) {
      const newest = sessionHistory[0];
      const oldest = sessionHistory[sessionHistory.length - 1];
      const timeDiffH = (new Date(newest.created_at) - new Date(oldest.created_at)) / 3600000;
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
  router.post('/', (req, res) => {
    const { session_percent, weekly_percent, note, reset_in_minutes } = req.body;

    if (session_percent == null && weekly_percent == null) {
      return res.status(400).json({ error: 'Provide session_percent and/or weekly_percent.' });
    }

    // Auto-start session tracking on first log, or if reset_in_minutes is provided
    if (!sessionStartTime || reset_in_minutes != null) {
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
  router.post('/session', (req, res) => {
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
  router.get('/timing', (req, res) => {
    res.json(buildTimingInfo());
  });

  return router;
}
