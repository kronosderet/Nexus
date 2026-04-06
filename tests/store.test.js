import { describe, it, expect, beforeEach } from 'vitest';

// ── TestStore: mirrors NexusStore logic, no file I/O ────────────────────
class TestStore {
  constructor() {
    this.data = {
      tasks: [], activity: [], sessions: [], usage: [],
      gpu_history: [], scratchpads: [], bookmarks: [], ledger: [],
      graph_edges: [],
    };
    this._nextId = { tasks: 1, activity: 1, sessions: 1, scratchpads: 1, bookmarks: 1 };
  }
  _id(table) { return this._nextId[table]++; }
  _now() { return new Date().toISOString(); }
  _flush() {} // no-op for tests

  // ── Tasks ─────────────────────────────────────────────
  getAllTasks() {
    return [...this.data.tasks].sort((a, b) => a.sort_order - b.sort_order);
  }

  createTask({ title, description = '', status = 'backlog', priority = 0 }) {
    const maxOrder = this.data.tasks.filter(t => t.status === status).reduce((max, t) => Math.max(max, t.sort_order), 0);
    const task = {
      id: this._id('tasks'), title, description, status, priority,
      sort_order: maxOrder + 1, linked_files: '[]',
      created_at: this._now(), updated_at: this._now(),
    };
    this.data.tasks.push(task);
    return task;
  }

  updateTask(id, updates) {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const old = { ...this.data.tasks[idx] };
    this.data.tasks[idx] = { ...old, ...updates, id, updated_at: this._now() };
    return { task: this.data.tasks[idx], old };
  }

  deleteTask(id) {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    return this.data.tasks.splice(idx, 1)[0];
  }

