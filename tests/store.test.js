import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, 'test-nexus.json');

// Create a minimal test store (same logic as NexusStore but with custom path)
class TestStore {
  constructor() {
    this.data = {
      tasks: [], activity: [], sessions: [], usage: [],
      gpu_history: [], scratchpads: [], bookmarks: [], ledger: [],
    };
    this._nextId = { tasks: 1, activity: 1, sessions: 1, scratchpads: 1, bookmarks: 1 };
  }
  _id(table) { return this._nextId[table]++; }
  _now() { return new Date().toISOString(); }
  _flush() {} // no-op for tests

  logUsage({ session_percent, weekly_percent, note = '' }) {
    const entry = { session_percent, weekly_percent, note, created_at: this._now() };
    this.data.usage.push(entry);
    return entry;
  }
  getUsage(limit = 100) {
    return [...this.data.usage].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }
  getLatestUsage() {
    return this.data.usage.length > 0 ? this.data.usage[this.data.usage.length - 1] : null;
  }
  getAllTasks() { return [...this.data.tasks]; }
  getSessions(opts = {}) { return [...this.data.sessions]; }
  getActivity(limit) { return [...this.data.activity].slice(0, limit); }
  getLedger(opts = {}) { return [...this.data.ledger]; }

  recordDecision({ decision, context = '', project = 'general', alternatives = [], tags = [] }) {
    const entry = {
      id: (this.data.ledger.length > 0 ? Math.max(...this.data.ledger.map(e => e.id)) : 0) + 1,
      decision, context, project, alternatives, tags, created_at: this._now(),
    };
    this.data.ledger.push(entry);
    return entry;
  }

  createTask({ title, status = 'backlog' }) {
    const task = { id: this._id('tasks'), title, description: '', status, sort_order: 0, created_at: this._now(), updated_at: this._now() };
    this.data.tasks.push(task);
    return task;
  }
}

describe('NexusStore', () => {
  let store;
  beforeEach(() => { store = new TestStore(); });

  describe('Usage tracking', () => {
    it('logs usage data points', () => {
      store.logUsage({ session_percent: 90, weekly_percent: 50 });
      store.logUsage({ session_percent: 80, weekly_percent: 48 });
      expect(store.getUsage().length).toBe(2);
    });

    it('returns latest usage', () => {
      store.logUsage({ session_percent: 90, weekly_percent: 50 });
      store.logUsage({ session_percent: 75, weekly_percent: 45 });
      const latest = store.getLatestUsage();
      expect(latest.session_percent).toBe(75);
      expect(latest.weekly_percent).toBe(45);
    });

    it('returns null when no usage logged', () => {
      expect(store.getLatestUsage()).toBeNull();
    });

    it('respects limit on getUsage', () => {
      for (let i = 0; i < 10; i++) store.logUsage({ session_percent: 100 - i * 5, weekly_percent: 50 });
      expect(store.getUsage(3).length).toBe(3);
    });

    it('returns usage sorted newest first', () => {
      // Manually set timestamps to ensure ordering
      const e1 = store.logUsage({ session_percent: 90, weekly_percent: 50 });
      e1.created_at = '2026-04-06T10:00:00.000Z';
      const e2 = store.logUsage({ session_percent: 80, weekly_percent: 48 });
      e2.created_at = '2026-04-06T11:00:00.000Z';
      const usage = store.getUsage();
      expect(usage[0].session_percent).toBe(80); // newer first
      expect(usage[1].session_percent).toBe(90);
    });
  });

  describe('Tasks', () => {
    it('creates tasks with auto-increment IDs', () => {
      const t1 = store.createTask({ title: 'Task 1' });
      const t2 = store.createTask({ title: 'Task 2' });
      expect(t1.id).toBe(1);
      expect(t2.id).toBe(2);
    });

    it('defaults to backlog status', () => {
      const t = store.createTask({ title: 'Test' });
      expect(t.status).toBe('backlog');
    });
  });

  describe('Ledger', () => {
    it('records decisions with context and alternatives', () => {
      const d = store.recordDecision({
        decision: 'Use JSON over SQLite',
        context: 'No C++ build tools available',
        project: 'Nexus',
        alternatives: ['SQLite', 'LevelDB'],
        tags: ['architecture'],
      });
      expect(d.id).toBe(1);
      expect(d.decision).toBe('Use JSON over SQLite');
      expect(d.alternatives).toEqual(['SQLite', 'LevelDB']);
    });

    it('auto-increments decision IDs', () => {
      store.recordDecision({ decision: 'First' });
      store.recordDecision({ decision: 'Second' });
      const ledger = store.getLedger();
      expect(ledger.length).toBe(2);
      expect(ledger[0].id).toBe(1);
      expect(ledger[1].id).toBe(2);
    });

    it('records decisions with project attribution', () => {
      store.recordDecision({ decision: 'Use Godot', project: 'Firewall-Godot' });
      store.recordDecision({ decision: 'Use Express', project: 'Nexus' });
      const ledger = store.getLedger();
      expect(ledger[0].project).toBe('Firewall-Godot');
    });
  });
});
