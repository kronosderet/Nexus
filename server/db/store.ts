import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  NexusData, Task, ActivityEntry, Session, Scratchpad,
  UsageEntry, GpuSnapshot, Decision, GraphEdge, GraphData, SessionTiming,
  Bookmark, AdviceEntry, Thought, RiskItem,
} from '../types.js';
import { findSimilar } from '../lib/embeddings.ts';
import { scanCCMemories, type MemoryEntry } from '../lib/memoryIndex.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

type IdTable = 'tasks' | 'activity' | 'sessions' | 'scratchpads' | 'bookmarks';

// v4.3.5 P1: typed segment in store.traverse() path — replaces `path: any[]`.
interface TraversePathSegment { edge: GraphEdge['rel']; from: number; to: number }

// Lazy DB path resolution — must be a function, not a const, because
// in the esbuild bundle this module is parsed before localApi.ts can
// set process.env.NEXUS_DB_PATH. Evaluating at call time fixes the race.
function getDbPath() {
  return process.env.NEXUS_DB_PATH || join(__dirname, '..', '..', 'nexus.json');
}
function getBakPath() { return getDbPath() + '.bak'; }
function getBak2Path() { return getDbPath() + '.bak.2'; }
function getTmpPath() { return getDbPath() + '.tmp'; }

export class NexusStore {
  data: NexusData;
  _lastRiskScan?: { risks: RiskItem[]; scannedAt: string; critical: number; warnings: number };
  private _nextId: Record<IdTable, number>;
  private _nextLedgerId = 1;
  private _nextThoughtId = 1;
  private _nextEdgeId = 1;
  private _edgeMutex = false;