  // ── Activity ──────────────────────────────────────────
  getActivity(limit = 50) {
    return [...this.data.activity]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  addActivity(type, message, meta = {}) {
    const entry = {
      id: this._id('activity'), type, message,
      meta: JSON.stringify(meta), created_at: this._now(),
    };
    this.data.activity.push(entry);
    if (this.data.activity.length > 500) this.data.activity = this.data.activity.slice(-500);
    return entry;
  }

  // ── Sessions ──────────────────────────────────────────
  getSessions({ project, limit = 20 } = {}) {
    let sessions = [...this.data.sessions];
    if (project) sessions = sessions.filter(s => s.project.toLowerCase() === project.toLowerCase());
    return sessions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }

  getSession(id) {
    return this.data.sessions.find(s => s.id === id) || null;
  }

  createSession({ project, summary, decisions = [], blockers = [], files_touched = [], tags = [] }) {
    const session = {
      id: this._id('sessions'), project, summary, decisions, blockers,
      files_touched, tags, created_at: this._now(),
    };
    this.data.sessions.push(session);
    return session;
  }

  getSessionContext(project, limit = 5) {
    const sessions = this.getSessions({ project, limit });
    const tasks = this.data.tasks.filter(t => t.status !== 'done' && t.title.toLowerCase().includes(project.toLowerCase()));
    return { sessions, activeTasks: tasks };
  }

  // ── Scratchpads ───────────────────────────────────────
  getAllScratchpads() {
    return [...this.data.scratchpads].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  getScratchpad(id) {
    return this.data.scratchpads.find(s => s.id === id) || null;
  }

  createScratchpad({ name, content = '', language = 'markdown' }) {
    const pad = { id: this._id('scratchpads'), name, content, language, updated_at: this._now() };
    this.data.scratchpads.push(pad);
    return pad;
  }

  updateScratchpad(id, updates) {
    const idx = this.data.scratchpads.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this.data.scratchpads[idx] = { ...this.data.scratchpads[idx], ...updates, id, updated_at: this._now() };
    return this.data.scratchpads[idx];
  }

  deleteScratchpad(id) {
    const idx = this.data.scratchpads.findIndex(s => s.id === id);
    if (idx === -1) return null;
    return this.data.scratchpads.splice(idx, 1)[0];
  }

  // ── Usage ─────────────────────────────────────────────
  logUsage({ session_percent, weekly_percent, note = '' }) {
    const entry = { session_percent, weekly_percent, note, created_at: this._now() };
    this.data.usage.push(entry);
    // 30-day retention
    const cutoff = Date.now() - 30 * 86400000;
    this.data.usage = this.data.usage.filter(u => new Date(u.created_at).getTime() > cutoff);
    return entry;
  }

  getUsage(limit = 100) {
    return [...this.data.usage]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  getLatestUsage() {
    return this.data.usage.length > 0 ? this.data.usage[this.data.usage.length - 1] : null;
  }

  // ── GPU History ───────────────────────────────────────
  logGpuSnapshot(snapshot) {
    this.data.gpu_history.push({ ...snapshot, created_at: this._now() });
    const cutoff = Date.now() - 24 * 3600000;
    this.data.gpu_history = this.data.gpu_history.filter(g => new Date(g.created_at).getTime() > cutoff);
  }

  getGpuHistory(hours = 1) {
    const cutoff = Date.now() - hours * 3600000;
    return this.data.gpu_history.filter(g => new Date(g.created_at).getTime() > cutoff);
  }

  // ── Ledger ────────────────────────────────────────────
  getLedger({ project, tag, limit = 50 } = {}) {
    let entries = [...this.data.ledger];
    if (project) entries = entries.filter(e => e.project.toLowerCase() === project.toLowerCase());
    if (tag) entries = entries.filter(e => (e.tags || []).includes(tag));
    return entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }

  recordDecision({ decision, context = '', project = 'general', alternatives = [], tags = [] }) {
    if (!this.data.ledger) this.data.ledger = [];
    const entry = {
      id: (this.data.ledger.length > 0 ? Math.max(...this.data.ledger.map(e => e.id)) : 0) + 1,
      decision, context, project, alternatives, tags, created_at: this._now(),
    };
    this.data.ledger.push(entry);
    return entry;
  }

  // ── Knowledge Graph ───────────────────────────────────
  addEdge(fromId, toId, relationship = 'related', note = '') {
    const exists = this.data.graph_edges.find(e => e.from === fromId && e.to === toId && e.rel === relationship);
    if (exists) return exists;
    const edge = { id: this.data.graph_edges.length + 1, from: fromId, to: toId, rel: relationship, note, created_at: this._now() };
    this.data.graph_edges.push(edge);
    return edge;
  }

  removeEdge(id) {
    const idx = this.data.graph_edges.findIndex(e => e.id === id);
    if (idx === -1) return null;
    return this.data.graph_edges.splice(idx, 1)[0];
  }

  getEdgesFrom(id) { return this.data.graph_edges.filter(e => e.from === id); }
  getEdgesTo(id) { return this.data.graph_edges.filter(e => e.to === id); }
  getEdgesFor(id) { return this.data.graph_edges.filter(e => e.from === id || e.to === id); }

  traverse(startId, maxDepth = 3) {
    const visited = new Set();
    const result = [];
    const queue = [{ id: startId, depth: 0, path: [] }];
    while (queue.length > 0) {
      const { id, depth, path } = queue.shift();
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      const decision = this.data.ledger.find(d => d.id === id);
      if (decision) result.push({ ...decision, depth, path });
      for (const edge of this.getEdgesFor(id)) {
        const nextId = edge.from === id ? edge.to : edge.from;
        if (!visited.has(nextId)) queue.push({ id: nextId, depth: depth + 1, path: [...path, { edge: edge.rel, from: id, to: nextId }] });
      }
    }
    return result;
  }

  getGraph() {
    return {
      nodes: this.data.ledger.map(d => ({ id: d.id, label: d.decision.slice(0, 50), project: d.project, tags: d.tags || [] })),
      edges: this.data.graph_edges.map(e => ({ id: e.id, from: e.from, to: e.to, rel: e.rel, note: e.note })),
    };
  }

  // ── Search ────────────────────────────────────────────
  search(query, limit = 30) {
    const q = query.toLowerCase();
    const results = [];

    for (const t of this.data.tasks) {
      if (t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
        results.push({ type: 'task', id: t.id, title: t.title, sub: t.status, score: t.title.toLowerCase().includes(q) ? 2 : 1, created_at: t.created_at });
    }
    for (const a of this.data.activity) {
      if (a.message.toLowerCase().includes(q))
        results.push({ type: 'activity', id: a.id, title: a.message, sub: a.type, score: 1, created_at: a.created_at });
    }
    for (const l of this.data.ledger) {
      if (l.decision.toLowerCase().includes(q) || l.context.toLowerCase().includes(q) || l.project.toLowerCase().includes(q))
        results.push({ type: 'decision', id: l.id, title: `[${l.project}] ${l.decision.slice(0, 80)}`, sub: l.project, score: 3, created_at: l.created_at });
    }
    for (const s of this.data.sessions) {
      const match = s.summary.toLowerCase().includes(q) || s.project.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q));
      if (match) results.push({ type: 'session', id: s.id, title: `[${s.project}] ${s.summary.slice(0, 80)}`, sub: s.project, score: 2, created_at: s.created_at });
    }
    for (const p of this.data.scratchpads) {
      if (p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
        results.push({ type: 'scratchpad', id: p.id, title: p.name, sub: p.language, score: p.name.toLowerCase().includes(q) ? 2 : 1, created_at: p.updated_at });
    }

    return results.sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }
}


// ═════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════

describe('NexusStore', () => {
  let store;
  beforeEach(() => { store = new TestStore(); });

  // ── Usage tracking ──────────────────────────────────────
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
      const e1 = store.logUsage({ session_percent: 90, weekly_percent: 50 });
      e1.created_at = '2026-04-06T10:00:00.000Z';
      const e2 = store.logUsage({ session_percent: 80, weekly_percent: 48 });
      e2.created_at = '2026-04-06T11:00:00.000Z';
      const usage = store.getUsage();
      expect(usage[0].session_percent).toBe(80); // newer first
      expect(usage[1].session_percent).toBe(90);
    });

    it('accepts null session_percent and weekly_percent', () => {
      const entry = store.logUsage({ session_percent: null, weekly_percent: null });
      expect(entry.session_percent).toBeNull();
      expect(entry.weekly_percent).toBeNull();
      expect(store.getUsage().length).toBe(1);
    });

    it('stores note with usage entry', () => {
      const entry = store.logUsage({ session_percent: 50, weekly_percent: 30, note: 'after refactor' });
      expect(entry.note).toBe('after refactor');
    });

    it('enforces 30-day retention on logUsage', () => {
      // Insert an old entry directly
      store.data.usage.push({
        session_percent: 99, weekly_percent: 99, note: '',
        created_at: new Date(Date.now() - 31 * 86400000).toISOString(),
      });
      expect(store.data.usage.length).toBe(1);
      // Logging a new entry triggers the retention filter
      store.logUsage({ session_percent: 50, weekly_percent: 40 });
      expect(store.data.usage.length).toBe(1); // old one pruned
      expect(store.data.usage[0].session_percent).toBe(50);
    });
  });

