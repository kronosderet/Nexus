import type {
  NexusData, Task, ActivityEntry, Session, Scratchpad,
  UsageEntry, GpuSnapshot, Decision, GraphEdge, GraphData,
} from '../types.js';

export declare class NexusStore {
  data: NexusData;
  _lastRiskScan?: {
    risks: any[];
    scannedAt: string;
    critical: number;
    warnings: number;
  };

  constructor();

  _flush(): void;
  _now(): string;

  // Tasks
  getAllTasks(): Task[];
  createTask(opts: { title: string; description?: string; status?: Task['status']; priority?: number }): Task;
  updateTask(id: number, updates: Partial<Task>): { task: Task; old: Task } | null;
  deleteTask(id: number): Task | null;

  // Activity
  getActivity(limit?: number): ActivityEntry[];
  addActivity(type: string, message: string, meta?: Record<string, any>): ActivityEntry;

  // Scratchpads
  getAllScratchpads(): Scratchpad[];
  getScratchpad(id: number): Scratchpad | null;
  createScratchpad(opts: { name: string; content?: string; language?: string }): Scratchpad;
  updateScratchpad(id: number, updates: Partial<Scratchpad>): Scratchpad | null;
  deleteScratchpad(id: number): Scratchpad | null;

  // Usage
  logUsage(opts: { session_percent: number | null; weekly_percent: number | null; note?: string }): UsageEntry;
  getUsage(limit?: number): UsageEntry[];
  getLatestUsage(): UsageEntry | null;

  // GPU
  logGpuSnapshot(snapshot: Omit<GpuSnapshot, 'created_at'>): void;
  getGpuHistory(hours?: number): GpuSnapshot[];

  // Sessions
  getSessions(opts?: { project?: string; limit?: number }): Session[];
  getSession(id: number): Session | null;
  createSession(opts: {
    project: string;
    summary: string;
    decisions?: string[];
    blockers?: string[];
    files_touched?: string[];
    tags?: string[];
  }): Session;
  getSessionContext(project: string, limit?: number): { sessions: Session[]; activeTasks: Task[] };

  // Ledger
  getLedger(opts?: { project?: string; tag?: string; limit?: number }): Decision[];
  recordDecision(opts: {
    decision: string;
    context?: string;
    project?: string;
    alternatives?: string[];
    tags?: string[];
  }): Decision;

  // Knowledge Graph
  addEdge(fromId: number, toId: number, relationship?: GraphEdge['rel'], note?: string): GraphEdge;
  removeEdge(id: number): GraphEdge | null;
  getEdgesFrom(decisionId: number): GraphEdge[];
  getEdgesTo(decisionId: number): GraphEdge[];
  getEdgesFor(decisionId: number): GraphEdge[];
  traverse(startId: number, maxDepth?: number): (Decision & { depth: number; path: any[] })[];
  getGraph(): GraphData;

  // Search
  search(query: string, limit?: number): Array<{
    type: string;
    id: number;
    title: string;
    sub: string;
    score: number;
    created_at: string;
  }>;
}
