import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  NexusData, Task, ActivityEntry, Session, Scratchpad,
  UsageEntry, GpuSnapshot, Decision, GraphEdge, GraphData, SessionTiming,
  Bookmark, AdviceEntry, Thought,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'nexus.json');

type IdTable = 'tasks' | 'activity' | 'sessions' | 'scratchpads' | 'bookmarks';

export class NexusStore {
  data: NexusData;
  _lastRiskScan?: { risks: any[]; scannedAt: string; critical: number; warnings: number };
  private _nextId: Record<IdTable, number>;

  constructor() {
    if (existsSync(DB_PATH)) {
      this.data = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
    } else {
      this.data = this._seed();
      this._flush();
    }
    if (!this.data.sessions) this.data.sessions = [];
    if (!this.data.usage) this.data.usage = [];
    if (!this.data.gpu_history) this.data.gpu_history = [];
    if (!this.data.ledger) this.data.ledger = [];
    if (!this.data.graph_edges) this.data.graph_edges = [];
    if (!this.data.bookmarks) this.data.bookmarks = [];
    if (!this.data.advice) this.data.advice = [];
    if (!this.data.thoughts) this.data.thoughts = [];

    this._nextId = {
      tasks: Math.max(0, ...this.data.tasks.map(t => t.id)) + 1,
      activity: Math.max(0, ...this.data.activity.map(a => a.id)) + 1,
      sessions: Math.max(0, ...this.data.sessions.map(s => s.id)) + 1,
      scratchpads: Math.max(0, ...this.data.scratchpads.map(s => s.id)) + 1,
      bookmarks: Math.max(0, ...this.data.bookmarks.map(b => b.id)) + 1,
    };
  }

  private _seed(): NexusData {
    return {
      tasks: [], activity: [], sessions: [], usage: [], gpu_history: [],
      ledger: [], graph_edges: [], advice: [], thoughts: [],
      scratchpads: [{
        id: 1, name: "Scratchpad",
        content: "# Scratchpad\n\nWorking area.\n",
        language: 'markdown', updated_at: new Date().toISOString(),
      }],
      bookmarks: [],
    };
  }