  // ── Tasks ───────────────────────────────────────────────
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

    it('creates task with custom status', () => {
      const t = store.createTask({ title: 'WIP', status: 'in_progress' });
      expect(t.status).toBe('in_progress');
    });

    it('updates a task and returns old+new', () => {
      const t = store.createTask({ title: 'Original' });
      const result = store.updateTask(t.id, { title: 'Updated' });
      expect(result).not.toBeNull();
      expect(result.old.title).toBe('Original');
      expect(result.task.title).toBe('Updated');
    });

    it('updateTask returns null for non-existent id', () => {
      expect(store.updateTask(999, { title: 'x' })).toBeNull();
    });

    it('deletes a task', () => {
      const t = store.createTask({ title: 'To delete' });
      const deleted = store.deleteTask(t.id);
      expect(deleted.title).toBe('To delete');
      expect(store.getAllTasks().length).toBe(0);
    });

    it('deleteTask returns null for non-existent id', () => {
      expect(store.deleteTask(999)).toBeNull();
    });

    it('getAllTasks returns sorted by sort_order', () => {
      const t1 = store.createTask({ title: 'First' });
      const t2 = store.createTask({ title: 'Second' });
      // Force sort_order
      store.data.tasks[0].sort_order = 10;
      store.data.tasks[1].sort_order = 5;
      const tasks = store.getAllTasks();
      expect(tasks[0].title).toBe('Second');
      expect(tasks[1].title).toBe('First');
    });
  });

  // ── Sessions ────────────────────────────────────────────
  describe('Sessions', () => {
    it('creates a session with all fields', () => {
      const s = store.createSession({
        project: 'Nexus', summary: 'Built test suite',
        decisions: ['Use vitest'], blockers: ['None'],
        files_touched: ['tests/store.test.js'], tags: ['testing'],
      });
      expect(s.id).toBe(1);
      expect(s.project).toBe('Nexus');
      expect(s.decisions).toEqual(['Use vitest']);
      expect(s.tags).toEqual(['testing']);
    });

    it('getSession retrieves by id', () => {
      const s = store.createSession({ project: 'Nexus', summary: 'Test' });
      expect(store.getSession(s.id)).not.toBeNull();
      expect(store.getSession(s.id).summary).toBe('Test');
    });

    it('getSession returns null for missing id', () => {
      expect(store.getSession(999)).toBeNull();
    });

    it('getSessions filters by project (case-insensitive)', () => {
      store.createSession({ project: 'Nexus', summary: 'A' });
      store.createSession({ project: 'Firewall', summary: 'B' });
      store.createSession({ project: 'nexus', summary: 'C' });
      const sessions = store.getSessions({ project: 'Nexus' });
      expect(sessions.length).toBe(2);
    });

    it('getSessions respects limit', () => {
      for (let i = 0; i < 10; i++) store.createSession({ project: 'X', summary: `s${i}` });
      expect(store.getSessions({ limit: 3 }).length).toBe(3);
    });

    it('getSessions returns newest first', () => {
      const s1 = store.createSession({ project: 'X', summary: 'older' });
      s1.created_at = '2026-04-01T10:00:00.000Z';
      const s2 = store.createSession({ project: 'X', summary: 'newer' });
      s2.created_at = '2026-04-06T10:00:00.000Z';
      const sessions = store.getSessions();
      expect(sessions[0].summary).toBe('newer');
    });

    it('getSessionContext returns sessions and active tasks for project', () => {
      store.createSession({ project: 'Nexus', summary: 'Session A' });
      store.createTask({ title: 'Nexus: build tests', status: 'in_progress' });
      store.createTask({ title: 'Nexus: done task', status: 'done' });
      store.createTask({ title: 'Firewall: unrelated' });
      const ctx = store.getSessionContext('Nexus');
      expect(ctx.sessions.length).toBe(1);
      expect(ctx.activeTasks.length).toBe(1);
      expect(ctx.activeTasks[0].title).toContain('Nexus');
    });
  });

  // ── Ledger ──────────────────────────────────────────────
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
      expect(ledger[0].id).not.toBe(ledger[1].id);
    });

    it('records decisions with project attribution', () => {
      store.recordDecision({ decision: 'Use Godot', project: 'Firewall-Godot' });
      store.recordDecision({ decision: 'Use Express', project: 'Nexus' });
      const all = store.getLedger();
      expect(all.some(d => d.project === 'Firewall-Godot')).toBe(true);
    });

    it('defaults project to general', () => {
      const d = store.recordDecision({ decision: 'Some choice' });
      expect(d.project).toBe('general');
    });

    it('getLedger filters by project (case-insensitive)', () => {
      store.recordDecision({ decision: 'A', project: 'Nexus' });
      store.recordDecision({ decision: 'B', project: 'Firewall' });
      store.recordDecision({ decision: 'C', project: 'nexus' });
      const filtered = store.getLedger({ project: 'Nexus' });
      expect(filtered.length).toBe(2);
    });

    it('getLedger filters by tag', () => {
      store.recordDecision({ decision: 'A', tags: ['arch', 'db'] });
      store.recordDecision({ decision: 'B', tags: ['testing'] });
      store.recordDecision({ decision: 'C', tags: ['arch'] });
      expect(store.getLedger({ tag: 'arch' }).length).toBe(2);
      expect(store.getLedger({ tag: 'testing' }).length).toBe(1);
    });

    it('getLedger respects limit', () => {
      for (let i = 0; i < 10; i++) store.recordDecision({ decision: `d${i}` });
      expect(store.getLedger({ limit: 3 }).length).toBe(3);
    });

    it('getLedger returns newest first', () => {
      const d1 = store.recordDecision({ decision: 'old' });
      d1.created_at = '2026-04-01T10:00:00.000Z';
      const d2 = store.recordDecision({ decision: 'new' });
      d2.created_at = '2026-04-06T10:00:00.000Z';
      const ledger = store.getLedger();
      expect(ledger[0].decision).toBe('new');
    });

    it('recordDecision includes all fields', () => {
      const d = store.recordDecision({
        decision: 'full test',
        context: 'ctx',
        project: 'proj',
        alternatives: ['a', 'b'],
        tags: ['t1', 't2'],
      });
      expect(d.context).toBe('ctx');
      expect(d.project).toBe('proj');
      expect(d.alternatives).toEqual(['a', 'b']);
      expect(d.tags).toEqual(['t1', 't2']);
      expect(d.created_at).toBeTruthy();
    });
  });

  // ── Knowledge Graph ─────────────────────────────────────
  describe('Knowledge Graph', () => {
    it('addEdge creates an edge between decisions', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      const edge = store.addEdge(1, 2, 'led_to', 'A caused B');
      expect(edge.from).toBe(1);
      expect(edge.to).toBe(2);
      expect(edge.rel).toBe('led_to');
      expect(edge.note).toBe('A caused B');
    });

    it('addEdge prevents duplicate edges', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      const e1 = store.addEdge(1, 2, 'related');
      const e2 = store.addEdge(1, 2, 'related');
      expect(e1.id).toBe(e2.id); // same edge returned
      expect(store.data.graph_edges.length).toBe(1);
    });

    it('addEdge allows different relationship types between same nodes', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      store.addEdge(1, 2, 'related');
      store.addEdge(1, 2, 'led_to');
      expect(store.data.graph_edges.length).toBe(2);
    });

    it('removeEdge deletes and returns the edge', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      const edge = store.addEdge(1, 2, 'related');
      const removed = store.removeEdge(edge.id);
      expect(removed.id).toBe(edge.id);
      expect(store.data.graph_edges.length).toBe(0);
    });

    it('removeEdge returns null for missing id', () => {
      expect(store.removeEdge(999)).toBeNull();
    });

    it('getEdgesFor returns all edges involving a node', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      store.recordDecision({ decision: 'C' });
      store.addEdge(1, 2, 'related');
      store.addEdge(3, 1, 'depends_on');
      expect(store.getEdgesFor(1).length).toBe(2);
      expect(store.getEdgesFor(2).length).toBe(1);
    });

    it('getEdgesFrom returns outbound edges only', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      store.recordDecision({ decision: 'C' });
      store.addEdge(1, 2, 'related');
      store.addEdge(3, 1, 'depends_on');
      expect(store.getEdgesFrom(1).length).toBe(1);
      expect(store.getEdgesFrom(1)[0].to).toBe(2);
    });

    it('getEdgesTo returns inbound edges only', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      store.addEdge(1, 2, 'led_to');
      expect(store.getEdgesTo(2).length).toBe(1);
      expect(store.getEdgesTo(1).length).toBe(0);
    });

    it('traverse performs BFS from a start node', () => {
      store.recordDecision({ decision: 'Root' });
      store.recordDecision({ decision: 'Child1' });
      store.recordDecision({ decision: 'Child2' });
      store.recordDecision({ decision: 'Grandchild' });
      store.addEdge(1, 2, 'led_to');
      store.addEdge(1, 3, 'led_to');
      store.addEdge(2, 4, 'led_to');
      const result = store.traverse(1);
      expect(result.length).toBe(4);
      expect(result[0].decision).toBe('Root');
      expect(result[0].depth).toBe(0);
      // Children at depth 1
      const depth1 = result.filter(r => r.depth === 1);
      expect(depth1.length).toBe(2);
    });

    it('traverse respects maxDepth', () => {
      store.recordDecision({ decision: 'Root' });
      store.recordDecision({ decision: 'Child' });
      store.recordDecision({ decision: 'Grandchild' });
      store.addEdge(1, 2, 'led_to');
      store.addEdge(2, 3, 'led_to');
      const shallow = store.traverse(1, 1);
      expect(shallow.length).toBe(2); // root + child only
      expect(shallow.every(r => r.depth <= 1)).toBe(true);
    });

    it('traverse does not revisit nodes in cycles', () => {
      store.recordDecision({ decision: 'A' });
      store.recordDecision({ decision: 'B' });
      store.recordDecision({ decision: 'C' });
      store.addEdge(1, 2, 'related');
      store.addEdge(2, 3, 'related');
      store.addEdge(3, 1, 'related'); // cycle back
      const result = store.traverse(1);
      expect(result.length).toBe(3); // visits each exactly once
    });

    it('getGraph returns nodes and edges', () => {
      store.recordDecision({ decision: 'Alpha', project: 'P', tags: ['t1'] });
      store.recordDecision({ decision: 'Beta', project: 'Q', tags: [] });
      store.addEdge(1, 2, 'related', 'note');
      const graph = store.getGraph();
      expect(graph.nodes.length).toBe(2);
      expect(graph.edges.length).toBe(1);
      expect(graph.nodes[0].label).toBe('Alpha');
      expect(graph.edges[0].rel).toBe('related');
    });
  });

  // ── GPU History ─────────────────────────────────────────
  describe('GPU History', () => {
    it('logs a GPU snapshot', () => {
      store.logGpuSnapshot({ gpu_util: 45, mem_util: 60, vram_used: 4000, vram_total: 8000, temperature: 72, power: 150 });
      expect(store.data.gpu_history.length).toBe(1);
      expect(store.data.gpu_history[0].gpu_util).toBe(45);
      expect(store.data.gpu_history[0].created_at).toBeTruthy();
    });

    it('getGpuHistory filters by time window', () => {
      // Insert an old snapshot directly
      store.data.gpu_history.push({
        gpu_util: 10, mem_util: 20, vram_used: 1000, vram_total: 8000,
        temperature: 50, power: 80,
        created_at: new Date(Date.now() - 3 * 3600000).toISOString(), // 3 hours ago
      });
      store.logGpuSnapshot({ gpu_util: 90, mem_util: 80, vram_used: 7000, vram_total: 8000, temperature: 85, power: 200 });
      expect(store.getGpuHistory(1).length).toBe(1); // only recent
      expect(store.getGpuHistory(4).length).toBe(2); // both
    });

    it('24-hour retention on logGpuSnapshot', () => {
      store.data.gpu_history.push({
        gpu_util: 10, mem_util: 10, vram_used: 500, vram_total: 8000,
        temperature: 40, power: 50,
        created_at: new Date(Date.now() - 25 * 3600000).toISOString(), // 25 hours ago
      });
      store.logGpuSnapshot({ gpu_util: 50, mem_util: 50, vram_used: 4000, vram_total: 8000, temperature: 65, power: 120 });
      expect(store.data.gpu_history.length).toBe(1); // old one pruned
    });
  });

  // ── Scratchpads ─────────────────────────────────────────
  describe('Scratchpads', () => {
    it('creates a scratchpad with defaults', () => {
      const pad = store.createScratchpad({ name: 'Notes' });
      expect(pad.id).toBe(1);
      expect(pad.name).toBe('Notes');
      expect(pad.content).toBe('');
      expect(pad.language).toBe('markdown');
    });

    it('getScratchpad retrieves by id', () => {
      const pad = store.createScratchpad({ name: 'Test', content: 'hello' });
      expect(store.getScratchpad(pad.id).content).toBe('hello');
    });

    it('getScratchpad returns null for missing id', () => {
      expect(store.getScratchpad(999)).toBeNull();
    });

    it('updateScratchpad returns the updated pad', () => {
      const pad = store.createScratchpad({ name: 'Draft' });
      const updated = store.updateScratchpad(pad.id, { content: 'new content' });
      expect(updated).not.toBeNull();
      expect(updated.content).toBe('new content');
      expect(updated.name).toBe('Draft'); // preserved
    });

    it('updateScratchpad returns null for missing id', () => {
      expect(store.updateScratchpad(999, { content: 'x' })).toBeNull();
    });

    it('deleteScratchpad removes and returns it', () => {
      const pad = store.createScratchpad({ name: 'Temp' });
      const deleted = store.deleteScratchpad(pad.id);
      expect(deleted.name).toBe('Temp');
      expect(store.getAllScratchpads().length).toBe(0);
    });

    it('deleteScratchpad returns null for missing id', () => {
      expect(store.deleteScratchpad(999)).toBeNull();
    });

    it('getAllScratchpads returns sorted by updated_at descending', () => {
      const p1 = store.createScratchpad({ name: 'Old' });
      p1.updated_at = '2026-04-01T10:00:00.000Z';
      const p2 = store.createScratchpad({ name: 'New' });
      p2.updated_at = '2026-04-06T10:00:00.000Z';
      const pads = store.getAllScratchpads();
      expect(pads[0].name).toBe('New');
    });
  });

  // ── Search ──────────────────────────────────────────────
  describe('Search', () => {
    it('searches across tasks, sessions, and ledger', () => {
      store.createTask({ title: 'Build dashboard widget' });
      store.createSession({ project: 'Nexus', summary: 'Dashboard session' });
      store.recordDecision({ decision: 'Use dashboard layout', project: 'Nexus' });
      const results = store.search('dashboard');
      expect(results.length).toBe(3);
      const types = results.map(r => r.type);
      expect(types).toContain('task');
      expect(types).toContain('session');
      expect(types).toContain('decision');
    });

    it('decisions score higher than tasks in search', () => {
      store.createTask({ title: 'fix vitest config' });
      store.recordDecision({ decision: 'fix vitest setup', project: 'Nexus' });
      const results = store.search('vitest');
      expect(results[0].type).toBe('decision'); // score 3 vs 2
    });

    it('search is case-insensitive', () => {
      store.createTask({ title: 'UPPERCASE TASK' });
      expect(store.search('uppercase').length).toBe(1);
    });

    it('search respects limit', () => {
      for (let i = 0; i < 10; i++) store.createTask({ title: `match task ${i}` });
      expect(store.search('match', 3).length).toBe(3);
    });

    it('search returns empty array for no matches', () => {
      store.createTask({ title: 'Alpha' });
      expect(store.search('zzzzz').length).toBe(0);
    });

    it('search finds scratchpads by content', () => {
      store.createScratchpad({ name: 'Notes', content: 'refactor the router logic' });
      const results = store.search('router');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('scratchpad');
    });

    it('search finds activity entries', () => {
      store.addActivity('task', 'Deployed new release');
      const results = store.search('deployed');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('activity');
    });

    it('search matches session tags', () => {
      store.createSession({ project: 'Nexus', summary: 'Generic', tags: ['infrastructure'] });
      const results = store.search('infrastructure');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('session');
    });
  });

  // ── Activity ────────────────────────────────────────────
  describe('Activity', () => {
    it('adds activity with meta', () => {
      const a = store.addActivity('task', 'Created task', { taskId: 1 });
      expect(a.type).toBe('task');
      expect(JSON.parse(a.meta).taskId).toBe(1);
    });

    it('getActivity respects limit', () => {
      for (let i = 0; i < 10; i++) store.addActivity('test', `msg${i}`);
      expect(store.getActivity(3).length).toBe(3);
    });

    it('caps activity at 500 entries', () => {
      for (let i = 0; i < 505; i++) store.addActivity('test', `msg${i}`);
      expect(store.data.activity.length).toBe(500);
    });
  });
});