  constructor() {
    if (existsSync(getDbPath())) {
      try {
        this.data = JSON.parse(readFileSync(getDbPath(), 'utf-8'));
      } catch (err) {
        // Primary DB corrupted — try backup recovery
        console.error(`◈ WARNING: ${getDbPath()} corrupted (${(err as Error).message}). Attempting backup recovery...`);
        if (existsSync(getBakPath())) {
          try {
            this.data = JSON.parse(readFileSync(getBakPath(), 'utf-8'));
            console.error(`◈ Recovered from ${getBakPath()}. Data may be slightly behind.`);
            // Immediately save the recovered data as the primary
            writeFileSync(getDbPath(), JSON.stringify(this.data, null, 2));
          } catch {
            console.error(`◈ Backup also corrupted. Starting fresh.`);
            this.data = this._seed();
          }
        } else {
          console.error(`◈ No backup found. Starting fresh.`);
          this.data = this._seed();
        }
      }
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
    // v4.3.8 #200 — initialize CC memory import map. Used by importCCMemory/importAllCCMemories.
    if (!this.data._memoryImports) this.data._memoryImports = {};

    const safeMax = (arr: number[]) => arr.reduce((m, v) => v > m ? v : m, 0);
    this._nextId = {
      tasks: safeMax(this.data.tasks.map(t => t.id)) + 1,
      activity: safeMax(this.data.activity.map(a => a.id)) + 1,
      sessions: safeMax(this.data.sessions.map(s => s.id)) + 1,
      scratchpads: safeMax(this.data.scratchpads.map(s => s.id)) + 1,
      bookmarks: safeMax(this.data.bookmarks.map(b => b.id)) + 1,
    };
    this._nextLedgerId = safeMax((this.data.ledger || []).map(e => e.id)) + 1;
    this._nextThoughtId = safeMax((this.data.thoughts || []).map(t => t.id)) + 1;
    this._nextEdgeId = safeMax((this.data.graph_edges || []).map(e => e.id)) + 1;

    // v4.3.5 migration — backfill missing fields from schema drift (idempotent).
    // Runs on every load; does nothing if data is already migrated.
    this._runMigrations();
  }

  /** Idempotent schema migrations — inspect data and backfill missing fields.
   *  v4.3.6 M1: each migration records its ID in `_appliedMigrations` after completion so
   *  subsequent cold-starts skip the scan. Tests can force a re-run by clearing that map. */
  private _runMigrations(): void {
    let changed = 0;
    if (!this.data._appliedMigrations) {
      this.data._appliedMigrations = {};
      changed++;
    }
    const applied = this.data._appliedMigrations;
    const markApplied = (id: string) => { applied[id] = new Date().toISOString(); };

    // v4.3.5 C1: Backfill `project` on tasks (v4.2 added the field but never migrated old tasks).
    const tasksNeedingProject = applied['v4.3.5-C1'] ? [] : this.data.tasks.filter(t => !t.project);
    if (tasksNeedingProject.length > 0) {
      // Build project name lookup from existing decisions (canonical casing).
      const decisionProjectById = new Map<number, string>();
      for (const d of this.data.ledger) {
        if (d.project) decisionProjectById.set(d.id, d.project);
      }
      // Known project names, ordered by specificity (most specific markers first).
      // MYE / Ego Hunter / harmony_field uniquely identify Resonance even though the
      // project shares "P3B" phase-naming with Shadowrun — so Resonance checks first.
      const knownProjects: Array<{ name: string; patterns: RegExp[] }> = [
        { name: 'resonance godot',patterns: [/\bResonance\b/i, /\bharmony_field\b/i, /\bMYE\b/, /\bEgo Hunter\b/i, /\bmoxie\b/i] },
        { name: 'noosphere',      patterns: [/\bNoosphere\b/i, /\bPULSE\b/, /\btensor field\b/i] },
        { name: 'Firewall-Godot', patterns: [/\bfirewall\b/i, /\bEP1e\b/i] },
        { name: 'Level',          patterns: [/\bLevel\b/, /\bbyline\b/i, /\bOCR\b/i, /322 PDF/i] },
        { name: 'Shadowrun',      patterns: [/\bshadowrun\b/i, /\bSR3\b/, /\bP3B\b/, /\bC\d+\b.*\b(BF|FA|TN|damage)\b/] },
        { name: 'family-coop',    patterns: [/\bfamily[- ]coop\b/i] },
        { name: 'Nexus',          patterns: [/\bnexus\b/i, /\bv4\.\d/i, /\bmcp\b/i, /\bmcpb\b/i] },
      ];
      const inferProject = (t: Task): string => {
        // 1. From decision_ids (most authoritative)
        if (Array.isArray(t.decision_ids) && t.decision_ids.length > 0) {
          const projects = t.decision_ids
            .map((id: number) => decisionProjectById.get(id))
            .filter(Boolean) as string[];
          if (projects.length > 0) {
            // Most common
            const counts: Record<string, number> = {};
            for (const p of projects) counts[p] = (counts[p] || 0) + 1;
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
          }
        }
        // 2. Pattern-match against title + description
        const haystack = `${t.title || ''} ${t.description || ''}`;
        for (const kp of knownProjects) {
          if (kp.patterns.some(p => p.test(haystack))) return kp.name;
        }
        // 3. Default
        return 'Nexus';
      };
      for (const t of tasksNeedingProject) {
        t.project = inferProject(t);
        changed++;
      }
      console.error(`◈ Migration v4.3.5 C1: backfilled \`project\` on ${tasksNeedingProject.length} tasks.`);
      markApplied('v4.3.5-C1');
    } else if (!applied['v4.3.5-C1']) {
      // No tasks needed backfill — still mark applied so we don't rescan on every load.
      markApplied('v4.3.5-C1');
    }

    // v4.3.5 I1: Backfill `lifecycle` on ledger decisions (108/154 lacked it pre-patch).
    // Heuristic: high-centrality (degree ≥3) → validated, recent (<14d) → proposed, else → active.
    const decisionsNeedingLifecycle = applied['v4.3.5-I1'] ? [] : this.data.ledger.filter(d => !d.lifecycle);
    if (decisionsNeedingLifecycle.length > 0) {
      const degreeByDecision = new Map<number, number>();
      for (const e of this.data.graph_edges) {
        degreeByDecision.set(e.from, (degreeByDecision.get(e.from) || 0) + 1);
        degreeByDecision.set(e.to,   (degreeByDecision.get(e.to)   || 0) + 1);
      }
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      for (const d of decisionsNeedingLifecycle) {
        const degree = degreeByDecision.get(d.id) || 0;
        const ageDays = (now - new Date(d.created_at).getTime()) / 86400000;
        if (d.deprecated) d.lifecycle = 'deprecated';
        else if (degree >= 3) d.lifecycle = 'validated';
        else if (ageDays < 14) d.lifecycle = 'proposed';
        else d.lifecycle = 'active';
        if (!d.last_reviewed_at) d.last_reviewed_at = nowIso;
        changed++;
      }
      console.error(`◈ Migration v4.3.5 I1: backfilled \`lifecycle\` on ${decisionsNeedingLifecycle.length} decisions.`);
      markApplied('v4.3.5-I1');
    } else if (!applied['v4.3.5-I1']) {
      markApplied('v4.3.5-I1');
    }

    // v4.3.9 H1: combined hygiene migration — fixes three data-quality bugs the UI audit surfaced.
    //   #222 Encoding mojibake: U+FFFD replacement chars in task titles (em-dash loss on import)
    //   #245 Blank project names: sessions logged without project leak as ": 10d" on Fleet staleness
    //   #273 Case inconsistency: DIREWOLF vs direwolf across task/session/decision records,
    //        plus "Projects" (cap P) leaking in from CC encoded-dir names (not a real project)
    // One pass, one apply, all three resolved. Idempotent via _appliedMigrations.
    if (!applied['v4.3.9-H1']) {
      const mojibake = /\uFFFD/g;
      let mojibakeFixed = 0;
      let blanksFixed = 0;
      let casingFixed = 0;

      // Project-name normalization map. Keys are case-sensitive exact matches.
      // DIREWOLF was captured as uppercase in some sessions; canonical is lowercase.
      // "Projects" (cap P) comes from CC's encoded-dir naming (~/.claude/projects/...) and
      //   was never meant to be a project label — route it to "general".
      const projectCaseMap = new Map<string, string>([
        ['DIREWOLF', 'direwolf'],
        ['Projects', 'general'],
      ]);
      const normalizeProject = (p: string | undefined): { value: string | undefined; changed: boolean } => {
        if (!p) return { value: p, changed: false };
        const mapped = projectCaseMap.get(p);
        if (mapped && mapped !== p) return { value: mapped, changed: true };
        return { value: p, changed: false };
      };

      // (a) Mojibake scrub across tasks + decisions (title, description, decision text, context).
      for (const t of this.data.tasks) {
        if (t.title && mojibake.test(t.title)) { t.title = t.title.replace(mojibake, '—'); mojibakeFixed++; }
        if (t.description && mojibake.test(t.description)) { t.description = t.description.replace(mojibake, '—'); mojibakeFixed++; }
      }
      for (const d of this.data.ledger || []) {
        if (d.decision && mojibake.test(d.decision)) { d.decision = d.decision.replace(mojibake, '—'); mojibakeFixed++; }
        if (d.context && mojibake.test(d.context)) { d.context = d.context.replace(mojibake, '—'); mojibakeFixed++; }
      }

      // (b) Blank-project normalization: sessions and tasks/decisions with empty/whitespace project.
      for (const s of this.data.sessions || []) {
        if (!s.project || !s.project.trim()) { s.project = 'general'; blanksFixed++; }
      }
      for (const t of this.data.tasks) {
        if (!t.project || !t.project.trim()) { t.project = 'general'; blanksFixed++; }
      }
      for (const d of this.data.ledger || []) {
        if (!d.project || !d.project.trim()) { d.project = 'general'; blanksFixed++; }
      }

      // (c) Casing normalization across tasks/sessions/decisions.
      for (const t of this.data.tasks) {
        const n = normalizeProject(t.project);
        if (n.changed) { t.project = n.value!; casingFixed++; }
      }
      for (const s of this.data.sessions || []) {
        const n = normalizeProject(s.project);
        if (n.changed) { s.project = n.value!; casingFixed++; }
      }
      for (const d of this.data.ledger || []) {
        const n = normalizeProject(d.project);
        if (n.changed) { d.project = n.value!; casingFixed++; }
      }

      if (mojibakeFixed > 0 || blanksFixed > 0 || casingFixed > 0) {
        console.error(`◈ Migration v4.3.9 H1: scrubbed ${mojibakeFixed} mojibake chars, ${blanksFixed} blank projects, ${casingFixed} casing issues.`);
        changed += mojibakeFixed + blanksFixed + casingFixed;
      }
      markApplied('v4.3.9-H1');
    }

    // v4.4.0 H2 — second hygiene pass catching residue v4.3.9-H1 didn't touch.
    // Observed in the beta SessionStart hook output: "Fleet uncommitted: Nexus: 1 · nexus: 1"
    // means the sessions log contains BOTH case variants of "Nexus" as distinct project keys.
    // This extends the casing-normalization map with the lowercase-first-letter pattern and
    // does one more sweep. Any future drift gets added here.
    if (!applied['v4.4.0-H2']) {
      const caseMapV2 = new Map<string, string>([
        // "nexus" (lowercase, from hook's detectProject reading pkg.json "name") → "Nexus"
        ['nexus', 'Nexus'],
      ]);
      const normalize = (p: string | undefined): { value: string | undefined; changed: boolean } => {
        if (!p) return { value: p, changed: false };
        const mapped = caseMapV2.get(p);
        if (mapped && mapped !== p) return { value: mapped, changed: true };
        return { value: p, changed: false };
      };
      let casingFixedV2 = 0;
      for (const t of this.data.tasks) {
        const n = normalize(t.project);
        if (n.changed) { t.project = n.value!; casingFixedV2++; }
      }
      for (const s of this.data.sessions || []) {
        const n = normalize(s.project);
        if (n.changed) { s.project = n.value!; casingFixedV2++; }
      }
      for (const d of this.data.ledger || []) {
        const n = normalize(d.project);
        if (n.changed) { d.project = n.value!; casingFixedV2++; }
      }
      if (casingFixedV2 > 0) {
        console.error(`◈ Migration v4.4.0 H2: normalized ${casingFixedV2} 'nexus' → 'Nexus' casing issues.`);
        changed += casingFixedV2;
      }
      markApplied('v4.4.0-H2');
    }

    // v4.4.1 H3 — prune auto-linked edges from the generic-tag explosion (#314 audit).
    // The v4.3.x auto-link route linked any two decisions sharing a tag cross-project,
    // without filtering generic tags like "milestone" or "github" that every project uses.
    // That manufactured ~68 noise edges between Nexus ↔ Firewall-Godot alone. v4.4.1
    // added a blacklist to the auto-linker; this migration cleans up the residue at rest.
    if (!applied['v4.4.1-H3']) {
      const genericTagsSet = new Set([
        'milestone', 'shipped', 'released', 'release', 'audit', 'polish',
        'github', 'git', 'hygiene-migration', 'version', 'versioning',
      ]);
      const isGeneric = (tag: string) => genericTagsSet.has(tag.toLowerCase()) || /^v\d/i.test(tag);
      const before = (this.data.graph_edges || []).length;
      this.data.graph_edges = (this.data.graph_edges || []).filter(e => {
        const match = /^Shared tag:\s*(.+)$/.exec(e.note || '');
        if (!match) return true;
        return !isGeneric(match[1].trim());
      });
      const pruned = before - this.data.graph_edges.length;
      if (pruned > 0) {
        console.error(`◈ Migration v4.4.1 H3: pruned ${pruned} generic-tag cross-project edges (milestone / github / etc.).`);
        changed += pruned;
      }
      markApplied('v4.4.1-H3');
    }

    if (changed > 0) this._flush();
  }

  /** Re-read data from disk (for external changes, e.g. MCP writes while dashboard is running). */
  reload(): boolean {
    if (!existsSync(getDbPath())) return false;
    try {
      const raw = readFileSync(getDbPath(), 'utf-8');
      const data = JSON.parse(raw);
      this.data = data;
      // Recalculate ID counters
      const safeMax = (arr: number[]) => arr.reduce((m, v) => v > m ? v : m, 0);
      this._nextId = {
        tasks: safeMax((data.tasks || []).map((t: Task) => t.id)) + 1,
        activity: safeMax((data.activity || []).map((a: ActivityEntry) => a.id)) + 1,
        sessions: safeMax((data.sessions || []).map((s: Session) => s.id)) + 1,
        scratchpads: safeMax((data.scratchpads || []).map((s: Scratchpad) => s.id)) + 1,
        bookmarks: safeMax((data.bookmarks || []).map((b: Bookmark) => b.id)) + 1,
      };
      this._nextLedgerId = safeMax((data.ledger || []).map((e: Decision) => e.id)) + 1;
      this._nextThoughtId = safeMax((data.thoughts || []).map((t: Thought) => t.id)) + 1;
      this._nextEdgeId = safeMax((data.graph_edges || []).map((e: GraphEdge) => e.id)) + 1;
      return true;
    } catch {
      return false;
    }
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

  private _flushing = false;
  private _pendingSemanticLinks = 0;
  _flush(): void {
    // Write mutex: skip if already flushing (prevents concurrent truncation)
    if (this._flushing) return;
    this._flushing = true;
    try {
      const json = JSON.stringify(this.data, null, 2);
      // Atomic write: write to .tmp first, then promote via rename
      writeFileSync(getTmpPath(), json);
      // Rotate backups with rollback safety
      let rotatedBak = false;
      try {
        if (existsSync(getBakPath())) { renameSync(getBakPath(), getBak2Path()); rotatedBak = true; }
      } catch {}
      try {
        if (existsSync(getDbPath())) renameSync(getDbPath(), getBakPath());
      } catch (err) {
        // Rollback: restore BAK from BAK2 if we moved it
        if (rotatedBak && existsSync(getBak2Path())) {
          try { renameSync(getBak2Path(), getBakPath()); } catch {}
        }
        throw err;
      }
      // Promote tmp → primary (atomic on same filesystem)
      try {
        renameSync(getTmpPath(), getDbPath());
      } catch (err) {
        // Recovery: .tmp has valid data but rename failed — try copy fallback
        try { writeFileSync(getDbPath(), json); } catch {}
        throw err;
      }
    } finally {
      this._flushing = false;
    }
  }
  private _id(table: IdTable): number { return this._nextId[table]++; }
  _now(): string { return new Date().toISOString(); }

  // ── Typed accessors for Ledger / Graph / Timing ────────
  // These replace (store as any).data.* casts in route files.
  getAllDecisions(): Decision[] { return this.data.ledger || []; }
  // v4.3.8 #200 — exclude 'reference' (imported CC memories) from active decisions so
  // they don't pollute briefs, centrality counts, or the default Ledger surface. They
  // remain searchable and link-targetable via getAllDecisions / getLedger({ tag }).
  getActiveDecisions(): Decision[] { return (this.data.ledger || []).filter(d => !d.deprecated && d.lifecycle !== 'deprecated' && d.lifecycle !== 'reference'); }
  getDecisionById(id: number): Decision | null { return (this.data.ledger || []).find(d => d.id === id) || null; }
  deprecateDecision(id: number): Decision | null {
    const d = this.getDecisionById(id);
    if (!d) return null;
    d.deprecated = true;
    d.lifecycle = 'deprecated';
    this._flush();
    return d;
  }
  updateDecision(id: number, updates: Partial<Pick<Decision, 'decision' | 'context' | 'alternatives' | 'tags' | 'project' | 'lifecycle' | 'confidence' | 'last_reviewed_at'>>): Decision | null {
    const d = this.getDecisionById(id);
    if (!d) return null;
    if (updates.decision != null) d.decision = updates.decision;
    if (updates.context != null) d.context = updates.context;
    if (updates.alternatives != null) d.alternatives = updates.alternatives;
    if (updates.tags != null) d.tags = updates.tags;
    if (updates.project != null) d.project = updates.project;
    if (updates.lifecycle != null) { d.lifecycle = updates.lifecycle; d.deprecated = updates.lifecycle === 'deprecated'; }
    if (updates.confidence != null) d.confidence = updates.confidence;
    if (updates.last_reviewed_at != null) d.last_reviewed_at = updates.last_reviewed_at;
    this._flush();
    return d;
  }
  getDecisionCount(): number { return (this.data.ledger || []).length; }
  getAllEdges(): GraphEdge[] { return this.data.graph_edges || []; }
  getEdgeCount(): number { return (this.data.graph_edges || []).length; }
  getSessionTiming(): SessionTiming | undefined { return this.data._sessionTiming; }
  setSessionTiming(timing: SessionTiming): void { this.data._sessionTiming = timing; this._flush(); }
  getFuelConfig(): import('../types.js').FuelConfig | undefined { return this.data._fuelConfig; }
  setFuelConfig(config: import('../types.js').FuelConfig): void { this.data._fuelConfig = config; this._flush(); }
  getScheduledScans(type?: string, limit = 10): import('../types.js').ScheduledScan[] {
    const scans = this.data._scheduledScans || [];
    const filtered = type ? scans.filter(s => s.type === type) : scans;
    return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  }
  addScheduledScan(scan: import('../types.js').ScheduledScan): void {
    if (!this.data._scheduledScans) this.data._scheduledScans = [];
    this.data._scheduledScans.push(scan);
    // Keep last 50 scans max
    if (this.data._scheduledScans.length > 50) this.data._scheduledScans = this.data._scheduledScans.slice(-50);
    this._flush();
  }

  // ── Tasks ──────────────────────────────────────────────
  getAllTasks(): Task[] {
    return [...this.data.tasks].sort((a, b) => a.sort_order - b.sort_order);
  }

  createTask({ title, description = '', status = 'backlog', priority = 0, decision_ids, project }: {
    title: string; description?: string; status?: Task['status']; priority?: number; decision_ids?: number[]; project?: string;
  }): Task {
    const maxOrder = this.data.tasks.reduce((max, t) => t.status === status && t.sort_order > max ? t.sort_order : max, 0);
    const task: Task = {
      id: this._id('tasks'), title, description, status, priority,
      sort_order: maxOrder + 1, linked_files: '[]',
      // v4.3.5 C1: persist project on creation so the backfill migration doesn't have to re-run.
      project: project || 'Nexus',
      ...(decision_ids?.length ? { decision_ids } : {}),
      created_at: this._now(), updated_at: this._now(),
    };
    this.data.tasks.push(task);
    this._flush();
    return task;
  }

  updateTask(id: number, updates: Partial<Task>): { task: Task; old: Task; resolvedThoughts?: number } | null {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const old = { ...this.data.tasks[idx] };
    this.data.tasks[idx] = { ...old, ...updates, id, updated_at: this._now() } as Task;
    // Auto-resolve thoughts linked to this task when marked done
    let resolvedThoughts = 0;
    if (updates.status === 'done') {
      for (const t of (this.data.thoughts || [])) {
        if (t.status === 'active' && t.related_task_id === id) {
          t.status = 'resolved';
          t.popped_at = this._now();
          resolvedThoughts++;
        }
      }
    }
    this._flush();
    return { task: this.data.tasks[idx], old, resolvedThoughts };
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

  addActivity(type: string, message: string, meta: Record<string, unknown> = {}): ActivityEntry {
    const entry: ActivityEntry = {
      id: this._id('activity'), type, message,
      meta: JSON.stringify(meta), created_at: this._now(),
    };
    this.data.activity.push(entry);
    // Keep last 500 active entries; bump cap to 750 to reduce loss frequency
    if (this.data.activity.length > 750) this.data.activity = this.data.activity.slice(-500);
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
    const removed = this.data.scratchpads.splice(idx, 1)[0];
    this._flush();
    return removed;
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
  logUsage({ session_percent, weekly_percent, sonnet_weekly_percent, extra_usage, note = '' }: {
    session_percent: number | null; weekly_percent: number | null;
    sonnet_weekly_percent?: number | null; extra_usage?: boolean; note?: string;
  }): UsageEntry {
    const entry: UsageEntry = {
      session_percent, weekly_percent, note, created_at: this._now(),
      ...(sonnet_weekly_percent != null ? { sonnet_weekly_percent } : {}),
      ...(extra_usage != null ? { extra_usage } : {}),
    };
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

  createSession({ project, summary, decisions = [], blockers = [], files_touched = [], tags = [], completed_task_ids }: {
    project: string; summary: string; decisions?: string[]; blockers?: string[];
    files_touched?: string[]; tags?: string[]; completed_task_ids?: number[];
  }): Session {
    const session: Session = {
      id: this._id('sessions'), project, summary, decisions, blockers,
      files_touched, tags,
      ...(completed_task_ids?.length ? { completed_task_ids } : {}),
      created_at: this._now(),
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

  /** Record that a task was completed during the most recent session today. */
  recordTaskCompletion(taskId: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const session = [...this.data.sessions]
      .filter(s => s.created_at.startsWith(today))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (!session) return;
    if (!session.completed_task_ids) session.completed_task_ids = [];
    if (!session.completed_task_ids.includes(taskId)) {
      session.completed_task_ids.push(taskId);
      this._flush();
    }
  }

  /** Link an advice entry to a decision it led to. */
  linkAdviceToDecision(adviceId: number, decisionId: number): AdviceEntry | null {
    const idx = (this.data.advice || []).findIndex(a => a.id === adviceId);
    if (idx === -1) return null;
    // AdviceEntry.decision_id is already typed (number?) in types.ts — no cast needed.
    this.data.advice[idx].decision_id = decisionId;
    this._flush();
    return this.data.advice[idx];
  }

  /** Cross-project priority matrix: rank all open tasks by urgency. */
  getFleetOverview(): { topTasks: Array<Task & { score: number; ageDays: number }>; staleness: Record<string, number> } {
    const tasks = this.data.tasks.filter(t => t.status !== 'done');
    const now = Date.now();
    // Project staleness: days since last session
    const staleness: Record<string, number> = {};
    const projects = new Set<string>();
    for (const s of this.data.sessions) projects.add(s.project.toLowerCase());
    for (const proj of projects) {
      const latest = this.data.sessions
        .filter(s => s.project.toLowerCase() === proj)
        .reduce((best, s) => {
          const t = Date.parse(s.created_at);
          return t > best ? t : best;
        }, 0);
      staleness[proj] = latest ? Math.floor((now - latest) / 86400000) : 999;
    }
    // Score tasks
    const scored = tasks.map(t => {
      const ageDays = Math.floor((now - Date.parse(t.created_at)) / 86400000);
      const ageFactor = Math.min(3, 1 + ageDays / 7);
      const proj = (t.title.match(/\[(\w+)\]/)?.[1] || 'general').toLowerCase();
      const staleFactor = Math.min(2, 1 + (staleness[proj] || 0) / 14);
      const score = Math.round((t.priority + 1) * ageFactor * staleFactor * 100) / 100;
      return { ...t, score, ageDays };
    });
    scored.sort((a, b) => b.score - a.score);
    return { topTasks: scored.slice(0, 15), staleness };
  }

  // ── Ledger ─────────────────────────────────────────────
  getLedger({ project, tag, limit = 50 }: { project?: string; tag?: string; limit?: number } = {}): Decision[] {
    let entries = [...this.data.ledger];
    if (project) entries = entries.filter(e => e.project.toLowerCase() === project.toLowerCase());
    if (tag) entries = entries.filter(e => (e.tags || []).includes(tag));
    return entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
  }

  recordDecision({ decision, context = '', project = 'general', alternatives = [], tags = [], lifecycle = 'active', autoLink = true }: {
    decision: string; context?: string; project?: string; alternatives?: string[]; tags?: string[];
    // v4.3.8 #200 — let callers set lifecycle explicitly (was hardcoded 'active'). Needed for
    // bulk imports of CC memories as 'reference', and future 'proposed' creation from overseer.
    lifecycle?: Decision['lifecycle'];
    // v4.3.8 #200 — skip auto-linking for bulk imports. Default preserves existing behavior.
    // Without this, importing ~50 memories would manufacture hundreds of noisy `related` edges.
    autoLink?: boolean;
  }): Decision {
    if (!this.data.ledger) this.data.ledger = [];
    const entry: Decision = {
      id: this._nextLedgerId++,
      decision, context, project, alternatives, tags, created_at: this._now(),
      lifecycle,
    };
    this.data.ledger.push(entry);
    // Auto-link: find related decisions by keyword overlap (+ async semantic link).
    if (autoLink) this._autoLinkDecision(entry);
    this._flush();
    return entry;
  }

  // ── Memory Bridge import (v4.3.8 #200) ───────────────
  // Imports CC's auto-memory files (scanned via lib/memoryIndex.ts) as reference
  // decisions in the Ledger. Dedup via _memoryImports map. Handles mtime drift by
  // updating linked decisions rather than creating duplicates.

  /** Build the `context` body for a reference decision from a MemoryEntry. */
  private _buildMemoryContext(entry: MemoryEntry): string {
    const parts: string[] = [];
    if (entry.description) parts.push(entry.description);
    if (entry.snippet) parts.push(entry.snippet);
    parts.push(`[Imported from ${entry.path}]`);
    return parts.join('\n\n').slice(0, 600);
  }

  /** Import a single MemoryEntry as a 'reference' Decision. Idempotent via _memoryImports map.
   *  Returns action: 'imported' (new), 'updated' (mtime drifted or force), 'skipped' (no change). */
  importCCMemory(entry: MemoryEntry, opts: { force?: boolean } = {}): { decision: Decision; action: 'imported' | 'updated' | 'skipped' } {
    if (!this.data._memoryImports) this.data._memoryImports = {};
    const existing = this.data._memoryImports[entry.path];
    const newTitle = `[${entry.type}] ${entry.name}`.slice(0, 200);
    const newContext = this._buildMemoryContext(entry);

    if (existing) {
      const decision = this.getDecisionById(existing.decisionId);
      if (!decision) {
        // Stale map entry — underlying decision was deleted. Clear and re-import fresh.
        delete this.data._memoryImports[entry.path];
      } else if (!opts.force && existing.mtime === entry.mtime) {
        // No drift, no force — skip
        return { decision, action: 'skipped' };
      } else {
        // Update in place
        decision.decision = newTitle;
        decision.context = newContext;
        decision.last_reviewed_at = this._now();
        this.data._memoryImports[entry.path] = { decisionId: decision.id, mtime: entry.mtime };
        this._flush();
        return { decision, action: 'updated' };
      }
    }

    // Fresh import — recordDecision with autoLink disabled to avoid graph spam.
    const decision = this.recordDecision({
      decision: newTitle,
      context: newContext,
      project: entry.project || 'general',
      tags: ['cc-memory', entry.type, entry.encodedProject],
      lifecycle: 'reference',
      autoLink: false,
    });
    this.data._memoryImports[entry.path] = { decisionId: decision.id, mtime: entry.mtime };
    this._flush();
    return { decision, action: 'imported' };
  }

  /** Scan all CC memory files and import as reference decisions. Idempotent.
   *  dryRun: report counts + samples without writing.
   *  force: re-import even if already tracked (refresh content).
   *  project: only import memories whose inferred project matches (case-insensitive). */
  importAllCCMemories(opts: { dryRun?: boolean; force?: boolean; project?: string } = {}): {
    imported: number; skipped: number; updated: number; failed: number;
    totalScanned: number; dryRun: boolean;
    samples: Array<{ path: string; project: string | null; type: string; name: string; action: string }>;
  } {
    const index = scanCCMemories(9999);
    const baseResult = { imported: 0, skipped: 0, updated: 0, failed: 0, totalScanned: 0, dryRun: !!opts.dryRun, samples: [] as Array<{ path: string; project: string | null; type: string; name: string; action: string }> };
    if (!index.available) return baseResult;

    let memories = index.memories;
    if (opts.project) {
      const target = opts.project.toLowerCase();
      memories = memories.filter(m => (m.project || '').toLowerCase() === target);
    }

    const counts = { imported: 0, skipped: 0, updated: 0, failed: 0 };
    const samples: Array<{ path: string; project: string | null; type: string; name: string; action: string }> = [];
    const importsMap = this.data._memoryImports || {};

    for (const entry of memories) {
      try {
        let action: 'imported' | 'updated' | 'skipped';
        if (opts.dryRun) {
          const existing = importsMap[entry.path];
          if (!existing) action = 'imported';
          else if (!opts.force && existing.mtime === entry.mtime) action = 'skipped';
          else action = 'updated';
        } else {
          ({ action } = this.importCCMemory(entry, { force: opts.force }));
        }
        counts[action]++;
        if (samples.length < 8 && action !== 'skipped') {
          samples.push({ path: entry.path, project: entry.project, type: entry.type, name: entry.name, action });
        }
      } catch (err) {
        counts.failed++;
        if (process.env.NEXUS_DEBUG) {
          console.warn(`[memory-import] failed for ${entry.path}:`, (err as Error).message);
        }
      }
    }

    return { ...counts, totalScanned: memories.length, dryRun: !!opts.dryRun, samples };
  }

  /** Auto-link a new decision to existing ones via semantic + keyword similarity. */
  private _autoLinkDecision(newDec: Decision): GraphEdge[] {
    const linked: GraphEdge[] = [];

    // Fire-and-forget semantic linking (async, doesn't block recordDecision)
    // Capped: skip if too many already in flight to prevent promise accumulation
    if (this._pendingSemanticLinks < 3) {
      this._pendingSemanticLinks++;
      this._semanticAutoLink(newDec)
        .catch(() => {})
        .finally(() => { this._pendingSemanticLinks--; });
    }

    // Synchronous keyword fallback (always runs, immediate)
    const newWords = this._significantWords(newDec.decision + ' ' + newDec.context);
    if (newWords.size < 2) return linked;

    for (const existing of this.data.ledger) {
      if (existing.id === newDec.id || existing.deprecated) continue;
      const existWords = this._significantWords(existing.decision + ' ' + (existing.context || ''));
      let shared = 0;
      for (const w of newWords) if (existWords.has(w)) shared++;
      const similarity = shared / Math.max(newWords.size, 1);
      if (similarity < 0.3) continue;
      const alreadyLinked = this.data.graph_edges.some(
        e => (e.from === newDec.id && e.to === existing.id) || (e.from === existing.id && e.to === newDec.id)
      );
      if (alreadyLinked) continue;
      const edge = this.addEdge(newDec.id, existing.id, 'related',
        `auto-linked (${Math.round(similarity * 100)}% keyword overlap)`
      );
      linked.push(edge);
      if (linked.length >= 5) break;
    }
    return linked;
  }

  /** Semantic auto-link via embeddings (async, non-blocking, mutex-guarded). */
  private async _semanticAutoLink(newDec: Decision): Promise<void> {
    const others = this.data.ledger.filter(d => d.id !== newDec.id && !d.deprecated);
    if (others.length === 0) return;

    const queryText = `${newDec.decision} ${newDec.context || ''}`;
    const candidateTexts = others.map(d => `${d.decision} ${d.context || ''}`);

    const similar = await findSimilar(queryText, candidateTexts, 5, 0.55);

    // Acquire edge mutex to prevent concurrent graph_edges corruption
    while (this._edgeMutex) await new Promise(r => setTimeout(r, 10));
    this._edgeMutex = true;
    try {
      for (const match of similar) {
        const existing = others[match.index];
        const alreadyLinked = this.data.graph_edges.some(
          e => (e.from === newDec.id && e.to === existing.id) || (e.from === existing.id && e.to === newDec.id)
        );
        if (alreadyLinked) continue;
        this.addEdge(newDec.id, existing.id, 'related',
          `semantic-linked (${Math.round(match.similarity * 100)}% cosine similarity)`
        );
      }
    } finally {
      this._edgeMutex = false;
    }
  }

  /** Extract significant words (>3 chars, lowercased, deduped) from text. */
  private _significantWords(text: string): Set<string> {
    const stopwords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'will', 'should', 'could', 'would', 'about', 'into', 'more', 'also', 'than', 'them', 'then', 'each', 'when', 'which', 'their', 'does', 'were', 'what', 'some', 'other', 'over', 'only', 'very', 'just', 'because', 'through', 'after', 'before', 'between', 'under']);
    return new Set(
      text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopwords.has(w))
    );
  }

  // ── Knowledge Graph ────────────────────────────────────
  addEdge(fromId: number, toId: number, relationship: GraphEdge['rel'] = 'related', note = ''): GraphEdge {
    const exists = this.data.graph_edges.find(e => e.from === fromId && e.to === toId && e.rel === relationship);
    if (exists) return exists;
    const edge: GraphEdge = { id: this._nextEdgeId++, from: fromId, to: toId, rel: relationship, note, created_at: this._now() };
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

  traverse(startId: number, maxDepth = 3): (Decision & { depth: number; path: TraversePathSegment[] })[] {
    const visited = new Set<number>();
    const result: (Decision & { depth: number; path: TraversePathSegment[] })[] = [];
    const queue: { id: number; depth: number; path: TraversePathSegment[] }[] = [{ id: startId, depth: 0, path: [] }];

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
      nodes: this.data.ledger.map(d => ({ id: d.id, label: d.decision.slice(0, 50), project: d.project, tags: d.tags || [], lifecycle: d.lifecycle })),
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
      id: this._nextThoughtId++,
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
      // Find most recent active thought without sorting entire array
      let latest: Thought | undefined;
      let latestTime = 0;
      for (const t of thoughts) {
        if (t.status !== 'active') continue;
        const time = new Date(t.pushed_at).getTime();
        if (time > latestTime) { latestTime = time; latest = t; }
      }
      target = latest;
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

    const now = Date.now();
    const withDuration = completed.map(t => {
      const created = Date.parse(t.created_at);
      const updated = Date.parse(t.updated_at);
      return { id: t.id, title: t.title, status: t.status, minutes: Math.round((updated - created) / 60000) };
    }).filter(t => t.minutes >= 0 && t.minutes < 24 * 60); // sanity bounds

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
        ageHours: Math.round((now - Date.parse(t.created_at)) / 3600000),
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
