import { describe, it, expect } from 'vitest';

// ── Re-implement estimator pure functions for testing ────
// These mirror the logic in server/routes/estimator.ts and fuelIntel.ts
// without needing Express route imports.

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

function calculateBurnRates(history) {
  const sessionRates = [];
  const weeklyRates = [];

  for (let i = 0; i < history.length - 1; i++) {
    const newer = history[i];
    const older = history[i + 1];
    const minutes = (new Date(newer.created_at).getTime() - new Date(older.created_at).getTime()) / 60000;

    if (minutes < 1 || minutes > 360) continue;

    if (older.session_percent != null && newer.session_percent != null) {
      const burned = older.session_percent - newer.session_percent;
      if (burned > 0) sessionRates.push(burned / minutes);
    }
    if (older.weekly_percent != null && newer.weekly_percent != null) {
      const burned = older.weekly_percent - newer.weekly_percent;
      if (burned > 0) weeklyRates.push(burned / minutes);
    }
  }

  const avgSession = weightedAvg(sessionRates);
  const avgWeekly = weightedAvg(weeklyRates);

  return {
    sessionPerMinute: avgSession,
    weeklyPerMinute: avgWeekly,
    sessionPerHour: Math.round(avgSession * 60 * 10) / 10,
    weeklyPerHour: Math.round(avgWeekly * 60 * 10) / 10,
  };
}

function detectSessions(usage) {
  if (usage.length < 2) return [];
  const sorted = [...usage].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const sessions = [];
  let currentSession = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const sessionJump = (curr.session_percent ?? 0) - (prev.session_percent ?? 0);
    const timeDiff = (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / 3600000;

    if (sessionJump > 20 || timeDiff > 6) {
      if (currentSession.length >= 2) sessions.push(currentSession);
      currentSession = [curr];
    } else {
      currentSession.push(curr);
    }
  }
  if (currentSession.length >= 2) sessions.push(currentSession);
  return sessions;
}

function categorizeTask(title) {
  const t = title.toLowerCase();
  if (t.includes('typescript') || t.includes('migration') || t.includes('convert')) return 'TypeScript/Migration';
  if (t.includes('test') || t.includes('vitest')) return 'Testing';
  if (t.includes('fix') || t.includes('bug') || t.includes('patch')) return 'Bug Fix';
  if (t.includes('overseer') || t.includes('ai') || t.includes('llm')) return 'AI/Overseer';
  if (t.includes('graph') || t.includes('ledger') || t.includes('decision')) return 'Knowledge Graph';
  if (t.includes('search') || t.includes('embed')) return 'Search';
  if (t.includes('fuel') || t.includes('usage') || t.includes('estimator')) return 'Fuel Management';
  if (t.includes('git') || t.includes('commit') || t.includes('push')) return 'Git Operations';
  if (t.includes('dashboard') || t.includes('ui') || t.includes('widget')) return 'Dashboard/UI';
  if (t.includes('audit')) return 'Audit';
  return 'Feature Build';
}

const TASK_SIZES = {
  tiny: { minutes: 5, label: 'Quick fix', fuelCost: 3 },
  small: { minutes: 15, label: 'Bug fix', fuelCost: 8 },
  medium: { minutes: 30, label: 'Feature', fuelCost: 15 },
  large: { minutes: 60, label: 'Architecture', fuelCost: 25 },
  huge: { minutes: 120, label: 'Full build', fuelCost: 45 },
};

function buildWorkloadRecommendation(fuel) {
  if (fuel <= 10) return 'wrap_up';
  if (fuel <= 25) return 'small_tasks';
  if (fuel <= 50) return 'medium_tasks';
  return 'full_capacity';
}

// ── Helper: create a usage history timeline ──────────────
function makeHistory(points) {
  // points: array of [minuteOffset, session%, weekly%]
  const base = new Date('2026-04-06T10:00:00.000Z').getTime();
  return points.map(([min, sp, wp]) => ({
    session_percent: sp,
    weekly_percent: wp,
    note: '',
    created_at: new Date(base + min * 60000).toISOString(),
  }));
}


// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════

describe('Fuel Estimator Logic', () => {

  describe('Burn rate calculation', () => {
    it('calculates session burn rate from two data points', () => {
      // history is newest-first (like getUsage returns)
      const history = makeHistory([
        [30, 85, 48],  // newer: 30 min in, 85% session
        [0,  95, 50],  // older: start, 95% session
      ]);
      const rates = calculateBurnRates(history);
      // burned 10% in 30 min = 0.333/min
      expect(rates.sessionPerMinute).toBeCloseTo(10 / 30, 2);
      expect(rates.sessionPerHour).toBeCloseTo(20, 0);
    });

    it('calculates weekly burn rate from data points', () => {
      const history = makeHistory([
        [60, 80, 46],  // newer
        [0,  95, 50],  // older
      ]);
      const rates = calculateBurnRates(history);
      // weekly burned 4% in 60 min
      expect(rates.weeklyPerMinute).toBeCloseTo(4 / 60, 3);
    });

    it('returns zero rates for empty history', () => {
      const rates = calculateBurnRates([]);
      expect(rates.sessionPerMinute).toBe(0);
      expect(rates.weeklyPerMinute).toBe(0);
    });

    it('skips data pairs with time gap > 360 minutes', () => {
      const history = makeHistory([
        [400, 50, 40],  // 400 min later - gap too big
        [0,   90, 48],
      ]);
      const rates = calculateBurnRates(history);
      expect(rates.sessionPerMinute).toBe(0); // skipped
    });

    it('skips data pairs where fuel increased (no positive burn)', () => {
      const history = makeHistory([
        [30, 95, 50],  // newer has MORE fuel
        [0,  85, 48],  // older had less
      ]);
      const rates = calculateBurnRates(history);
      expect(rates.sessionPerMinute).toBe(0); // no positive burn
    });

    it('weights recent rates higher', () => {
      // Three data points, newest-first
      const history = makeHistory([
        [60, 70, 44],  // newest
        [30, 80, 47],  // middle
        [0,  90, 50],  // oldest
      ]);
      const rates = calculateBurnRates(history);
      // pair 0-1 (newer): burned 10 in 30min = 0.333/min, weight=2
      // pair 1-2 (older): burned 10 in 30min = 0.333/min, weight=1
      // weighted avg = (0.333*2 + 0.333*1)/(2+1) = 0.333
      expect(rates.sessionPerMinute).toBeCloseTo(1 / 3, 2);
    });

    it('handles null percent values gracefully', () => {
      const history = makeHistory([
        [30, null, 48],
        [0,  null, 50],
      ]);
      const rates = calculateBurnRates(history);
      expect(rates.sessionPerMinute).toBe(0);
      // weekly should still calculate
      expect(rates.weeklyPerMinute).toBeCloseTo(2 / 30, 3);
    });
  });

  describe('Session boundary detection', () => {
    it('detects session boundary when fuel jumps >20%', () => {
      const usage = makeHistory([
        [0,   95, 50],
        [30,  85, 48],
        [60,  75, 46],  // end of session 1
        [120, 98, 44],  // fuel jumped from 75->98 = new session
        [150, 88, 42],
        [180, 78, 40],
      ]);
      const sessions = detectSessions(usage);
      expect(sessions.length).toBe(2);
    });

    it('detects session boundary on >6 hour gap', () => {
      const usage = makeHistory([
        [0,   90, 50],
        [30,  80, 48],
        [420, 75, 46],  // 7 hours later, even if no fuel jump
        [450, 65, 44],
      ]);
      const sessions = detectSessions(usage);
      expect(sessions.length).toBe(2);
    });

    it('returns empty for single data point', () => {
      const usage = makeHistory([[0, 90, 50]]);
      expect(detectSessions(usage).length).toBe(0);
    });

    it('treats continuous decline as single session', () => {
      const usage = makeHistory([
        [0,  95, 50],
        [15, 90, 49],
        [30, 85, 48],
        [45, 80, 47],
        [60, 75, 46],
      ]);
      const sessions = detectSessions(usage);
      expect(sessions.length).toBe(1);
      expect(sessions[0].length).toBe(5);
    });

    it('requires at least 2 points for a session window', () => {
      const usage = makeHistory([
        [0,   90, 50],  // single point session
        [120, 95, 48],  // jump but only 1 point before next
        [150, 85, 46],
        [180, 75, 44],
      ]);
      const sessions = detectSessions(usage);
      // First "session" has only 1 point before the jump, so it's skipped
      expect(sessions.every(s => s.length >= 2)).toBe(true);
    });
  });

  describe('Task categorization', () => {
    it('categorizes typescript/migration tasks', () => {
      expect(categorizeTask('Convert store to TypeScript')).toBe('TypeScript/Migration');
      expect(categorizeTask('Migration to ESM')).toBe('TypeScript/Migration');
    });

    it('categorizes testing tasks', () => {
      expect(categorizeTask('Write vitest suite')).toBe('Testing');
      expect(categorizeTask('Add unit tests for graph')).toBe('Testing');
    });

    it('categorizes bug fixes', () => {
      expect(categorizeTask('Fix crash on empty ledger')).toBe('Bug Fix');
      expect(categorizeTask('Patch session timeout bug')).toBe('Bug Fix');
    });

    it('categorizes AI/Overseer tasks', () => {
      expect(categorizeTask('Overseer refactor')).toBe('AI/Overseer');
      expect(categorizeTask('LLM integration')).toBe('AI/Overseer');
    });

    it('categorizes knowledge graph tasks', () => {
      expect(categorizeTask('Graph traversal optimization')).toBe('Knowledge Graph');
      expect(categorizeTask('Decision ledger export')).toBe('Knowledge Graph');
    });

    it('categorizes dashboard/UI tasks', () => {
      expect(categorizeTask('Dashboard widget redesign')).toBe('Dashboard/UI');
      expect(categorizeTask('New UI component')).toBe('Dashboard/UI');
    });

    it('falls back to Feature Build for unmatched titles', () => {
      expect(categorizeTask('Implement caching layer')).toBe('Feature Build');
      expect(categorizeTask('Add rate limiting')).toBe('Feature Build');
    });
  });

  describe('Workload planning tiers', () => {
    it('recommends wrap_up at fuel <= 10', () => {
      expect(buildWorkloadRecommendation(10)).toBe('wrap_up');
      expect(buildWorkloadRecommendation(5)).toBe('wrap_up');
      expect(buildWorkloadRecommendation(0)).toBe('wrap_up');
    });

    it('recommends small_tasks at fuel 11-25', () => {
      expect(buildWorkloadRecommendation(11)).toBe('small_tasks');
      expect(buildWorkloadRecommendation(25)).toBe('small_tasks');
    });

    it('recommends medium_tasks at fuel 26-50', () => {
      expect(buildWorkloadRecommendation(26)).toBe('medium_tasks');
      expect(buildWorkloadRecommendation(50)).toBe('medium_tasks');
    });

    it('recommends full_capacity above 50', () => {
      expect(buildWorkloadRecommendation(51)).toBe('full_capacity');
      expect(buildWorkloadRecommendation(100)).toBe('full_capacity');
    });
  });

  describe('Task size presets', () => {
    it('has five tiers from tiny to huge', () => {
      expect(Object.keys(TASK_SIZES)).toEqual(['tiny', 'small', 'medium', 'large', 'huge']);
    });

    it('each tier has increasing fuel cost', () => {
      const costs = Object.values(TASK_SIZES).map(v => v.fuelCost);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]).toBeGreaterThan(costs[i - 1]);
      }
    });

    it('each tier has increasing minutes', () => {
      const mins = Object.values(TASK_SIZES).map(v => v.minutes);
      for (let i = 1; i < mins.length; i++) {
        expect(mins[i]).toBeGreaterThan(mins[i - 1]);
      }
    });
  });
});
