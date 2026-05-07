/**
 * Tests for v4.7.4 #240 — Today fusion view derivation logic.
 *
 * The component lives at client/src/modules/command/TodayView.jsx but is a
 * thin renderer over deriveTodayState() in client/src/lib/todayView.js.
 * These specs cover the derivation in node-only Vitest (no jsdom required).
 */
import { describe, it, expect } from 'vitest';
import {
  formatTimeAgo,
  fuelPressure,
  formatRunway,
  topRisk,
  deriveTodayState,
} from '../client/src/lib/todayView.js';

// Anchor "now" so every test is deterministic regardless of clock drift.
const NOW = new Date('2026-05-07T12:00:00Z').getTime();

// ──────────────────────────────────────────────────────────
// formatTimeAgo
// ──────────────────────────────────────────────────────────

describe('formatTimeAgo', () => {
  it('returns "—" for null/invalid input', () => {
    expect(formatTimeAgo(null, NOW)).toBe('—');
    expect(formatTimeAgo(undefined, NOW)).toBe('—');
    expect(formatTimeAgo('not a date', NOW)).toBe('—');
  });

  it('returns "just now" for events within the last minute', () => {
    expect(formatTimeAgo(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now');
    expect(formatTimeAgo(new Date(NOW + 30_000).toISOString(), NOW)).toBe('just now'); // future drift
  });

  it('returns Nm for sub-hour ages', () => {
    expect(formatTimeAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m');
    expect(formatTimeAgo(new Date(NOW - 59 * 60_000).toISOString(), NOW)).toBe('59m');
  });

  it('returns Nh for sub-day ages', () => {
    expect(formatTimeAgo(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toBe('3h');
    expect(formatTimeAgo(new Date(NOW - 23 * 3600_000).toISOString(), NOW)).toBe('23h');
  });

  it('returns Nd for older ages', () => {
    expect(formatTimeAgo(new Date(NOW - 2 * 86400_000).toISOString(), NOW)).toBe('2d');
    expect(formatTimeAgo(new Date(NOW - 30 * 86400_000).toISOString(), NOW)).toBe('30d');
  });
});

// ──────────────────────────────────────────────────────────
// fuelPressure
// ──────────────────────────────────────────────────────────

describe('fuelPressure', () => {
  it('returns null for missing values', () => {
    expect(fuelPressure(null)).toBe(null);
    expect(fuelPressure(undefined)).toBe(null);
  });

  it('marks ≤15% as critical', () => {
    expect(fuelPressure(15)).toBe('critical');
    expect(fuelPressure(5)).toBe('critical');
    expect(fuelPressure(0)).toBe('critical');
  });

  it('marks 16–40% as low', () => {
    expect(fuelPressure(16)).toBe('low');
    expect(fuelPressure(30)).toBe('low');
    expect(fuelPressure(40)).toBe('low');
  });

  it('marks >40% as normal', () => {
    expect(fuelPressure(41)).toBe('normal');
    expect(fuelPressure(70)).toBe('normal');
    expect(fuelPressure(100)).toBe('normal');
  });
});

// ──────────────────────────────────────────────────────────
// formatRunway
// ──────────────────────────────────────────────────────────

describe('formatRunway', () => {
  it('returns null when minutes are missing', () => {
    expect(formatRunway(null)).toBe(null);
    expect(formatRunway(undefined)).toBe(null);
  });

  it('formats sub-minute ranges as <1m', () => {
    expect(formatRunway(0.5)).toBe('<1m');
    expect(formatRunway(0)).toBe('<1m');
  });

  it('formats sub-hour as Nm', () => {
    expect(formatRunway(45)).toBe('45m');
    expect(formatRunway(59)).toBe('59m');
  });

  it('formats sub-day as Nh (whole) or N.Nh (fractional)', () => {
    expect(formatRunway(60)).toBe('1h');
    expect(formatRunway(120)).toBe('2h');
    expect(formatRunway(90)).toBe('1.5h');
  });

  it('formats day-plus as Nd', () => {
    expect(formatRunway(24 * 60)).toBe('1d');
    expect(formatRunway(72 * 60)).toBe('3d');
  });
});

// ──────────────────────────────────────────────────────────
// topRisk
// ──────────────────────────────────────────────────────────

describe('topRisk', () => {
  it('returns null for empty/missing input', () => {
    expect(topRisk([])).toBe(null);
    expect(topRisk(null)).toBe(null);
    expect(topRisk(undefined)).toBe(null);
  });

  it('picks critical over warning over info', () => {
    const risks = [
      { level: 'info', message: 'i' },
      { level: 'warning', message: 'w' },
      { level: 'critical', message: 'c' },
    ];
    expect(topRisk(risks).message).toBe('c');
  });

  it('ties broken by first-encountered (earlier in array)', () => {
    const risks = [
      { level: 'warning', message: 'first warn' },
      { level: 'warning', message: 'second warn' },
    ];
    expect(topRisk(risks).message).toBe('first warn');
  });

  it('handles unknown levels gracefully (treated as 0)', () => {
    const risks = [
      { level: 'unknown', message: 'mystery' },
      { level: 'warning', message: 'real' },
    ];
    expect(topRisk(risks).message).toBe('real');
  });
});

// ──────────────────────────────────────────────────────────
// deriveTodayState — full integration of the four signals
// ──────────────────────────────────────────────────────────

describe('deriveTodayState', () => {
  it('handles a fully-empty workspace', () => {
    const state = deriveTodayState({ now: NOW });
    expect(state.fuel.session).toBe(null);
    expect(state.fuel.weekly).toBe(null);
    expect(state.fuel.runwayMinutes).toBe(null);
    expect(state.fuel.pressure).toBe(null);
    expect(state.now.task).toBe(null);
    expect(state.now.label).toBe('Idle');
    expect(state.now.extraCount).toBe(0);
    expect(state.pulse).toEqual([]);
    expect(state.signal.kind).toBe('clear');
    expect(state.signal.message).toBe('Calm waters.');
    expect(state.signal.extraCount).toBe(0);
  });

  it('prefers estimated fuel over reported when both exist', () => {
    const state = deriveTodayState({
      now: NOW,
      fuel: {
        reported: { session: 80, weekly: 70 },
        estimated: { session: 65, weekly: 55 },
        session: { minutesRemaining: 184 },
      },
    });
    expect(state.fuel.session).toBe(65);
    expect(state.fuel.weekly).toBe(55);
    expect(state.fuel.runwayMinutes).toBe(184);
    expect(state.fuel.runwayLabel).toBe('3.1h');
    expect(state.fuel.pressure).toBe('normal');
  });

  it('falls back to reported when estimated missing, marks low pressure', () => {
    const state = deriveTodayState({
      now: NOW,
      fuel: { reported: { session: 25, weekly: 30 } },
    });
    expect(state.fuel.session).toBe(25);
    expect(state.fuel.pressure).toBe('low');
  });

  it('flags critical fuel pressure', () => {
    const state = deriveTodayState({
      now: NOW,
      fuel: { reported: { session: 8, weekly: 15 } },
    });
    expect(state.fuel.pressure).toBe('critical');
  });

  it('selects most-recently-touched in-progress task as lead, counts the rest', () => {
    const inProgress = [
      { id: 1, title: 'Old task', updated_at: new Date(NOW - 4 * 3600_000).toISOString() },
      { id: 2, title: 'Recent task', updated_at: new Date(NOW - 30 * 60_000).toISOString(), project: 'Nexus' },
      { id: 3, title: 'Older still', updated_at: new Date(NOW - 6 * 3600_000).toISOString() },
    ];
    const state = deriveTodayState({ now: NOW, inProgress });
    expect(state.now.label).toBe('In progress');
    expect(state.now.task.id).toBe(2);
    expect(state.now.task.title).toBe('Recent task');
    expect(state.now.task.project).toBe('Nexus');
    expect(state.now.task.elapsedMinutes).toBe(30);
    expect(state.now.extraCount).toBe(2);
  });

  it('formats top 3 activity entries with relative times', () => {
    const recentActivity = [
      { id: 10, type: 'task', message: 'Plotted #75', created_at: new Date(NOW - 5 * 60_000).toISOString() },
      { id: 9, type: 'session', message: 'Session logged', created_at: new Date(NOW - 2 * 3600_000).toISOString() },
      { id: 8, type: 'deploy', message: 'Shipped v4.7.3', created_at: new Date(NOW - 1 * 86400_000).toISOString() },
      { id: 7, type: 'system', message: 'Should not appear (cap=3)', created_at: new Date(NOW - 5 * 86400_000).toISOString() },
    ];
    const state = deriveTodayState({ now: NOW, recentActivity });
    expect(state.pulse).toHaveLength(3);
    expect(state.pulse[0].ago).toBe('5m');
    expect(state.pulse[1].ago).toBe('2h');
    expect(state.pulse[2].ago).toBe('1d');
    expect(state.pulse[2].message).toContain('v4.7.3');
  });

  it('surfaces top critical risk and counts the rest', () => {
    const risks = [
      { level: 'warning', category: 'stale', message: 'Repo cold' },
      { level: 'critical', category: 'fuel', message: 'Weekly fuel at 12%' },
      { level: 'info', category: 'stuck', message: 'Task #75 stuck' },
    ];
    const state = deriveTodayState({ now: NOW, risks });
    expect(state.signal.kind).toBe('critical');
    expect(state.signal.message).toContain('Weekly fuel');
    expect(state.signal.category).toBe('fuel');
    expect(state.signal.extraCount).toBe(2);
  });

  it('handles all four signals together', () => {
    const state = deriveTodayState({
      now: NOW,
      fuel: { estimated: { session: 75, weekly: 60 }, session: { minutesRemaining: 120 } },
      inProgress: [
        { id: 1, title: 'Active feature', updated_at: new Date(NOW - 15 * 60_000).toISOString() },
      ],
      recentActivity: [
        { id: 100, type: 'feature', message: 'Built TodayView', created_at: new Date(NOW - 60_000).toISOString() },
      ],
      risks: [{ level: 'warning', message: 'Uncommitted drift' }],
    });
    expect(state.fuel.runwayLabel).toBe('2h');
    expect(state.now.task.title).toBe('Active feature');
    expect(state.now.task.elapsedMinutes).toBe(15);
    expect(state.pulse[0].ago).toBe('1m');
    expect(state.signal.kind).toBe('warning');
  });

  it('Idle state still produces calm-waters signal when no risks', () => {
    const state = deriveTodayState({
      now: NOW,
      fuel: { estimated: { session: 90 } },
      inProgress: [],
      recentActivity: [],
      risks: [],
    });
    expect(state.now.label).toBe('Idle');
    expect(state.signal.kind).toBe('clear');
    expect(state.signal.message).toBe('Calm waters.');
  });
});
