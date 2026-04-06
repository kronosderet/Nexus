import { Router } from 'express';

const TIMEZONE = 'Europe/Prague';
const WEEKLY_RESET_DAY = 4;    // Thursday
const WEEKLY_RESET_HOUR = 21;

export function createClockRoutes(store, getUsageTiming) {
  const router = Router();

  router.get('/', (req, res) => {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    const hour = local.getHours();

    // Get fuel from store
    const usage = store.getLatestUsage();
    const history = store.getUsage(50);

    // Get session timing from the usage route (single source of truth)
    let usageTiming = null;
    try {
      // Fetch from our own usage/latest endpoint internally
      usageTiming = getUsageTiming ? getUsageTiming() : null;
    } catch {}

    // Weekly reset
    const nextWeeklyReset = getNextWeeklyReset(local);
    const weeklyMs = nextWeeklyReset.getTime() - local.getTime();

    // Work hours
    const isWorkHours = hour >= 9 && hour < 24;
    const hoursLeftToday = Math.max(0, 24 - hour);

    // Fuel burn projection from history within current session
    let projection = null;
    const sessionHistory = history.filter(h => h.session_percent != null);
    if (sessionHistory.length >= 2) {
      const newest = sessionHistory[0];
      const oldest = sessionHistory[sessionHistory.length > 5 ? sessionHistory.length - 1 : sessionHistory.length - 1];
      const timeDiffH = (new Date(newest.created_at) - new Date(oldest.created_at)) / 3600000;
      const burned = oldest.session_percent - newest.session_percent;
      if (timeDiffH > 0.01 && burned > 0) {
        const rate = Math.round((burned / timeDiffH) * 10) / 10;
        const hoursUntilEmpty = newest.session_percent / rate;
        projection = {
          burnPerHour: rate,
          emptyInHours: Math.round(hoursUntilEmpty * 10) / 10,
          emptyAt: new Date(local.getTime() + hoursUntilEmpty * 3600000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
        };
      }
    }

    // Calendar
    const calendar = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(local);
      date.setDate(date.getDate() + d);
      const dayOfWeek = date.getDay();
      const dateStr = date.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
      calendar.push({
        date: dateStr,
        dayOfWeek,
        isToday: d === 0,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isWeeklyReset: dayOfWeek === 4,
        note: dayOfWeek === 4 ? 'Weekly fuel reset 21:00' : d === 0 ? 'Current session' : null,
      });
    }

    // Fuel history sparkline
    const fuelHistory = history.slice(0, 20).reverse().map(h => ({
      session: h.session_percent,
      weekly: h.weekly_percent,
      time: new Date(h.created_at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
    }));

    res.json({
      clock: {
        time: local.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: local.toLocaleDateString('cs-CZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        timezone: TIMEZONE,
        hour,
        isWorkHours,
        hoursLeftToday,
      },
      fuel: usage ? {
        session: usage.session_percent,
        weekly: usage.weekly_percent,
        projection,
        sessionReset: usageTiming?.session || null,
        weeklyReset: {
          countdown: formatCountdown(weeklyMs),
          date: nextWeeklyReset.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }),
        },
      } : null,
      calendar,
      fuelHistory,
    });
  });

  return router;
}

function getNextWeeklyReset(now) {
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
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