  _flush(): void { writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2)); }
  private _id(table: IdTable): number { return this._nextId[table]++; }
  _now(): string { return new Date().toISOString(); }

  // ── Tasks ──────────────────────────────────────────────
  getAllTasks(): Task[] {
    return [...this.data.tasks].sort((a, b) => a.sort_order - b.sort_order);
  }

  createTask({ title, description = '', status = 'backlog', priority = 0 }: {
    title: string; description?: string; status?: Task['status']; priority?: number;
  }): Task {
    const maxOrder = this.data.tasks.filter(t => t.status === status).reduce((max, t) => Math.max(max, t.sort_order), 0);
    const task: Task = {
      id: this._id('tasks'), title, description, status, priority,
      sort_order: maxOrder + 1, linked_files: '[]',
      created_at: this._now(), updated_at: this._now(),
    };
    this.data.tasks.push(task);
    this._flush();
    return task;
  }

  updateTask(id: number, updates: Partial<Task>): { task: Task; old: Task } | null {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const old = { ...this.data.tasks[idx] };
    this.data.tasks[idx] = { ...old, ...updates, id, updated_at: this._now() } as Task;
    this._flush();
    return { task: this.data.tasks[idx], old };
  }

  deleteTask(id: number): Task | null {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const task = this.data.tasks.splice(idx, 1)[0];
    this._flush();
    return task;
  }

  // ── Activity ───────────────────────────────────────────
  getActivity(limit = 50): ActivityEntry[] {
    return [...this.data.activity]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  addActivity(type: string, message: string, meta: Record<string, any> = {}): ActivityEntry {
    const entry: ActivityEntry = {
      id: this._id('activity'), type, message,
      meta: JSON.stringify(meta), created_at: this._now(),
    };
    this.data.activity.push(entry);
    if (this.data.activity.length > 500) this.data.activity = this.data.activity.slice(-500);
    this._flush();
    return entry;
  }

  // ── Scratchpads ────────────────────────────────────────
  getAllScratchpads(): Scratchpad[] {
    return [...this.data.scratchpads].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  getScratchpad(id: number): Scratchpad | null {
    return this.data.scratchpads.find(s => s.id === id) || null;
  }

  createScratchpad({ name, content = '', language = 'markdown' }: {
    name: string; content?: string; language?: string;
  }): Scratchpad {
    const pad: Scratchpad = { id: this._id('scratchpads'), name, content, language, updated_at: this._now() };
    this.data.scratchpads.push(pad);
    this._flush();
    return pad;
  }

  updateScratchpad(id: number, updates: Partial<Scratchpad>): Scratchpad | null {
    const idx = this.data.scratchpads.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this.data.scratchpads[idx] = { ...this.data.scratchpads[idx], ...updates, id, updated_at: this._now() } as Scratchpad;
    this._flush();
    return this.data.scratchpads[idx];
  }

  deleteScratchpad(id: number): Scratchpad | null {
    const idx = this.data.scratchpads.findIndex(s => s.id === id);
    if (idx === -1) return null;
    return this.data.scratchpads.splice(idx, 1)[0];
  }

  // ── Bookmarks ──────────────────────────────────────────
  getAllBookmarks(): Bookmark[] {
    if (!this.data.bookmarks) this.data.bookmarks = [];
    return [...this.data.bookmarks].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  createBookmark({ title, url, category = 'general' }: {
    title: string; url: string; category?: string;
  }): Bookmark {
    if (!this.data.bookmarks) this.data.bookmarks = [];
    const bookmark: Bookmark = {
      id: this._id('bookmarks'),
      title,
      url,
      category,
      created_at: this._now(),
    };
    this.data.bookmarks.push(bookmark);
    this._flush();
    return bookmark;
  }

  updateBookmark(id: number, updates: Partial<Bookmark>): Bookmark | null {
    if (!this.data.bookmarks) this.data.bookmarks = [];
    const idx = this.data.bookmarks.findIndex(b => b.id === id);
    if (idx === -1) return null;
    this.data.bookmarks[idx] = { ...this.data.bookmarks[idx], ...updates, id } as Bookmark;
    this._flush();
    return this.data.bookmarks[idx];
  }

  deleteBookmark(id: number): Bookmark | null {
    if (!this.data.bookmarks) this.data.bookmarks = [];
    const idx = this.data.bookmarks.findIndex(b => b.id === id);
    if (idx === -1) return null;
    const bookmark = this.data.bookmarks.splice(idx, 1)[0];
    this._flush();
    return bookmark;
  }

  // ── Usage ──────────────────────────────────────────────
  logUsage({ session_percent, weekly_percent, note = '' }: {
    session_percent: number | null; weekly_percent: number | null; note?: string;
  }): UsageEntry {
    const entry: UsageEntry = { session_percent, weekly_percent, note, created_at: this._now() };
    this.data.usage.push(entry);
    const cutoff = Date.now() - 30 * 86400000;
    this.data.usage = this.data.usage.filter(u => new Date(u.created_at).getTime() > cutoff);
    this._flush();
    return entry;
  }

  getUsage(limit = 100): UsageEntry[] {
    return [...this.data.usage]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  getLatestUsage(): UsageEntry | null {
    return this.data.usage.length > 0 ? this.data.usage[this.data.usage.length - 1] : null;
  }

  // ── GPU History ────────────────────────────────────────
  logGpuSnapshot(snapshot: Omit<GpuSnapshot, 'created_at'>): GpuSnapshot {
    const entry: GpuSnapshot = { ...snapshot, created_at: this._now() };
    this.data.gpu_history.push(entry);
    const cutoff = Date.now() - 24 * 3600000;
    this.data.gpu_history = this.data.gpu_history.filter(g => new Date(g.created_at).getTime() > cutoff);
    this._flush();
    return entry;
  }

  getGpuHistory(hours = 1): GpuSnapshot[] {
    const cutoff = Date.now() - hours * 3600000;
    return this.data.gpu_history.filter(g => new Date(g.created_at).getTime() > cutoff);
  }

  // ── Sessions ───────────────────────────────────────────
  getSessions({ project, limit = 20 }: { project?: string; limit?: number } = {}): Session[] {
    let sessions = [...this.data.sessions];
    if (project) sessions = sessions.filter(s => s.project.toLowerCase() === project.toLowerCase());
    return sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
  }

  getSession(id: number): Session | null {
    return this.data.sessions.find(s => s.id === id) || null;
  }

  createSession({ project, summary, decisions = [], blockers = [], files_touched = [], tags = [] }: {
    project: string; summary: string; decisions?: string[]; blockers?: string[];
    files_touched?: string[]; tags?: string[];
  }): Session {
    const session: Session = {
      id: this._id('sessions'), project, summary, decisions, blockers,
      files_touched, tags, created_at: this._now(),
    };
    this.data.sessions.push(session);
    this._flush();
    return session;
  }

  getSessionContext(project: string, limit = 5): { sessions: Session[]; activeTasks: Task[] } {
    const sessions = this.getSessions({ project, limit });
    const tasks = this.data.tasks.filter(t => t.status !== 'done' && t.title.toLowerCase().includes(project.toLowerCase()));
    return { sessions, activeTasks: tasks };
  }

  // ── Ledger ─────────────────────────────────────────────
  getLedger({ project, tag, limit = 50 }: { project?: string; tag?: string; limit?: number } = {}): Decision[] {
    let entries = [...this.data.ledger];
    if (project) entries = entries.filter(e => e.project.toLowerCase() === project.toLowerCase());
    if (tag) entries = entries.filter(e => (e.tags || []).includes(tag));
    return entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
  }

  recordDecision({ decision, context = '', project = 'general', alternatives = [], tags = [] }: {
    decision: string; context?: string; project?: string; alternatives?: string[]; tags?: string[];
  }): Decision {
    if (!this.data.ledger) this.data.ledger = [];
    const entry: Decision = {
      id: (this.data.ledger.length > 0 ? Math.max(...this.data.ledger.map(e => e.id)) : 0) + 1,
      decision, context, project, alternatives, tags, created_at: this._now(),
    };
    this.data.ledger.push(entry);
    this._flush();
    return entry;
  }

  // ── Knowledge Graph ────────────────────────────────────
  addEdge(fromId: number, toId: number, relationship: GraphEdge['rel'] = 'related', note = ''): GraphEdge {
    const exists = this.data.graph_edges.find(e => e.from === fromId && e.to === toId && e.rel === relationship);
    if (exists) return exists;
    const edge: GraphEdge = { id: this.data.graph_edges.length + 1, from: fromId, to: toId, rel: relationship, note, created_at: this._now() };
    this.data.graph_edges.push(edge);
    this._flush();
    return edge;
  }

  removeEdge(id: number): GraphEdge | null {
    const idx = this.data.graph_edges.findIndex(e => e.id === id);
    if (idx === -1) return null;
    return this.data.graph_edges.splice(idx, 1)[0];
  }

  getEdgesFrom(id: number): GraphEdge[] { return this.data.graph_edges.filter(e => e.from === id); }
  getEdgesTo(id: number): GraphEdge[] { return this.data.graph_edges.filter(e => e.to === id); }
  getEdgesFor(id: number): GraphEdge[] { return this.data.graph_edges.filter(e => e.from === id || e.to === id); }

  traverse(startId: number, maxDepth = 3): (Decision & { depth: number; path: any[] })[] {
    const visited = new Set<number>();
    const result: (Decision & { depth: number; path: any[] })[] = [];
    const queue: { id: number; depth: number; path: any[] }[] = [{ id: startId, depth: 0, path: [] }];

    while (queue.length > 0) {
      const { id, depth, path } = queue.shift()!;
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

  getGraph(): GraphData {
    return {
      nodes: this.data.ledger.map(d => ({ id: d.id, label: d.decision.slice(0, 50), project: d.project, tags: d.tags || [] })),
      edges: this.data.graph_edges.map(e => ({ id: e.id, from: e.from, to: e.to, rel: e.rel, note: e.note })),
    };
  }

  // ── Search ─────────────────────────────────────────────
  search(query: string, limit = 30): { type: string; id: number; title: string; sub: string; score: number; created_at: string }[] {
    const q = query.toLowerCase();
    const results: { type: string; id: number; title: string; sub: string; score: number; created_at: string }[] = [];

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

    return results.sort((a, b) => b.score - a.score || new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
  }

  // ── Advice Journal ─────────────────────────────────────
  recordAdvice(opts: {
    source: AdviceEntry['source'];
    question: string;
    recommendation: string;
    context_snapshot?: AdviceEntry['context_snapshot'];
  }): AdviceEntry | null {
    if (!this.data.advice) this.data.advice = [];

    // Dedup: if identical recommendation was logged within the last hour, skip
    const hash = opts.recommendation.slice(0, 100).toLowerCase().replace(/\s+/g, ' ').trim();
    const oneHourAgo = Date.now() - 3600000;
    const recentDuplicate = this.data.advice.find(a =>
      a.recommendation_hash === hash && new Date(a.created_at).getTime() > oneHourAgo
    );
    if (recentDuplicate) return null;

    const snapshot = opts.context_snapshot ?? {
      session_fuel: this.getLatestUsage()?.session_percent ?? null,
      weekly_fuel: this.getLatestUsage()?.weekly_percent ?? null,
      open_tasks: this.data.tasks.filter(t => t.status !== 'done').length,
      in_progress_tasks: this.data.tasks.filter(t => t.status === 'in_progress').length,
      recent_decisions: this.data.ledger.filter(d =>
        Date.now() - new Date(d.created_at).getTime() < 86400000
      ).length,
    };

    const entry: AdviceEntry = {
      id: (this.data.advice.length > 0 ? Math.max(...this.data.advice.map(a => a.id)) : 0) + 1,
      created_at: this._now(),
      source: opts.source,
      question: opts.question,
      recommendation: opts.recommendation,
      recommendation_hash: hash,
      context_snapshot: snapshot,
      accepted: null,
      outcome: null,
      notes: '',
      measured_fuel_cost: null,
    };
    this.data.advice.push(entry);

    // Keep bounded to last 500 advice entries
    if (this.data.advice.length > 500) {
      this.data.advice = this.data.advice.slice(-500);
    }

    this._flush();
    return entry;
  }

  getAdvice(opts: { limit?: number; source?: string; onlyUnjudged?: boolean } = {}): AdviceEntry[] {
    let entries = [...(this.data.advice || [])];
    if (opts.source) entries = entries.filter(e => e.source === opts.source);
    if (opts.onlyUnjudged) entries = entries.filter(e => e.accepted === null);
    return entries
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, opts.limit ?? 20);
  }

  updateAdviceVerdict(id: number, updates: {
    accepted?: boolean;
    outcome?: AdviceEntry['outcome'];
    notes?: string;
    measured_fuel_cost?: number | null;
  }): AdviceEntry | null {
    const idx = (this.data.advice || []).findIndex(a => a.id === id);
    if (idx === -1) return null;
    this.data.advice[idx] = { ...this.data.advice[idx], ...updates };
    this._flush();
    return this.data.advice[idx];
  }

  // Aggregate patterns: how often was Overseer right?
  getAdvicePatterns() {
    const all = this.data.advice || [];
    const judged = all.filter(a => a.accepted !== null);
    const accepted = all.filter(a => a.accepted === true);
    const rejected = all.filter(a => a.accepted === false);

    const bySource: Record<string, { total: number; accepted: number; worked: number; wrong: number }> = {};
    for (const a of all) {
      if (!bySource[a.source]) bySource[a.source] = { total: 0, accepted: 0, worked: 0, wrong: 0 };
      bySource[a.source].total++;
      if (a.accepted === true) bySource[a.source].accepted++;
      if (a.outcome === 'worked') bySource[a.source].worked++;
      if (a.outcome === 'wrong') bySource[a.source].wrong++;
    }

    const outcomes = {
      worked: all.filter(a => a.outcome === 'worked').length,
      partial: all.filter(a => a.outcome === 'partial').length,
      wrong: all.filter(a => a.outcome === 'wrong').length,
    };

    return {
      total: all.length,
      judged: judged.length,
      unjudged: all.length - judged.length,
      acceptanceRate: judged.length > 0 ? Math.round((accepted.length / judged.length) * 100) : null,
      accepted: accepted.length,
      rejected: rejected.length,
      outcomes,
      accuracyRate: (outcomes.worked + outcomes.partial + outcomes.wrong) > 0
        ? Math.round((outcomes.worked / (outcomes.worked + outcomes.partial + outcomes.wrong)) * 100)
        : null,
      bySource,
    };
  }

  // ── Thought Stack ──────────────────────────────────────
  // Working memory for interrupt-recovery: push when distracted, pop when returning.
  pushThought(opts: { text: string; context?: string; project?: string; related_task_id?: number | null }): Thought {
    if (!this.data.thoughts) this.data.thoughts = [];
    const thought: Thought = {
      id: (this.data.thoughts.length > 0 ? Math.max(...this.data.thoughts.map(t => t.id)) : 0) + 1,
      text: opts.text,
      context: opts.context ?? '',
      project: opts.project ?? 'general',
      pushed_at: this._now(),
      popped_at: null,
      status: 'active',
      related_task_id: opts.related_task_id ?? null,
    };
    this.data.thoughts.push(thought);
    this._flush();
    return thought;
  }

  popThought(id?: number): Thought | null {
    const thoughts = this.data.thoughts || [];
    // If no id given, pop the most recently pushed active thought (LIFO)
    let target: Thought | undefined;
    if (id != null) {
      target = thoughts.find(t => t.id === id && t.status === 'active');
    } else {
      const active = thoughts.filter(t => t.status === 'active');
      target = active.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime())[0];
    }
    if (!target) return null;
    target.popped_at = this._now();
    target.status = 'resolved';
    this._flush();
    return target;
  }

  abandonThought(id: number, reason = ''): Thought | null {
    const thought = (this.data.thoughts || []).find(t => t.id === id);
    if (!thought) return null;
    thought.status = 'abandoned';
    thought.popped_at = this._now();
    if (reason) thought.context = thought.context ? `${thought.context} | abandoned: ${reason}` : `abandoned: ${reason}`;
    this._flush();
    return thought;
  }

  getActiveThoughts(project?: string): Thought[] {
    let thoughts = (this.data.thoughts || []).filter(t => t.status === 'active');
    if (project) thoughts = thoughts.filter(t => t.project.toLowerCase() === project.toLowerCase());
    return thoughts.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());
  }

  getAllThoughts(opts: { project?: string; limit?: number; status?: Thought['status'] } = {}): Thought[] {
    let thoughts = [...(this.data.thoughts || [])];
    if (opts.project) thoughts = thoughts.filter(t => t.project.toLowerCase() === opts.project!.toLowerCase());
    if (opts.status) thoughts = thoughts.filter(t => t.status === opts.status);
    return thoughts
      .sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime())
      .slice(0, opts.limit ?? 50);
  }

  // ── Self-Critique: pattern detection on task completion times ─────
  // Returns insights about which task types are slow / fast / stuck
  getSelfCritique(): {
    slowTasks: Array<{ id: number; title: string; minutes: number; status: string }>;
    fastTasks: Array<{ id: number; title: string; minutes: number; status: string }>;
    stuckTasks: Array<{ id: number; title: string; ageHours: number }>;
    averageCompletionMinutes: number | null;
    insights: string[];
  } {
    const tasks = this.data.tasks || [];
    const completed = tasks.filter(t =>
      t.status === 'done' &&
      t.created_at &&
      t.updated_at &&
      t.created_at !== t.updated_at
    );

    const withDuration = completed.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      minutes: Math.round((new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()) / 60000),
    })).filter(t => t.minutes >= 0 && t.minutes < 24 * 60); // sanity bounds

    if (withDuration.length === 0) {
      return { slowTasks: [], fastTasks: [], stuckTasks: [], averageCompletionMinutes: null, insights: ['Insufficient data for self-critique. Complete more tasks.'] };
    }

    const sorted = [...withDuration].sort((a, b) => b.minutes - a.minutes);
    const avg = withDuration.reduce((s, t) => s + t.minutes, 0) / withDuration.length;

    // Stuck = in_progress for > 24h
    const stuck = tasks
      .filter(t => t.status === 'in_progress')
      .map(t => ({
        id: t.id,
        title: t.title,
        ageHours: Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000),
      }))
      .filter(t => t.ageHours > 24);

    const insights: string[] = [];
    insights.push(`Average completion time: ${Math.round(avg)} min across ${withDuration.length} completed tasks.`);

    if (sorted.length >= 3) {
      const slowest = sorted[0];
      if (slowest.minutes > avg * 2) {
        insights.push(`Slowest task (${slowest.minutes}m) was ${Math.round(slowest.minutes / avg)}x average — investigate what made it hard.`);
      }
    }

    if (stuck.length > 0) {
      insights.push(`${stuck.length} task${stuck.length > 1 ? 's' : ''} stuck in progress >24h. Either complete or abandon.`);
    }

    // Group by category to find slow categories
    const byCategory: Record<string, number[]> = {};
    for (const t of withDuration) {
      const cat = this.categorizeTaskTitle(t.title);
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(t.minutes);
    }
    const categoryAvgs = Object.entries(byCategory)
      .map(([cat, times]) => ({ cat, avg: times.reduce((s, t) => s + t, 0) / times.length, count: times.length }))
      .filter(c => c.count >= 2)
      .sort((a, b) => b.avg - a.avg);

    if (categoryAvgs.length > 0) {
      const slowest = categoryAvgs[0];
      insights.push(`Slowest category: "${slowest.cat}" averages ${Math.round(slowest.avg)}m (${slowest.count} samples).`);
    }

    return {
      slowTasks: sorted.slice(0, 5),
      fastTasks: sorted.slice(-5).reverse(),
      stuckTasks: stuck,
      averageCompletionMinutes: Math.round(avg),
      insights,
    };
  }

  // Helper: categorize a task title (matches estimator categorization)
  private categorizeTaskTitle(title: string): string {
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

  // ── Decision Guard: warn before creating redundant tasks ───────
  // Returns existing similar work that might overlap with a proposed task title
  checkForRedundancy(taskTitle: string): {
    similarTasks: Array<{ id: number; title: string; status: string; similarity: number }>;
    relatedDecisions: Array<{ id: number; decision: string; project: string }>;
    pastSessions: Array<{ id: number; project: string; summary: string }>;
    warning: string | null;
  } {
    const lower = taskTitle.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) {
      return { similarTasks: [], relatedDecisions: [], pastSessions: [], warning: null };
    }

    // Score similarity by shared significant words
    const score = (text: string): number => {
      const t = text.toLowerCase();
      let count = 0;
      for (const w of words) {
        if (t.includes(w)) count++;
      }
      return count / words.length;
    };

    // Similar tasks (active or recently done)
    const similarTasks = (this.data.tasks || [])
      .map(t => ({ id: t.id, title: t.title, status: t.status, similarity: score(t.title) }))
      .filter(t => t.similarity >= 0.4)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    // Related decisions (search the Ledger)
    const relatedDecisions = (this.data.ledger || [])
      .map(d => ({ id: d.id, decision: d.decision, project: d.project, similarity: score(d.decision + ' ' + (d.context || '')) }))
      .filter(d => d.similarity >= 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
      .map(({ similarity, ...rest }) => rest);

    // Past sessions that touched similar topics
    const pastSessions = (this.data.sessions || [])
      .map(s => ({ id: s.id, project: s.project, summary: s.summary, similarity: score(s.summary + ' ' + s.tags.join(' ')) }))
      .filter(s => s.similarity >= 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map(({ similarity, ...rest }) => rest);

    let warning: string | null = null;
    if (similarTasks.length > 0 && similarTasks[0].similarity >= 0.7) {
      warning = `Very similar existing task: #${similarTasks[0].id} "${similarTasks[0].title}" (${similarTasks[0].status})`;
    } else if (relatedDecisions.length > 0 || similarTasks.length > 0) {
      warning = `Related work exists. Review before creating.`;
    }

    return { similarTasks, relatedDecisions, pastSessions, warning };
  }
}
