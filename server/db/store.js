import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'nexus.json');

/**
 * NexusStore -- a simple JSON-file database.
 * Synchronous reads, async-safe writes, zero native deps.
 * Good enough for a local single-user dashboard.
 */
export class NexusStore {
  constructor() {
    if (existsSync(DB_PATH)) {
      this.data = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
    } else {
      this.data = this._seed();
      this._flush();
    }
    // Ensure arrays exist (migration from earlier versions)
    if (!this.data.sessions) this.data.sessions = [];
    if (!this.data.usage) this.data.usage = [];
    if (!this.data.gpu_history) this.data.gpu_history = [];
    if (!this.data.ledger) this.data.ledger = [];
    if (!this.data.graph_edges) this.data.graph_edges = [];

    this._nextId = {
      tasks: Math.max(0, ...this.data.tasks.map(t => t.id)) + 1,
      activity: Math.max(0, ...this.data.activity.map(a => a.id)) + 1,
      sessions: Math.max(0, ...this.data.sessions.map(s => s.id)) + 1,
      scratchpads: Math.max(0, ...this.data.scratchpads.map(s => s.id)) + 1,
      bookmarks: Math.max(0, ...this.data.bookmarks.map(b => b.id)) + 1,
    };
  }

  _seed() {
    return {
      tasks: [],
      activity: [],
      sessions: [],
      usage: [],
      gpu_history: [],
      ledger: [],
      graph_edges: [],
      scratchpads: [
        {
          id: 1,
          name: "Captain's Log",
          content: "# Captain's Log\n\nFirst entry. Nexus is online.\n",
          language: 'markdown',
          updated_at: new Date().toISOString(),
        },
      ],
      bookmarks: [],
    };
  }

  _flush() {
    writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
  }

  _id(table) {
    return this._nextId[table]++;
  }

  _now() {
    return new Date().toISOString();
  }

  // ── Tasks ──────────────────────────────
  getAllTasks() {
    return [...this.data.tasks].sort((a, b) => a.sort_order - b.sort_order);
  }

  createTask({ title, description = '', status = 'backlog', priority = 0 }) {
    const maxOrder = this.data.tasks
      .filter(t => t.status === status)
      .reduce((max, t) => Math.max(max, t.sort_order), 0);
    const task = {
      id: this._id('tasks'),
      title,
      description,
      status,
      priority,
      sort_order: maxOrder + 1,
      linked_files: '[]',
      created_at: this._now(),
      updated_at: this._now(),
    };
    this.data.tasks.push(task);
    this._flush();
    return task;
  }

  updateTask(id, updates) {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const old = this.data.tasks[idx];
    this.data.tasks[idx] = { ...old, ...updates, id, updated_at: this._now() };
    this._flush();
    return { task: this.data.tasks[idx], old };
  }

  deleteTask(id) {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const task = this.data.tasks.splice(idx, 1)[0];
    this._flush();
    return task;
  }

