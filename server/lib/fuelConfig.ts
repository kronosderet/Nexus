/**
 * Shared Fuel Configuration — single source of truth for all timing constants.
 *
 * Replaces hardcoded TIMEZONE, SESSION_WINDOW_HOURS, WEEKLY_RESET_DAY/HOUR
 * across usage.ts, clock.ts, estimator.ts.
 *
 * Config is persisted in store._fuelConfig so it survives restarts.
 * Users configure via nexus_log_usage (plan, timezone params).
 */

import type { NexusStore } from '../db/store.ts';
import type { FuelConfig, ClaudePlan } from '../types.ts';

// ── Plan capacity multipliers (relative to Pro baseline) ──
export const PLAN_INFO: Record<ClaudePlan, { label: string; multiplier: number; description: string }> = {
  free:           { label: 'Free',           multiplier: 0.2, description: 'Limited usage, variable windows' },
  pro:            { label: 'Pro',            multiplier: 1.0, description: '~44k tokens per 5h window' },
  max5:           { label: 'Max 5x',         multiplier: 2.0, description: '~88k tokens per 5h window' },
  max20:          { label: 'Max 20x',        multiplier: 5.0, description: '~220k tokens per 5h window' },
  team:           { label: 'Team Standard',  multiplier: 1.0, description: 'Same capacity as Pro' },
  team_premium:   { label: 'Team Premium',   multiplier: 2.0, description: 'Same capacity as Max 5x' },
  enterprise:     { label: 'Enterprise',     multiplier: 5.0, description: 'Custom capacity' },
  api:            { label: 'API',            multiplier: 0,   description: 'Pay-per-token, no windows' },
};

// ── Defaults ──────────────────────────────────────────────
const DEFAULT_CONFIG: FuelConfig = {
  plan: 'pro',
  timezone: 'Europe/Prague',
  sessionWindowHours: 5,
  weeklyResetDay: 4,   // Thursday
  weeklyResetHour: 21, // 21:00
};

// ── Accessors ─────────────────────────────────────────────
export function getFuelConfig(store: NexusStore): FuelConfig {
  return store.getFuelConfig() || DEFAULT_CONFIG;
}

export function setFuelConfig(store: NexusStore, updates: Partial<FuelConfig>): FuelConfig {
  const current = getFuelConfig(store);
  const merged = { ...current, ...updates };
  store.setFuelConfig(merged);
  return merged;
}

// ── Timing helpers (use config, not hardcodes) ────────────
export function nowInTZ(config: FuelConfig): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: config.timezone }));
}

export function getNextWeeklyReset(config: FuelConfig): Date {
  const now = nowInTZ(config);
  const target = new Date(now);
  target.setHours(config.weeklyResetHour, 0, 0, 0);

  // Find next occurrence of weeklyResetDay
  const daysUntil = (config.weeklyResetDay - target.getDay() + 7) % 7;
  if (daysUntil === 0 && now >= target) {
    target.setDate(target.getDate() + 7); // Already passed today
  } else {
    target.setDate(target.getDate() + daysUntil);
  }
  return target;
}

/**
 * Compute the 5h session slot grid and find the next reset.
 * Session windows are fixed 5h slots on a 24h grid, same every day.
 * Given a known reset time (from user), we derive the full grid.
 */
export function getSessionSlots(config: FuelConfig, knownResetTime?: string): string[] {
  // If we have a known reset time, derive the grid from it
  if (knownResetTime) {
    const reset = new Date(knownResetTime);
    const resetHour = reset.getHours();
    const resetMin = reset.getMinutes();
    const slots: string[] = [];
    for (let i = 0; i < 5; i++) {
      const h = (resetHour + i * config.sessionWindowHours) % 24;
      slots.push(`${String(h).padStart(2, '0')}:${String(resetMin).padStart(2, '0')}`);
    }
    return slots.sort();
  }
  // Default: assume slots at 01:00, 06:00, 11:00, 16:00, 21:00
  return ['01:00', '06:00', '11:00', '16:00', '21:00'];
}

/**
 * Get the session window start time for a given timestamp.
 * Uses the fixed 5h grid — every timestamp belongs to exactly one window.
 * Returns the window start as ISO string for grouping.
 */
export function getSessionWindow(timestamp: string | Date, config: FuelConfig): string {
  const date = new Date(timestamp);
  // Convert to timezone-local
  const local = new Date(date.toLocaleString('en-US', { timeZone: config.timezone }));
  const hour = local.getHours();
  const windowH = config.sessionWindowHours || 5;

  // Slot boundaries: 0h windows starting at 01, 06, 11, 16, 21 (for 5h grid)
  // Find which slot this hour falls into
  // Slots start at: 1, 6, 11, 16, 21 (for default grid)
  const slotStarts = [];
  for (let h = 1; h < 24; h += windowH) slotStarts.push(h);
  // Handle wraparound: 21:00-01:00 window
  let slotStart = slotStarts[0];
  for (const s of slotStarts) {
    if (hour >= s) slotStart = s;
  }
  // Edge case: hour 0 belongs to the previous day's last slot (21:00-01:00)
  if (hour < slotStarts[0]) slotStart = slotStarts[slotStarts.length - 1];

  // Build the window start timestamp
  const windowDate = new Date(local);
  windowDate.setHours(slotStart, 0, 0, 0);
  // If hour < first slot, the window started yesterday
  if (hour < slotStarts[0]) windowDate.setDate(windowDate.getDate() - 1);

  return windowDate.toISOString();
}

/**
 * Group usage entries by their 5h session windows.
 * Returns arrays of entries per window, sorted chronologically within each.
 */
export function groupBySessionWindow(usage: any[], config: FuelConfig): Array<{ windowStart: string; entries: any[] }> {
  const groups: Record<string, any[]> = {};
  for (const u of usage) {
    const window = getSessionWindow(u.created_at, config);
    if (!groups[window]) groups[window] = [];
    groups[window].push(u);
  }
  return Object.entries(groups)
    .map(([windowStart, entries]) => ({
      windowStart,
      entries: entries.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    }))
    .sort((a, b) => new Date(b.windowStart).getTime() - new Date(a.windowStart).getTime()); // newest first
}
