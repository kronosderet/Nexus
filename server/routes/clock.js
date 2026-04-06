import { Router } from 'express';

const TIMEZONE = 'Europe/Prague';

export function createClockRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
    const hour = local.getHours();
    const day = local.getDay(); // 0=Sun

    // Session fuel timing
    const usage = store.getLatestUsage();
    const history = store.getUsage(50);

    // Weekly reset: Thursday 21:00 CET
    const nextWeeklyReset = getNextWeeklyReset(local);
    const weeklyMs = nextWeeklyReset.getTime() - local.getTime();

    // Work hours analysis
    const isWorkHours = hour >= 9 && hour < 22;
    const hoursLeftToday = Math.max(0, 22 - hour);

    // Fuel burn projection
    let burnRate = null;
    let projection = null;
    if (history.length >= 2) {
      const recent = history.filter(h => h.session_percent != null).slice(0, 5);
      if (recent.length >= 2) {
        const newest = recent[0];
        const oldest = recent[recent.length - 1];
        const timeDiffH = (new Date(newest.created_at) - new Date(oldest.created_at)) / 3600000;
        const burned = oldest.session_percent - newest.session_percent;
        if (timeDiffH > 0.01 && burned > 0) {
          burnRate = Math.round((burned / timeDiffH) * 10) / 10;
          const sessionLeft = newest.session_percent;
          const hoursUntilEmpty = sessionLeft / burnRate;
          projection = {
            burnPerHour: burnRate,
            emptyInHours: Math.round(hoursUntilEmpty * 10) / 10,
            emptyAt: new Date(local.getTime() + hoursUntilEmpty * 3600000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
          };
        }
      }
    }

    // Calendar: upcoming week workload windows
    const weekPlan = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(local);
      date.setDate(date.getDate() + d);
      const dayOfWeek = date.getDay();
      const dateStr = date.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
      const isWeeklyReset = dayOfWeek === 4; // Thursday
      const isToday = d === 0;

      weekPlan.push({
        date: dateStr,
        dayOfWeek,
        isToday,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isWeeklyReset,
        note: isWeeklyReset ? 'Weekly fuel reset 21:00' : isToday ? 'Current session' : null,
      });
    }

    // Session history for sparkline (last 20 data points)
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
        weeklyReset: {
          countdown: formatCountdown(weeklyMs),
          date: nextWeeklyReset.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }),
        },
      } : null,
      calendar: weekPlan,
      fuelHistory,
    });
  });

  return router;
}

function getNextWeeklyReset(now) {
  const reset = new Date(now);
  const daysUntil = (4 - now.getDay() + 7) % 7; // Thursday
  if (daysUntil === 0 && (now.getHours() > 21 || (now.getHours() === 21 && now.getMinutes() > 0))) {
    reset.setDate(reset.getDate() + 7);
  } else {
    reset.setDate(reset.getDate() + daysUntil);
  }
  reset.setHours(21, 0, 0, 0);
  return reset;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