  // ── Activity ───────────────────────────
  getActivity(limit = 50) {
    return [...this.data.activity]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  addActivity(type, message, meta = {}) {
    const entry = {
      id: this._id('activity'),
      type,
      message,
      meta: JSON.stringify(meta),
      created_at: this._now(),
    };
    this.data.activity.push(entry);
    // Keep activity log bounded
    if (this.data.activity.length > 500) {
      this.data.activity = this.data.activity.slice(-500);
    }
    this._flush();
    return entry;
  }

  // ── Scratchpads ────────────────────────
  getAllScratchpads() {
    return [...this.data.scratchpads].sort((a, b) =>
      new Date(b.updated_at) - new Date(a.updated_at)
    );
  }

  getScratchpad(id) {
    return this.data.scratchpads.find(s => s.id === id) || null;
  }

  createScratchpad({ name, content = '', language = 'markdown' }) {
    const pad = {
      id: this._id('scratchpads'),
      name,
      content,
      language,
      updated_at: this._now(),
    };
    this.data.scratchpads.push(pad);
    this._flush();
    return pad;
  }

  updateScratchpad(id, updates) {
    const idx = this.data.scratchpads.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this.data.scratchpads[idx] = {
      ...this.data.scratchpads[idx],
      ...updates,
      id,
      updated_at: this._now(),
    };
    this._flush();
    return this.data.scratchpads[idx];
  }

  deleteScratchpad(id) {
    const idx = this.data.scratchpads.findIndex(s => s.id === id);
    if (idx === -1) return null;
    return this.data.scratchpads.splice(idx, 1)[0];
  }

  // ── Usage Tracking ─────────────────────
  logUsage({ session_percent, weekly_percent, note = '' }) {
    const entry = {
      session_percent,
      weekly_percent,
      note,
      created_at: this._now(),
    };
    this.data.usage.push(entry);
    // Keep 30 days of data
    const cutoff = Date.now() - 30 * 86400000;
    this.data.usage = this.data.usage.filter(u => new Date(u.created_at).getTime() > cutoff);
    this._flush();
    return entry;
  }

  getUsage(limit = 100) {
    return [...this.data.usage]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  getLatestUsage() {
    if (this.data.usage.length === 0) return null;
    return this.data.usage[this.data.usage.length - 1];
  }

  // ── GPU History ───────────────────────
  logGpuSnapshot(snapshot) {
    this.data.gpu_history.push({
      ...snapshot,
      created_at: this._now(),
    });
    // Keep 24h of snapshots (at ~1/min that's 1440 entries)
    const cutoff = Date.now() - 24 * 3600000;
    this.data.gpu_history = this.data.gpu_history.filter(g => new Date(g.created_at).getTime() > cutoff);
    this._flush();
  }

  getGpuHistory(hours = 1) {
    const cutoff = Date.now() - hours * 3600000;
    return this.data.gpu_history.filter(g => new Date(g.created_at).getTime() > cutoff);
  }

  // ── Sessions (the memory bridge) ──────
  getSessions({ project, limit = 20 } = {}) {
    let sessions = [...this.data.sessions];
    if (project) {
      sessions = sessions.filter(s => s.project.toLowerCase() === project.toLowerCase());
    }
    return sessions
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  getSession(id) {
    return this.data.sessions.find(s => s.id === id) || null;
  }

  createSession({ project, summary, decisions = [], blockers = [], files_touched = [], tags = [] }) {
    const session = {
      id: this._id('sessions'),
      project,
      summary,
      decisions,
      blockers,
      files_touched,
      tags,
      created_at: this._now(),
    };
    this.data.sessions.push(session);
    this._flush();
    return session;
  }

  getSessionContext(project, limit = 5) {
    // Get recent sessions for a project -- designed for agent startup
    const sessions = this.getSessions({ project, limit });
    const tasks = this.data.tasks.filter(t =>
      t.status !== 'done' && t.title.toLowerCase().includes(project.toLowerCase())
    );
    return { sessions, activeTasks: tasks };
  }

  // ── Ledger (decision index) ────────────
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
      decision,
      context,
      project,
      alternatives,
      tags,
      created_at: this._now(),
    };
    this.data.ledger.push(entry);
    this._flush();
    return entry;
  }

  // ── Knowledge Graph ────────────────────
  // Edge types: led_to, replaced, depends_on, contradicts, related
  addEdge(fromId, toId, relationship = 'related', note = '') {
    const edges = this.data.graph_edges;
    // Prevent duplicates
    const exists = edges.find(e => e.from === fromId && e.to === toId && e.rel === relationship);
    if (exists) return exists;

    const edge = { id: edges.length + 1, from: fromId, to: toId, rel: relationship, note, created_at: this._now() };
    edges.push(edge);
    this._flush();
    return edge;
  }

  removeEdge(id) {
    const idx = this.data.graph_edges.findIndex(e => e.id === id);
    if (idx === -1) return null;
    return this.data.graph_edges.splice(idx, 1)[0];
  }

  getEdgesFrom(decisionId) {
    return this.data.graph_edges.filter(e => e.from === decisionId);
  }

  getEdgesTo(decisionId) {
    return this.data.graph_edges.filter(e => e.to === decisionId);
  }

  getEdgesFor(decisionId) {
    return this.data.graph_edges.filter(e => e.from === decisionId || e.to === decisionId);
  }

  // Traverse: get all decisions connected to a given one (breadth-first, max depth)
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

      // Follow edges both directions
      for (const edge of this.getEdgesFor(id)) {
        const nextId = edge.from === id ? edge.to : edge.from;
        if (!visited.has(nextId)) {
          queue.push({ id: nextId, depth: depth + 1, path: [...path, { edge: edge.rel, from: id, to: nextId }] });
        }
      }
    }

    return result;
  }

  // Get full graph for visualization
  getGraph() {
    const nodes = this.data.ledger.map(d => ({
      id: d.id,
      label: d.decision.slice(0, 50),
      project: d.project,
      tags: d.tags || [],
    }));
    const edges = this.data.graph_edges.map(e => ({
      id: e.id,
      from: e.from,
      to: e.to,
      rel: e.rel,
      note: e.note,
    }));
    return { nodes, edges };
  }

  // ── Search (across everything) ────────
  search(query, limit = 30) {
    const q = query.toLowerCase();
    const results = [];

    // Search tasks
    for (const t of this.data.tasks) {
      if (t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) {
        results.push({ type: 'task', id: t.id, title: t.title, sub: t.status, score: t.title.toLowerCase().includes(q) ? 2 : 1, created_at: t.created_at });
      }
    }

    // Search activity
    for (const a of this.data.activity) {
      if (a.message.toLowerCase().includes(q)) {
        results.push({ type: 'activity', id: a.id, title: a.message, sub: a.type, score: 1, created_at: a.created_at });
      }
    }

    // Search ledger
    for (const l of (this.data.ledger || [])) {
      if (l.decision.toLowerCase().includes(q) || l.context.toLowerCase().includes(q) || l.project.toLowerCase().includes(q)) {
        results.push({ type: 'decision', id: l.id, title: `[${l.project}] ${l.decision.slice(0, 80)}`, sub: l.project, score: 3, created_at: l.created_at });
      }
    }

    // Search sessions
    for (const s of this.data.sessions) {
      const match = s.summary.toLowerCase().includes(q) || s.project.toLowerCase().includes(q)
        || s.tags.some(t => t.toLowerCase().includes(q));
      if (match) {
        results.push({ type: 'session', id: s.id, title: `[${s.project}] ${s.summary.slice(0, 80)}`, sub: s.project, score: 2, created_at: s.created_at });
      }
    }

    // Search scratchpads
    for (const p of this.data.scratchpads) {
      if (p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)) {
        results.push({ type: 'scratchpad', id: p.id, title: p.name, sub: p.language, score: p.name.toLowerCase().includes(q) ? 2 : 1, created_at: p.updated_at });
      }
    }

    return results
      .sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }
}
