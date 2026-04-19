import { Router, Request, Response } from 'express';
import type { NexusStore } from '../db/store.ts';
import { getFuelConfig, nowInTZ, getNextWeeklyReset as configGetNextWeeklyReset } from '../lib/fuelConfig.ts';
import { buildTimingInfo } from './usage.ts';

export function createClockRoutes(store: NexusStore, _getUsageTiming?: () => any): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const config = getFuelConfig(store);
    const local = nowInTZ(config);
    const hour = local.getHours();

    // Get fuel from store
    const usage = store.getLatestUsage();
    const history = store.getUsage(50);

    // Get session timing from the shared buildTimingInfo (single source of truth, #166)
    const usageTiming = buildTimingInfo(store);

    // Weekly reset from config (#167)
    const nextWeeklyReset = configGetNextWeeklyReset(config);
    const weeklyMs = nextWeeklyReset.getTime() - local.getTime();

    // Work hours
    const isWorkHours = hour >= 9 && hour < 24;
    const hoursLeftToday = Math.max(0, 24 - hour);

    // Fuel burn projection from history within current session
    interface FuelProjection { burnPerHour: number; emptyInHours: number; emptyAt: string }
    let projection: FuelProjection | null = null;
    const sessionHistory = history.filter(h => h.session_percent != null);
    if (sessionHistory.length >= 2) {
      const newest = sessionHistory[0];
      const oldest = sessionHistory[sessionHistory.length > 5 ? sessionHistory.length - 1 : sessionHistory.length - 1];
      const timeDiffH = (new Date(newest.created_at).getTime() - new Date(oldest.created_at).getTime()) / 3600000;
      const burned = (oldest.session_percent ?? 0) - (newest.session_percent ?? 0);
      if (timeDiffH > 0.01 && burned > 0) {
        const rate = Math.round((burned / timeDiffH) * 10) / 10;
        const hoursUntilEmpty = (newest.session_percent ?? 0) / rate;
        projection = {
          burnPerHour: rate,
          emptyInHours: Math.round(hoursUntilEmpty * 10) / 10,
          emptyAt: new Date(local.getTime() + hoursUntilEmpty * 3600000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
        };
      }
    }

    // v4.4.4 #238 — weekly burn projection. Uses weekly_percent history across the
    // last 72h to estimate %/h weekly burn, then projects which calendar day (0..6)
    // the weekly bucket would hit zero at the current pace. Feeds a visual marker on
    // the "Week ahead" strip so users see whether pace lands before/after reset.
    interface WeeklyProjection { perDay: number; daysUntilEmpty: number | null; emptyDayIndex: number | null; runsOutBeforeReset: boolean }
    let weeklyProjection: WeeklyProjection | null = null;
    const weeklyHistory = history.filter(h => h.weekly_percent != null);
    if (weeklyHistory.length >= 2) {
      const newest = weeklyHistory[0];
      // Use samples from the last ~3 days; if fewer, take oldest available. Drop
      // samples older than 7 days to avoid letting prior-week data contaminate.
      const cutoff = local.getTime() - 3 * 86400000;
      const weekAgo = local.getTime() - 7 * 86400000;
      const recent = weeklyHistory.filter(h => {
        const t = new Date(h.created_at).getTime();
        return t > cutoff && t > weekAgo;
      });
      const window = recent.length >= 2 ? recent : weeklyHistory.filter(h => new Date(h.created_at).getTime() > weekAgo).slice(0, 10);
      if (window.length >= 2) {
        const winNewest = window[0];
        const winOldest = window[window.length - 1];
        const diffH = (new Date(winNewest.created_at).getTime() - new Date(winOldest.created_at).getTime()) / 3600000;
        const burned = (winOldest.weekly_percent ?? 0) - (winNewest.weekly_percent ?? 0);
        const remaining = newest.weekly_percent ?? 0;
        if (diffH > 0.5 && burned > 0) {
          const perHour = burned / diffH;
          const perDay = Math.round(perHour * 24 * 10) / 10;
          const daysUntilEmpty = perHour > 0 ? remaining / (perHour * 24) : null;
          // emptyDayIndex: day (0=today..6) the weekly hits 0. null if outside window.
          let emptyDayIndex: number | null = null;
          if (daysUntilEmpty != null && daysUntilEmpty >= 0 && daysUntilEmpty <= 6.99) {
            emptyDayIndex = Math.floor(daysUntilEmpty);
          }
          // Does it run out before the next Thursday 21:00 reset?
          const runsOutBeforeReset = daysUntilEmpty != null && daysUntilEmpty * 86400000 < weeklyMs;
          weeklyProjection = {
            perDay,
            daysUntilEmpty: daysUntilEmpty != null ? Math.round(daysUntilEmpty * 10) / 10 : null,
            emptyDayIndex,
            runsOutBeforeReset,
          };
        }
      }
    }

    // Calendar
    interface CalendarDay {
      date: string;
      dayOfWeek: number;
      isToday: boolean;
      isWeekend: boolean;
      isWeeklyReset: boolean;
      note: string | null;
      // v4.4.4 #238 — optional burn-rate projection markers for the week-ahead strip
      projectedWeekly?: number;     // projected weekly% remaining at end of this day
      isProjectedEmpty?: boolean;   // first day the projected line crosses 0
    }
    const calendar: CalendarDay[] = [];
    const currentWeekly = usage?.weekly_percent ?? null;
    for (let d = 0; d < 7; d++) {
      const date = new Date(local);
      date.setDate(date.getDate() + d);
      const dayOfWeek = date.getDay();
      const dateStr = date.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
      let projectedWeekly: number | undefined;
      let isProjectedEmpty = false;
      if (weeklyProjection && currentWeekly != null) {
        // Project end-of-day weekly% assuming constant daily burn. Days before the
        // weekly reset land against the current bucket; days after would reset to 100
        // — but we keep projection simple, showing only pre-reset days.
        const projected = currentWeekly - weeklyProjection.perDay * (d + 1);
        projectedWeekly = Math.max(0, Math.round(projected * 10) / 10);
        isProjectedEmpty = weeklyProjection.emptyDayIndex === d;
      }
      calendar.push({
        date: dateStr,
        dayOfWeek,
        isToday: d === 0,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isWeeklyReset: dayOfWeek === 4,
        note: dayOfWeek === 4 ? 'Weekly fuel reset 21:00' : d === 0 ? 'Current session' : null,
        projectedWeekly,
        isProjectedEmpty,
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
        timezone: config.timezone,
        hour,
        isWorkHours,
        hoursLeftToday,
      },
      fuel: usage ? {
        session: usage.session_percent,
        weekly: usage.weekly_percent,
        projection,
        weeklyProjection,
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

// getNextWeeklyReset removed — now imported from fuelConfig.ts (#169)

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
