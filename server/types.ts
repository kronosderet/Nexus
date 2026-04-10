// ── Core data types for Nexus ──────────────────────────

export interface Task {
  id: number;
  title: string;
  description: string;
  status: 'backlog' | 'in_progress' | 'review' | 'done';
  priority: number;
  sort_order: number;
  linked_files: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityEntry {
  id: number;
  type: string;
  message: string;
  meta: string;
  created_at: string;
}

export interface Session {
  id: number;
  project: string;
  summary: string;
  decisions: string[];
  blockers: string[];
  files_touched: string[];
  tags: string[];
  created_at: string;
}

export interface Scratchpad {
  id: number;
  name: string;
  content: string;
  language: string;
  updated_at: string;
}

export interface UsageEntry {
  session_percent: number | null;
  weekly_percent: number | null;
  note: string;
  created_at: string;
}

export interface GpuSnapshot {
  gpu_util: number;
  mem_util: number;
  vram_used: number;
  vram_total: number;
  temperature: number;
  power: number;
  created_at: string;
}

export interface Decision {
  id: number;
  decision: string;
  context: string;
  project: string;
  alternatives: string[];
  tags: string[];
  created_at: string;
  deprecated?: boolean;
}

export interface GraphEdge {
  id: number;
  from: number;
  to: number;
  rel: 'led_to' | 'replaced' | 'depends_on' | 'contradicts' | 'related';
  note: string;
  created_at: string;
}

export interface SessionTiming {
  startTime: string;
  resetTime: string;
  resetSource?: 'user' | 'estimated';
}

export interface Bookmark {
  id: number;
  title: string;
  url: string;
  category: string;
  created_at: string;
}

export interface Thought {
  id: number;
  text: string;            // what was I thinking / about to do
  context: string;         // what was happening when I got interrupted
  project: string;
  pushed_at: string;       // when stashed
  popped_at: string | null; // when returned to (null = still on stack)
  status: 'active' | 'resolved' | 'abandoned';
  related_task_id: number | null; // optional link to a task
}

export interface AdviceEntry {
  id: number;
  created_at: string;
  source: 'overseer' | 'plan' | 'ask' | 'forecast' | 'predict';
  question: string;           // what the agent asked, or empty for unsolicited analysis
  recommendation: string;     // what Overseer said
  recommendation_hash: string; // first-100-chars hash for dedup
  context_snapshot: {         // minimal state when advice was given
    session_fuel: number | null;
    weekly_fuel: number | null;
    open_tasks: number;
    in_progress_tasks: number;
    recent_decisions: number;
  };
  // User verdict (filled in later via nexus advice verdict <id> ...)
  accepted: boolean | null;       // did we follow the advice?
  outcome: 'worked' | 'partial' | 'wrong' | null;
  notes: string;                  // why, or what happened
  measured_fuel_cost: number | null; // actual session% burned after accepting
}

// ── Store data shape ───────────────────────────────────

export interface NexusData {
  tasks: Task[];
  activity: ActivityEntry[];
  sessions: Session[];
  usage: UsageEntry[];
  gpu_history: GpuSnapshot[];
  scratchpads: Scratchpad[];
  bookmarks: Bookmark[];
  ledger: Decision[];
  graph_edges: GraphEdge[];
  advice: AdviceEntry[];
  thoughts: Thought[];
  _sessionTiming?: SessionTiming;
}

// ── API response types ─────────────────────────────────

export interface GraphData {
  nodes: { id: number; label: string; project: string; tags: string[] }[];
  edges: { id: number; from: number; to: number; rel: string; note: string }[];
}

export interface TimingInfo {
  now: string;
  timezone: string;
  session: {
    type: string;
    windowHours: number;
    startedAt: string | null;
    resetsAt?: string;
    countdown: string;
    countdownMs: number;
    elapsed?: string;
    elapsedMs?: number;
    expired?: boolean;
  };
  weekly: {
    resetsAt: string;
    nextReset: string;
    countdown: string;
    countdownMs: number;
  };
}

export interface FuelEstimate {
  tracked: boolean;
  reported?: {
    session: number;
    weekly: number;
    at: string;
    minutesAgo: number;
  };
  estimated?: {
    session: number;
    weekly: number;
    confidence: 'high' | 'medium' | 'low';
  };
  rates?: {
    sessionPerHour: number;
    weeklyPerHour: number;
    sessionPerMinute: number;
  };
  session?: {
    constrainingFactor: string;
    minutesRemaining: number | null;
    hoursRemaining: number | null;
    chunksRemaining: number | null;
    emptyAt: string | null;
    resetWindow: number | null;
  };
  weekly?: {
    remaining: number;
    sessionsLeft: number;
    note: string;
  };
}

export interface RiskItem {
  level: 'critical' | 'warning' | 'info';
  category: string;
  project?: string;
  message: string;
  fix?: { cmd: string; label: string; action?: string; project?: string; param?: string };
}

export interface WorkloadPlan {
  currentSession?: {
    fuel: number;
    constraint: string;
    minutesRemaining: number;
    taskCapacity: Record<string, { count: number; label: string; fuelEach: number }>;
    recommendation: {
      action: string;
      message: string;
      suggested: string[];
    };
  };
  weeklyOutlook?: {
    remaining: number;
    sessionsLeft: number;
    note: string;
  };
}
