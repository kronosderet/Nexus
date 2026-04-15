#!/usr/bin/env node
/**
 * Nexus MCP Server — v3.3
 *
 * Exposes the Nexus metabrain as Model Context Protocol tools so every
 * Claude Code instance can call native `mcp__nexus__*` tools instead of
 * shelling out to the CLI or fetching the HTTP API.
 *
 * Architecture: this is a thin stdio adapter. The actual logic lives in
 * the Express server at http://localhost:3001. We just translate MCP
 * tool calls into HTTP requests against that server. If the Nexus server
 * isn't running, tool calls return a clear error telling the user to
 * start it.
 *
 * v3.2.1: Progress notifications for slow tools. When the client sends a
 * progressToken in the request _meta, slow tools (ask_overseer,
 * bridge_session) periodically send `notifications/progress` messages to
 * keep the request alive past the client's default tool-call timeout
 * (which is typically ~60s and hard to override from the server side).
 * Without this, a 65s local-AI inference would trigger -32001 even though
 * the backend completed fine. The progress ping resets the client clock.
 *
 * v2 toolset (18 tools):
 *
 *   Read / brief:
 *     nexus_brief             — current state for a given project
 *     nexus_get_plan          — AI-generated session plan with fuel context
 *     nexus_check_guard       — redundancy check before starting work
 *     nexus_search            — smart (keyword + semantic) search across entities
 *     nexus_get_critique      — self-evaluation on task completion patterns
 *     nexus_predict_gaps      — knowledge-graph gap detection
 *     nexus_get_blast_radius  — downstream impact of changing a decision
 *     nexus_ask_overseer      — strategic Q&A against full metabrain context
 *
 *   Write / ritual:
 *     nexus_create_task       — create a backlog task
 *     nexus_complete_task     — mark a task as done
 *     nexus_log_activity      — log an activity entry
 *     nexus_log_session       — log a session with decisions/tags/files/blockers
 *     nexus_log_usage         — log session/weekly fuel readings
 *     nexus_record_decision   — write a strategic decision into The Ledger
 *     nexus_link_decisions    — create typed edge between two decisions
 *     nexus_push_thought      — push onto interrupt-recovery stack
 *     nexus_pop_thought       — pop top thought (recover from interruption)
 *
 *   Composite / reflexive:
 *     nexus_bridge_session    — end-of-work ritual: auto-summary + thought push
 *
 * Run via: `npx tsx server/mcp/index.ts`
 * Or use the `nexus mcp` CLI subcommand which prints the Claude Code
 * config snippet to add to your settings.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

// ── Configuration ────────────────────────────────────────
const STANDALONE = process.env.NEXUS_STANDALONE === '1';
const NEXUS_BASE = process.env.NEXUS_BASE_URL || 'http://localhost:3001';
const SERVER_NAME = 'nexus';
const SERVER_VERSION = '4.3.1';

// In standalone mode, import the local API adapter (direct store access, no Express needed)
let localApiFetch: ((path: string, init?: any) => Promise<any>) | null = null;
if (STANDALONE) {
  try {
    const mod = await import('./localApi.ts');
    localApiFetch = mod.localApiFetch;
    console.error('◈ Standalone mode — using in-process NexusStore at', process.env.NEXUS_DB_PATH || '~/.nexus/nexus.json');
  } catch (err: any) {
    console.error('◈ Failed to load standalone adapter:', err.message);
  }
}

// ── Slow tools — need progress notifications to survive client timeouts ─
// Tools in this set send periodic progress pings to the client during
// execution, so a slow local-AI inference doesn't hit the MCP tool-call
// timeout (which is client-enforced, typically ~60s, and not overridable
// from the server side). Each progress notification resets the client's
// inactivity timer per the MCP spec ("progress notifications SHOULD keep
// the request alive, delaying any timeout").
const SLOW_TOOLS = new Set<string>([
  'nexus_ask_overseer',
  'nexus_bridge_session',
]);

const HEARTBEAT_INTERVAL_MS = 8000; // ping every 8s — well under typical 60s timeouts

// ── API helper (standalone or HTTP proxy) ───────────────
async function nexusFetch(
  path: string,
  init: RequestInit = {}
): Promise<any> {
  // Standalone mode: route directly to in-process store
  if (localApiFetch) {
    return localApiFetch(path, {
      method: init.method,
      body: init.body ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : undefined,
    });
  }

  // Proxy mode: forward to Express server (with single retry)
  let res: Response;
  const doFetch = () => fetch(`${NEXUS_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  try {
    res = await doFetch();
  } catch (err: any) {
    // Single retry after 500ms (covers server restart window)
    try {
      await new Promise(r => setTimeout(r, 500));
      res = await doFetch();
    } catch {
      throw new Error(
        `Nexus server unreachable at ${NEXUS_BASE}. ` +
          `Start with: nexus-dev.bat, or set NEXUS_STANDALONE=1 for direct mode. ` +
          `(${err.message})`
      );
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Nexus API ${path} → ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

// ── Response formatters ──────────────────────────────────
function formatBrief(data: any, project: string): string {
  const lines: string[] = [];
  lines.push(`◈ NEXUS BRIEF — ${project}`);
  lines.push('');

  if (data.fuel) {
    lines.push(
      `Fuel: session ${data.fuel.session ?? '?'}% | weekly ${data.fuel.weekly ?? '?'}%`
    );
    if (data.fuel.runwayMinutes != null) {
      lines.push(`Runway: ${data.fuel.runwayMinutes}m`);
      // v4.3 #194 — discoverable nudge toward calendar-aware runway check.
      // Only suggest when fuel is in a range where planning matters (not fresh, not critical).
      if (data.fuel.session != null && data.fuel.session <= 80 && data.fuel.session >= 20) {
        lines.push(`  tip: check calendar with /nexus-runway to plan around meetings`);
      }
    }
  }

  if (data.activeTasks?.length) {
    lines.push('');
    lines.push(`Active tasks (${data.activeTasks.length}):`);
    for (const t of data.activeTasks.slice(0, 10)) {
      lines.push(`  #${t.id} [${t.status}] ${t.title}`);
    }
    if (data.activeTasks.length > 10) {
      lines.push(`  ... +${data.activeTasks.length - 10} more`);
    }
  }

  if (data.priorSessions?.length) {
    lines.push('');
    lines.push('Recent sessions:');
    for (const s of data.priorSessions.slice(0, 3)) {
      const date = new Date(s.created_at).toLocaleDateString();
      lines.push(`  ${date}: ${s.summary.slice(0, 100)}`);
    }
  }

  if (data.keyDecisions?.length) {
    lines.push('');
    lines.push('Key decisions:');
    for (const d of data.keyDecisions.slice(0, 5)) {
      lines.push(`  › ${d.decision.slice(0, 100)}`);
    }
  }

  if (data.recentPlans?.length) {
    lines.push('');
    const totalSuffix = data.totalPlans && data.totalPlans > data.recentPlans.length
      ? ` (${data.recentPlans.length} of ${data.totalPlans})`
      : ` (${data.recentPlans.length})`;
    lines.push(`Recent CC plans${totalSuffix}:`);
    for (const p of data.recentPlans.slice(0, 3)) {
      const tag = p.project ? `[${p.project}] ` : '';
      const age = p.ageDays === 0 ? 'today' : p.ageDays === 1 ? '1d ago' : `${p.ageDays}d ago`;
      lines.push(`  › ${tag}${p.title.slice(0, 80)} (${age})`);
    }
  }

  if (data.ccMemories?.length) {
    lines.push('');
    const totalSuffix = data.totalMemories && data.totalMemories > data.ccMemories.length
      ? ` (${data.ccMemories.length} of ${data.totalMemories})`
      : ` (${data.ccMemories.length})`;
    lines.push(`CC memory${totalSuffix}:`);
    for (const m of data.ccMemories.slice(0, 5)) {
      const typeTag = `[${m.type}]`;
      const headline = (m.description || m.name || m.filename).slice(0, 90);
      lines.push(`  › ${typeTag} ${headline}`);
    }
  }

  if (data.risks?.length) {
    lines.push('');
    lines.push('Risks:');
    for (const r of data.risks) {
      lines.push(`  ! ${r.message || r}`);
    }
  }

  return lines.join('\n');
}

function formatPlan(data: any): string {
  const lines: string[] = [];
  lines.push('◈ NEXUS SESSION PLAN');
  lines.push('');
  if (data.fuelState) {
    lines.push(
      `Fuel: ${data.fuelState.session}% session | ${data.fuelState.weekly}% weekly | ${data.fuelState.runwayMinutes}m runway`
    );
    lines.push('');
  }
  if (data.aiPlan) {
    lines.push(data.aiPlan);
  } else {
    lines.push('(no plan generated)');
  }
  return lines.join('\n');
}

function formatGuard(data: any, title: string): string {
  const similarTasks = data?.similarTasks || [];
  const relatedDecisions = data?.relatedDecisions || [];
  const pastSessions = data?.pastSessions || [];
  const total = similarTasks.length + relatedDecisions.length + pastSessions.length;

  if (total === 0) {
    return `◈ Guard check: "${title}"\n\nNo redundancy detected. Safe to proceed.`;
  }

  const lines: string[] = [];
  lines.push(`◈ Guard check: "${title}"`);
  lines.push('');
  if (data.warning) {
    lines.push(`⚠ ${data.warning}`);
    lines.push('');
  }

  if (similarTasks.length > 0) {
    lines.push(`Similar tasks (${similarTasks.length}):`);
    for (const t of similarTasks.slice(0, 5)) {
      lines.push(
        `  • #${t.id} [${t.status}] ${t.title}  (${(t.similarity * 100).toFixed(0)}% match)`
      );
    }
  }
  if (relatedDecisions.length > 0) {
    if (lines.length > 3) lines.push('');
    lines.push(`Related decisions (${relatedDecisions.length}):`);
    for (const d of relatedDecisions.slice(0, 5)) {
      lines.push(`  › #${d.id} [${d.project}] ${d.decision.slice(0, 100)}`);
    }
  }
  if (pastSessions.length > 0) {
    lines.push('');
    lines.push(`Past sessions (${pastSessions.length}):`);
    for (const s of pastSessions.slice(0, 3)) {
      lines.push(`  ▪ #${s.id} [${s.project}] ${s.summary.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}

// ── Tool definitions ─────────────────────────────────────
const TOOLS: Tool[] = [
  {
    name: 'nexus_brief',
    description:
      'Get the current Nexus state for a project: fuel, active tasks, recent sessions, key decisions, and risks. ' +
      'Call this at the start of any session to load the metabrain context. Equivalent to running `nexus brief` in the terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Project name (e.g. "Nexus", "Shadowrun", "Firewall-Godot"). Defaults to "Nexus".',
        },
      },
    },
  },
  {
    name: 'nexus_get_plan',
    description:
      'Get an AI-generated session plan that combines current fuel state, active tasks, and the knowledge graph. ' +
      'Returns a structured plan with focus, prioritized tasks (with time estimates), rationale, and what to avoid. ' +
      'Use this when you need to decide what to work on given limited fuel/time.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Optional project filter. If omitted, plans across all projects.',
        },
      },
    },
  },
  {
    name: 'nexus_check_guard',
    description:
      'Check whether a proposed task title or decision is redundant — has it already been done, planned, or recorded? ' +
      'Returns similar tasks/decisions/sessions with similarity scores and a recommendation. ' +
      'Use BEFORE starting non-trivial work to avoid duplicating effort.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The proposed task title or decision text to check for redundancy.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'nexus_record_decision',
    description:
      'Record a strategic decision into The Ledger (the long-term decision graph). ' +
      'Use this for architectural choices, design decisions, scope boundaries, or "why we did it this way" notes. ' +
      'Decisions become first-class nodes in the knowledge graph and feed into Overseer analysis, blast-radius queries, and the Compass module. ' +
      'TIP: pass emit_cc_memory=true and Nexus returns a ready-to-write CC memory-file suggestion (YAML frontmatter + body) + recommended filename; use the Write tool to persist it under ~/.claude/projects/<cwd-encoded>/memory/ so the decision survives in CC\'s native memory surface.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          description: 'The decision text. Be specific. "Use Postgres" is weak; "Use Postgres for sessions because we need transactional writes for concurrent workers" is strong.',
        },
        project: {
          type: 'string',
          description: 'Project name this decision belongs to.',
        },
        rationale: {
          type: 'string',
          description: 'Optional: why this decision was made (alternatives considered, constraints, etc.).',
        },
        emit_cc_memory: {
          type: 'boolean',
          description: 'Optional (v4.3+): when true, Nexus response includes a suggested CC memory file (YAML frontmatter + body + recommended filename) so you can persist the decision as a CC memory via the Write tool. Default false.',
        },
      },
      required: ['decision', 'project'],
    },
  },
  {
    name: 'nexus_update_decision',
    description:
      'Update an existing decision in The Ledger. Use to refine decision text, add context/rationale, ' +
      'update tags, or correct project assignment — without breaking existing graph edges.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Decision id to update.' },
        decision: { type: 'string', description: 'New decision text (optional).' },
        rationale: { type: 'string', description: 'New context/rationale (optional).' },
        project: { type: 'string', description: 'New project assignment (optional).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (optional).' },
        lifecycle: { type: 'string', enum: ['proposed', 'active', 'validated', 'deprecated'], description: 'Decision lifecycle state (optional).' },
        confidence: { type: 'number', description: 'Confidence score 0-1 (optional).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'nexus_push_thought',
    description:
      'Push a thought onto the LIFO Thought Stack — the interrupt-recovery working memory. ' +
      'Call this BEFORE switching context, getting interrupted, or stopping mid-task. ' +
      'When you (or another Claude instance) return, call nexus_pop_thought to recover what you were doing. ' +
      'This is the cross-session continuity primitive. ' +
      'TIP: when you pass related_task_id, also consider calling mcp__ccd_session__spawn_task ' +
      'to surface the thought as a CC side-task chip — spawned-task completion calling ' +
      'nexus_complete_task on the linked task will auto-pop this thought (bidirectional bridge).',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'What you were thinking about / what you were about to do. Be specific so future-you can pick it back up.',
        },
        context: {
          type: 'string',
          description: 'Optional: where you were (file path, line number, function name, current state).',
        },
        project: {
          type: 'string',
          description: 'Optional: which project this thought belongs to.',
        },
        related_task_id: {
          type: 'number',
          description: 'Optional: link to a task ID. Thought auto-resolves when that task completes.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'nexus_pop_thought',
    description:
      'Pop the top thought off the Thought Stack — call this when returning from an interruption to recover what you were doing. ' +
      'Returns the most recently pushed thought. ' +
      'Optionally pass an id to pop a specific thought instead of the top.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Optional: specific thought ID to pop. If omitted, pops the top of the stack.',
        },
      },
    },
  },
  {
    name: 'nexus_log_usage',
    description:
      'Log a Claude fuel reading — session percent remaining and/or weekly percent remaining. ' +
      'Values are PERCENTAGES REMAINING (higher = more fuel left), not percent used. ' +
      'Example: user says "17% session used" → pass session_percent: 83. ' +
      'Optionally pass reset_in_minutes to (re)start the session timing window (use this when the user ' +
      'tells you how long until their session resets, e.g. "resets in 3h 43m" → 223). ' +
      'This feeds the Fuel Intelligence module, burn-rate estimation, workload advisor, and the Overseer ' +
      'risk scanner. Call it whenever the user reports a new fuel reading.',
    inputSchema: {
      type: 'object',
      properties: {
        session_percent: {
          type: 'number',
          description: 'Session fuel REMAINING (0-100). If the user says "17% used", pass 83.',
        },
        weekly_percent: {
          type: 'number',
          description: 'Weekly fuel REMAINING (0-100) for "All models" limit. If the user says "42% used", pass 58.',
        },
        sonnet_weekly_percent: {
          type: 'number',
          description: 'Optional: "Sonnet only" weekly fuel REMAINING (0-100). Separate from All models limit.',
        },
        extra_usage: {
          type: 'boolean',
          description: 'Optional: true if user is on pay-per-use overflow (session limit hit but still working).',
        },
        reset_in_minutes: {
          type: 'number',
          description: 'Optional: minutes until the session window resets. If provided, (re)starts the session timing window. Example: "resets in 3h 43m" → 223.',
        },
        note: {
          type: 'string',
          description: 'Optional free-text note attached to this reading (e.g. "before starting MCP tool work").',
        },
        plan: {
          type: 'string',
          enum: ['free', 'pro', 'max5', 'max20', 'team', 'team_premium', 'enterprise', 'api'],
          description: 'Optional: Claude subscription plan. Set once and it persists. Affects capacity estimates.',
        },
        timezone: {
          type: 'string',
          description: 'Optional: IANA timezone (e.g. "Europe/Prague", "America/New_York"). Affects reset time display.',
        },
      },
    },
  },
  {
    name: 'nexus_create_task',
    description:
      'Create a new task on the Mission Board. Defaults to backlog status. ' +
      'Use this when the user describes something that should be tracked as a discrete work unit, ' +
      'or when planning work and you want to queue up items for later. ' +
      'Returns the new task id.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title. Be specific — "Fix auth bug" is weak, "Fix token refresh race in auth middleware causing 401s after token rotation" is strong.',
        },
        description: {
          type: 'string',
          description: 'Optional longer description or context for the task.',
        },
        status: {
          type: 'string',
          enum: ['backlog', 'in_progress', 'review', 'done'],
          description: 'Initial status. Defaults to "backlog".',
        },
        priority: {
          type: 'number',
          description: 'Optional priority 0-2 (0=low, 1=normal, 2=high).',
        },
        decision_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional: IDs of decisions this task implements or relates to.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'nexus_complete_task',
    description:
      'Mark a task as done by id. Use this when work on a task finishes during the conversation. ' +
      'Equivalent to `nexus done <id>` in the CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Task id to mark as done.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'nexus_log_activity',
    description:
      'Log an activity entry into the live activity stream. Use for notable events that aren\'t full-fledged tasks ' +
      'or sessions — e.g. "deployed v3.2 to origin/main", "fixed CI after rerun", "calibrated fuel readings". ' +
      'Activity entries feed the digest, Compass Done panel, and Overseer context.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The activity message. Concrete and past-tense.',
        },
        type: {
          type: 'string',
          description: 'Optional entry type for filtering (e.g. "deploy", "fix", "decision", "system"). Defaults to "system".',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'nexus_log_session',
    description:
      'Log a session summary with decisions, blockers, tags, and files touched. This is the memory-bridge ' +
      'operation — the most important write operation in Nexus. Call at the end of meaningful work ' +
      '(a shipped feature, a debugging session, a planning session). The session becomes part of the ' +
      'metabrain permanently and surfaces in future briefs.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project this session belongs to.',
        },
        summary: {
          type: 'string',
          description: 'Narrative summary of the work. 2-5 sentences. Lead with outcomes, not process.',
        },
        decisions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Strategic/architectural decisions made during this session. These will be extracted into The Ledger.',
        },
        blockers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Things that blocked or impeded work (empty array if none).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short tags for later search/filter.',
        },
        files_touched: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths modified during this session.',
        },
      },
      required: ['project', 'summary'],
    },
  },
  {
    name: 'nexus_link_decisions',
    description:
      'Create a typed edge between two existing decisions in The Ledger (the knowledge graph). ' +
      'Use this when you notice that one decision led to, depends on, informs, contradicts, or replaces another. ' +
      'The graph feeds blast-radius analysis, centrality ranking, contradiction detection, and fragmented-project ' +
      'detection in the Holes view.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'number',
          description: 'Source decision id.',
        },
        to: {
          type: 'number',
          description: 'Target decision id.',
        },
        rel: {
          type: 'string',
          enum: ['led_to', 'depends_on', 'contradicts', 'replaced', 'related', 'informs', 'experimental'],
          description: 'Edge type. "led_to" = causal, "depends_on" = prerequisite, "contradicts" = conflict, "replaced" = supersession, "related" = weak association, "informs" = provides context without being a requirement, "experimental" = tentative link, revisit later.',
        },
        note: {
          type: 'string',
          description: 'Optional note explaining why the link exists.',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'nexus_search',
    description:
      'Smart hybrid (keyword + semantic) search across tasks, sessions, decisions, and activity. ' +
      'Use when the user references prior work vaguely ("the thing we decided about auth"), when you need ' +
      'to find related context, or when checking history before making a new suggestion.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query. Natural language works (semantic matching) but keywords also work (BM25).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'nexus_get_critique',
    description:
      'Get self-critique from Nexus: which tasks took unusually long to complete, which are stuck, which categories ' +
      'are slowest, and any patterns detected. Surfaces implicit thrashing as explicit feedback. ' +
      'Use before starting a new task similar to one that historically ran long, or for periodic reflection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'nexus_predict_gaps',
    description:
      'Detect structural gaps in the knowledge graph and current project state. Returns suggestions across six ' +
      'categories: blind_spot (projects with no decisions), orphan (isolated decisions), unvalidated (high-centrality ' +
      'decisions with no verification), stale (old decisions in active projects), blocker (session blockers not ' +
      'tracked as tasks), drift (repos with uncommitted changes). Use to find things worth doing next.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'nexus_get_blast_radius',
    description:
      'Get the downstream impact of a decision: what other decisions depend on it, what gets affected if it changes. ' +
      'Traverses led_to and depends_on edges from the given decision id. Use before proposing changes to ' +
      'architectural decisions to understand the blast radius.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: {
          type: 'number',
          description: 'Decision id to analyze.',
        },
      },
      required: ['decision_id'],
    },
  },
  {
    name: 'nexus_ask_overseer',
    description:
      'Ask the Overseer (local AI running against the full Nexus metabrain context) a strategic question. ' +
      'Unlike asking the main model directly, the Overseer has the Ledger, recent sessions, active tasks, fuel ' +
      'state, and risks all loaded as context. Use for high-level strategic questions: "what should I prioritize?", ' +
      '"am I missing something?", "what are the tradeoffs here?". Takes longer than other tools (AI inference). ' +
      'NOTE: If this times out due to slow local AI inference, use nexus_ask_overseer_start + nexus_get_overseer_result instead.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The strategic question to ask.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'nexus_ask_overseer_start',
    description:
      'Start an async Overseer query. Returns a taskId immediately (no timeout risk). ' +
      'The Overseer runs in the background against the full metabrain context. ' +
      'Poll with nexus_get_overseer_result to get the answer when ready. ' +
      'Use this instead of nexus_ask_overseer when local AI inference takes >60s.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The strategic question to ask.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'nexus_get_overseer_result',
    description:
      'Poll for the result of an async Overseer query started with nexus_ask_overseer_start. ' +
      'Returns status: "pending" (still thinking), "done" (answer ready), or "error". ' +
      'Call every 10-15 seconds until status is "done".',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The taskId returned by nexus_ask_overseer_start.',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'nexus_bridge_session',
    description:
      'Composite end-of-work ritual. Call this when wrapping up a meaningful chunk of work instead of making ' +
      'multiple separate calls. In one shot it: (1) generates an AI-drafted session summary from recent activity ' +
      'via auto-summary, (2) optionally pushes a thought onto the Thought Stack so the next Claude instance can ' +
      'recover context, (3) returns a handoff note that future-you or another instance can read immediately. ' +
      'This turns the shutdown ritual into a single reflex, which is the whole point of having a metabrain.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project to bridge (defaults to "Nexus").',
        },
        handoff_thought: {
          type: 'string',
          description: 'Optional: text to push onto the Thought Stack as a pointer for the next instance. ' +
            'If omitted, no thought is pushed (pure summary generation).',
        },
        handoff_context: {
          type: 'string',
          description: 'Optional context for the handoff thought (e.g. "mid-refactor of Graph.jsx line 240, about to add new tab").',
        },
        commit_summary: {
          type: 'boolean',
          description: 'If true, also commit the generated summary as a real session entry (not just a preview). Defaults to false.',
        },
      },
    },
  },
  {
    name: 'nexus_fleet_overview',
    description:
      'Get cross-project priority matrix: ranks ALL open tasks across ALL projects by ' +
      'priority × age × project_staleness. Returns top 15 most urgent items. ' +
      'Use when deciding what to work on when multiple projects compete for attention.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nexus_calendar_runway',
    description:
      'Compute fuel-runway overlap against upcoming calendar events and recommend a wrap-up time. ' +
      'Nexus cannot fetch the calendar itself — call mcp__{calendar}__list_events first (startTime=now, ' +
      'endTime=now+5h), map results to {start, title}, then pass them here. Nexus then checks the next ' +
      'meeting against current session fuel + runway and classifies the fit (comfortable / tight / wrap_now / ' +
      'unreachable). Use before a long coding session to know if you have time for the task at hand.',
    inputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          description: 'Upcoming events from the calendar MCP, ordered any way — Nexus sorts internally.',
          items: {
            type: 'object',
            properties: {
              start: { type: 'string', description: 'ISO 8601 timestamp of event start.' },
              title: { type: 'string', description: 'Event title (optional; falls back to "(untitled)").' },
            },
            required: ['start'],
          },
        },
        buffer_minutes: {
          type: 'number',
          description: 'Context-switch buffer before the meeting. Default 15.',
        },
      },
      required: ['events'],
    },
  },
];

// ── Tool handlers ────────────────────────────────────────
async function handleTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'nexus_brief': {
      const project = args?.project || 'Nexus';
      // The /api/init endpoint returns init checks but not a full brief.
      // Compose a brief from multiple endpoints (the same data the CLI uses).
      // Per-call 10s timeout via Promise.race to prevent hanging on slow routes
      const withTimeout = <T>(p: Promise<T>, fallback: T) =>
        Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), 10000))]);
      const [tasks, sessions, ledger, fuel, risks, plansIndex, memoriesIndex] = await Promise.all([
        withTimeout(nexusFetch('/api/tasks'), []),
        withTimeout(nexusFetch('/api/sessions'), []),
        withTimeout(nexusFetch('/api/ledger'), []),
        withTimeout(nexusFetch('/api/estimator'), null),
        withTimeout(nexusFetch('/api/overseer/risks'), { risks: [] }),
        withTimeout(nexusFetch('/api/cc-plans?limit=10'), { available: false, plans: [], totalFiles: 0 }),
        withTimeout(nexusFetch('/api/cc-memory?limit=40'), { available: false, memories: [], totalFiles: 0 }),
      ]);

      const projectLower = project.toLowerCase();
      // Build dynamic project list from actual data (no hardcoded list)
      const allProjects = new Set<string>();
      for (const s of sessions as any[]) allProjects.add((s.project || '').toLowerCase());
      for (const d of (Array.isArray(ledger) ? ledger : []) as any[]) allProjects.add((d.project || '').toLowerCase());
      allProjects.delete('');
      allProjects.delete('general');

      const inProject = (s: string) => {
        const t = (s || '').toLowerCase();
        if (t.includes(projectLower)) return true;
        // Default project (e.g. "nexus"): include tasks that don't belong to any OTHER known project
        const otherProjects = [...allProjects].filter((p) => p !== projectLower);
        if (otherProjects.length > 0) {
          const belongsToOther = otherProjects.some((p) => t.includes(p));
          return !belongsToOther;
        }
        return true; // no other projects known — include everything
      };

      const activeTasks = (tasks as any[]).filter(
        (t) => t.status !== 'done' && inProject(t.title)
      );
      const priorSessions = (sessions as any[])
        .filter((s) => s.project === project || s.project?.toLowerCase() === projectLower)
        .slice(0, 5);
      const keyDecisions = (Array.isArray(ledger) ? ledger : [])
        .filter((d: any) => d.project === project || d.project?.toLowerCase() === projectLower)
        .slice(0, 5);

      // Filter CC plans by project (if inferred) — show project-matched ones first,
      // fall back to most-recent across projects if none match.
      const pi: any = plansIndex || {};
      const allPlans: any[] = Array.isArray(pi.plans) ? pi.plans : [];
      const matchedPlans = allPlans.filter((p) => p.project && p.project.toLowerCase() === projectLower);
      const recentPlans = matchedPlans.length > 0 ? matchedPlans : allPlans.slice(0, 5);

      // Same pattern for CC memories — show project-matched first, newest fallback.
      const mi: any = memoriesIndex || {};
      const allMemories: any[] = Array.isArray(mi.memories) ? mi.memories : [];
      const matchedMemories = allMemories.filter((m) => m.project && m.project.toLowerCase() === projectLower);
      const ccMemories = matchedMemories.length > 0 ? matchedMemories : allMemories.slice(0, 5);

      return formatBrief(
        {
          fuel: fuel?.estimated
            ? {
                session: fuel.estimated.session,
                weekly: fuel.estimated.weekly,
                runwayMinutes: fuel.session?.minutesRemaining,
              }
            : null,
          activeTasks,
          priorSessions,
          keyDecisions,
          recentPlans,
          totalPlans: pi.totalFiles ?? 0,
          ccMemories,
          totalMemories: mi.totalFiles ?? 0,
          risks: (risks as any).risks || [],
        },
        project
      );
    }

    case 'nexus_get_plan': {
      const qs = args?.project ? `?project=${encodeURIComponent(args.project)}` : '';
      const data = await nexusFetch(`/api/plan${qs}`);
      return formatPlan(data);
    }

    case 'nexus_check_guard': {
      if (!args?.title) throw new Error('title is required');
      const data = await nexusFetch(
        `/api/guard?title=${encodeURIComponent(args.title)}`
      );
      return formatGuard(data, args.title);
    }

    case 'nexus_record_decision': {
      if (!args?.decision) throw new Error('decision is required');
      if (!args?.project) throw new Error('project is required');
      // The Ledger schema uses `context` for the rationale/why field.
      const body = {
        decision: args.decision,
        project: args.project,
        context: args.rationale || '',
        tags: args.tags || [],
      };
      const result = await nexusFetch('/api/ledger', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      let out = `◈ Decision #${result.id} recorded for ${args.project}\n  ${args.decision}`;

      // v4.3 #198 Phase B — optional CC memory emission. Nexus composes a ready-to-write
      // memory file; Claude uses the Write tool to persist it. Keeps the MCP boundary clean
      // (Nexus doesn't need to know the user's CWD encoding).
      if (args.emit_cc_memory) {
        const slug = String(args.decision)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 50) || `decision_${result.id}`;
        const filename = `reference_${slug}.md`;
        const projectName = String(args.project);
        const name = `Decision #${result.id}: ${String(args.decision).slice(0, 60)}`;
        const description = String(args.decision).slice(0, 180).replace(/[\n\r]/g, ' ');
        const memoryFile = [
          '---',
          `name: ${name.replace(/[\n\r]/g, ' ')}`,
          `description: ${description}`,
          `type: reference`,
          '---',
          '',
          `**Project:** ${projectName}`,
          `**Recorded:** ${new Date().toISOString()}`,
          `**Nexus decision ID:** #${result.id}`,
          '',
          `## Decision`,
          '',
          String(args.decision),
          '',
          args.rationale ? `## Rationale\n\n${args.rationale}\n` : '',
          `---\n\n_Auto-emitted by nexus_record_decision. Edit freely; the Ledger remains the source of truth — update the decision there via nexus_update_decision._`,
        ].filter(Boolean).join('\n');

        out += '\n\n◈ CC memory suggestion:';
        out += `\n  Recommended path: <CC memory dir for ${projectName}>/${filename}`;
        out += `\n  Use the Write tool to persist. Target dir: find your project's dir under ~/.claude/projects/<cwd-encoded>/memory/`;
        out += `\n\n--- FILE CONTENT START ---\n${memoryFile}\n--- FILE CONTENT END ---`;
      }

      return out;
    }

    case 'nexus_update_decision': {
      if (args?.id == null) throw new Error('id is required');
      const body: any = {};
      if (args.decision) body.decision = args.decision;
      if (args.rationale) body.context = args.rationale;
      if (args.project) body.project = args.project;
      if (args.tags) body.tags = args.tags;
      if (args.lifecycle) body.lifecycle = args.lifecycle;
      if (args.confidence != null) body.confidence = args.confidence;
      const result = await nexusFetch(`/api/ledger/${Number(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return `◈ Decision #${result.id} updated\n  ${result.decision}`;
    }

    case 'nexus_push_thought': {
      if (!args?.text) throw new Error('text is required');
      const result = await nexusFetch('/api/thoughts', {
        method: 'POST',
        body: JSON.stringify({
          text: args.text,
          context: args.context || undefined,
          project: args.project || undefined,
          related_task_id: args.related_task_id || undefined,
        }),
      });
      const base = `◈ Thought #${result.id} pushed onto the stack.\n  "${args.text}"${
        args.context ? `\n  context: ${args.context}` : ''
      }`;
      // #192 bridge suggestion: when linked to a task, nudge toward spawn_task.
      // The spawned side-task session calling nexus_complete_task(related_task_id)
      // will auto-pop this thought via the existing resolve-linked-thoughts logic.
      if (args.related_task_id) {
        return base + `\n\n  ◈ Bridge: consider mcp__ccd_session__spawn_task("Resolve #${args.related_task_id}", ...) to run this as a CC side-task. Completing the spawned task via nexus_complete_task(${args.related_task_id}) will auto-pop this thought.`;
      }
      return base;
    }

    case 'nexus_pop_thought': {
      const body = args?.id ? { id: args.id } : {};
      try {
        const result = await nexusFetch('/api/thoughts/pop', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return `◈ Popped thought #${result.id}:\n\n  ${result.text}${
          result.context ? `\n\n  context: ${result.context}` : ''
        }${result.project ? `\n  project: ${result.project}` : ''}`;
      } catch (err: any) {
        if (err.message?.includes('404')) {
          return '◈ Stack is empty. Nothing to pop.';
        }
        throw err;
      }
    }

    case 'nexus_log_usage': {
      if (args?.session_percent == null && args?.weekly_percent == null) {
        throw new Error(
          'Provide session_percent and/or weekly_percent (percentages REMAINING, not used).'
        );
      }
      const body: any = {};
      if (args.session_percent != null) body.session_percent = Number(args.session_percent);
      if (args.weekly_percent != null) body.weekly_percent = Number(args.weekly_percent);
      if (args.sonnet_weekly_percent != null) body.sonnet_weekly_percent = Number(args.sonnet_weekly_percent);
      if (args.extra_usage != null) body.extra_usage = !!args.extra_usage;
      if (args.reset_in_minutes != null) body.reset_in_minutes = Number(args.reset_in_minutes);
      if (args.note) body.note = String(args.note);
      if (args.plan) body.plan = args.plan;
      if (args.timezone) body.timezone = args.timezone;

      const result = await nexusFetch('/api/usage', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const parts: string[] = ['◈ Fuel logged'];
      if (result.session_percent != null) parts.push(`session ${result.session_percent}%`);
      if (result.weekly_percent != null) parts.push(`weekly ${result.weekly_percent}%`);

      const lines: string[] = [parts.join(' · ')];
      if (result.timing?.session?.countdown) {
        lines.push(`  Session resets in ${result.timing.session.countdown}`);
      }
      if (result.timing?.weekly?.countdown) {
        lines.push(`  Weekly resets ${result.timing.weekly.countdown}`);
      }
      // Surface low-fuel warnings so the caller notices immediately
      if (
        result.session_percent != null &&
        result.session_percent <= 15
      ) {
        lines.push(`  ⚠ Session fuel LOW (${result.session_percent}%) — consider wrapping up.`);
      }
      if (
        result.weekly_percent != null &&
        result.weekly_percent <= 10
      ) {
        lines.push(`  ⚠ Weekly fuel CRITICAL (${result.weekly_percent}%) — ration carefully.`);
      }
      return lines.join('\n');
    }

    // ── v2 write tools ────────────────────────────────

    case 'nexus_create_task': {
      if (!args?.title) throw new Error('title is required');
      const body: any = {
        title: args.title,
        status: args.status || 'backlog',
      };
      if (args.description) body.description = args.description;
      if (args.priority != null) body.priority = Number(args.priority);
      if (args.decision_ids) body.decision_ids = args.decision_ids;
      const result = await nexusFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return `◈ Task #${result.id} plotted [${result.status}]\n  ${result.title}`;
    }

    case 'nexus_complete_task': {
      if (args?.id == null) throw new Error('id is required');
      const result = await nexusFetch(`/api/tasks/${Number(args.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      });
      const lines = [`◈ Landmark reached #${result.id}`, `  ${result.title}`];
      if (result.resolvedThoughts > 0) {
        lines.push(`  ◈ Auto-resolved ${result.resolvedThoughts} linked thought${result.resolvedThoughts > 1 ? 's' : ''}`);
      }
      return lines.join('\n');
    }

    case 'nexus_log_activity': {
      if (!args?.message) throw new Error('message is required');
      const body = {
        type: args.type || 'system',
        message: String(args.message),
      };
      const result = await nexusFetch('/api/activity', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return `◈ Logged [${result.type}]: ${result.message}`;
    }

    case 'nexus_log_session': {
      if (!args?.project) throw new Error('project is required');
      if (!args?.summary) throw new Error('summary is required');
      const body = {
        project: args.project,
        summary: args.summary,
        decisions: Array.isArray(args.decisions) ? args.decisions : [],
        blockers: Array.isArray(args.blockers) ? args.blockers : [],
        tags: Array.isArray(args.tags) ? args.tags : [],
        files_touched: Array.isArray(args.files_touched) ? args.files_touched : [],
      };
      const result = await nexusFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const lines = [
        `◈ Session #${result.id} recorded for ${result.project}`,
        `  ${result.summary.slice(0, 120)}${result.summary.length > 120 ? '...' : ''}`,
      ];
      if (body.decisions.length) lines.push(`  ${body.decisions.length} decision${body.decisions.length !== 1 ? 's' : ''} captured`);
      if (body.blockers.length) lines.push(`  ⚠ ${body.blockers.length} blocker${body.blockers.length !== 1 ? 's' : ''}`);
      if (body.tags.length) lines.push(`  tags: ${body.tags.join(', ')}`);
      return lines.join('\n');
    }

    case 'nexus_link_decisions': {
      if (args?.from == null || args?.to == null) {
        throw new Error('from and to decision ids are required');
      }
      const body = {
        from: Number(args.from),
        to: Number(args.to),
        rel: args.rel || 'related',
        note: args.note || '',
      };
      const result = await nexusFetch('/api/ledger/link', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return `◈ Linked #${body.from} --[${body.rel}]--> #${body.to}${
        result.id ? ` (edge #${result.id})` : ''
      }`;
    }

    // ── v2 intelligence tools ─────────────────────────

    case 'nexus_search': {
      if (!args?.query) throw new Error('query is required');
      const data = await nexusFetch(
        `/api/smart-search?q=${encodeURIComponent(args.query)}`
      );
      const results = data.results || [];
      if (results.length === 0) {
        return `◈ No results for "${args.query}"`;
      }
      const lines: string[] = [
        `◈ Search: "${args.query}" (${data.method || 'hybrid'}, ${results.length} results)`,
        '',
      ];
      for (const r of results.slice(0, 10)) {
        const score = r.score != null ? ` (${(r.score * 100).toFixed(0)}%)` : '';
        lines.push(`  [${r.type}]${score} ${r.display || r.title || r.summary || `#${r.id}`}`.slice(0, 160));
      }
      if (results.length > 10) lines.push(`  ... +${results.length - 10} more`);
      return lines.join('\n');
    }

    case 'nexus_get_critique': {
      const data = await nexusFetch('/api/critique');
      const lines: string[] = ['◈ Self-Critique'];
      if (data.averageCompletionMinutes != null) {
        lines.push(`  Average completion: ${Math.round(data.averageCompletionMinutes)}m`);
      }
      if (data.slowTasks?.length) {
        lines.push('', 'Slow tasks:');
        for (const t of data.slowTasks.slice(0, 5)) {
          lines.push(`  ⏱ #${t.id} [${t.status}] ${t.title?.slice(0, 80)} — ${t.minutes}m`);
        }
      }
      if (data.stuckTasks?.length) {
        lines.push('', 'Stuck (in_progress too long):');
        for (const t of data.stuckTasks.slice(0, 5)) {
          lines.push(`  ⊗ #${t.id} ${t.title?.slice(0, 80)}`);
        }
      }
      if (data.insights?.length) {
        lines.push('', 'Insights:');
        for (const i of data.insights) lines.push(`  › ${i}`);
      }
      return lines.join('\n');
    }

    case 'nexus_predict_gaps': {
      const data = await nexusFetch('/api/predict');
      const suggestions = data.suggestions || [];
      if (suggestions.length === 0) {
        return '◈ Graph is healthy. No gaps detected.';
      }
      const lines: string[] = [`◈ Predicted gaps (${suggestions.length})`];
      lines.push('');
      const byCategory: Record<string, any[]> = {};
      for (const s of suggestions) {
        if (!byCategory[s.category]) byCategory[s.category] = [];
        byCategory[s.category].push(s);
      }
      for (const [cat, items] of Object.entries(byCategory)) {
        lines.push(`${cat} (${items.length}):`);
        for (const s of items.slice(0, 3)) {
          const prio = s.priority === 2 ? '!' : s.priority === 1 ? '•' : ' ';
          lines.push(`  ${prio} [${s.project || '?'}] ${s.title}`);
        }
        if (items.length > 3) lines.push(`    ... +${items.length - 3} more`);
      }
      return lines.join('\n');
    }

    case 'nexus_get_blast_radius': {
      if (args?.decision_id == null) throw new Error('decision_id is required');
      const data = await nexusFetch(`/api/impact/blast/${Number(args.decision_id)}`);
      const lines: string[] = [`◈ Blast radius for #${args.decision_id}`];
      if (data.decision?.decision) {
        lines.push(`  ${data.decision.decision.slice(0, 120)}`);
      }
      lines.push('');
      lines.push(data.warning || `Impact: ${data.blastRadius || 0} downstream`);
      if (data.affected?.length) {
        lines.push('', 'Downstream (led_to / depends_on):');
        for (const a of data.affected.slice(0, 10)) {
          const indent = '  '.repeat(a.depth || 1);
          lines.push(`${indent}› #${a.id} ${a.decision?.slice(0, 90)}`);
        }
      }
      if (data.related?.length) {
        lines.push('', 'Related (weak links):');
        for (const r of data.related.slice(0, 5)) {
          lines.push(`  ~ #${r.id} ${r.decision?.slice(0, 90)}`);
        }
      }
      return lines.join('\n');
    }

    case 'nexus_ask_overseer': {
      if (!args?.question) throw new Error('question is required');
      const data = await nexusFetch('/api/overseer/ask', {
        method: 'POST',
        body: JSON.stringify({ question: args.question }),
      });
      if (data.error) return `◈ Overseer error: ${data.error}`;
      return `◈ Overseer:\n\n${data.answer || '(no response)'}`;
    }

    case 'nexus_ask_overseer_start': {
      if (!args?.question) throw new Error('question is required');
      const data = await nexusFetch('/api/overseer/ask/start', {
        method: 'POST',
        body: JSON.stringify({ question: args.question }),
      });
      if (data.error) return `◈ Overseer error: ${data.error}`;
      return `◈ Overseer query started.\n  taskId: ${data.taskId}\n  status: ${data.status}\n\nPoll with nexus_get_overseer_result({ task_id: "${data.taskId}" }) every 10-15s.`;
    }

    case 'nexus_get_overseer_result': {
      if (!args?.task_id) throw new Error('task_id is required');
      const data = await nexusFetch(`/api/overseer/ask/result/${encodeURIComponent(args.task_id)}`);
      if (data.status === 'pending') {
        return `◈ Overseer still thinking... (${data.elapsed}s elapsed)\n  Poll again in 10-15 seconds.`;
      }
      if (data.status === 'error') {
        return `◈ Overseer error: ${data.error}`;
      }
      return `◈ Overseer (completed in ${data.elapsed}s):\n\n${data.answer || '(no response)'}`;
    }

    // ── v2 composite / reflexive ──────────────────────

    case 'nexus_bridge_session': {
      const project = args?.project || 'Nexus';
      const commitSummary = args?.commit_summary === true;

      const results: string[] = ['◈ Bridging session'];
      results.push('');

      // Step 1: Generate (and optionally commit) a session summary
      let summary: any;
      if (commitSummary) {
        summary = await nexusFetch('/api/auto-summary', {
          method: 'POST',
          body: JSON.stringify({ project }),
        });
        if (summary?.id) {
          results.push(`✓ Session #${summary.id} committed for ${project}`);
        } else if (summary?.error) {
          results.push(`⚠ Summary generation failed: ${summary.error}`);
        }
      } else {
        summary = await nexusFetch(
          `/api/auto-summary?project=${encodeURIComponent(project)}`
        );
        if (summary?.parsed?.summary) {
          results.push(`✓ Summary generated (preview only, not committed):`);
          results.push(`  ${summary.parsed.summary}`);
          if (summary.parsed.decisions?.length) {
            results.push(`  Decisions: ${summary.parsed.decisions.length}`);
          }
          if (summary.parsed.tags?.length) {
            results.push(`  Tags: ${summary.parsed.tags.join(', ')}`);
          }
        } else if (summary?.error) {
          results.push(`⚠ Summary generation failed: ${summary.error}`);
        }
      }

      // Step 2: Push a handoff thought if requested
      if (args?.handoff_thought) {
        const thought = await nexusFetch('/api/thoughts', {
          method: 'POST',
          body: JSON.stringify({
            text: args.handoff_thought,
            context: args.handoff_context || undefined,
            project,
          }),
        });
        results.push('');
        results.push(`✓ Thought #${thought.id} pushed for next instance`);
        results.push(`  "${args.handoff_thought}"`);
        if (args.handoff_context) {
          results.push(`  context: ${args.handoff_context}`);
        }
      }

      // Step 3: Compose handoff note the next instance will see
      results.push('');
      results.push('◈ Handoff note for next instance:');
      results.push('  Call nexus_brief to see current state.');
      if (args?.handoff_thought) {
        results.push('  Call nexus_pop_thought to recover the context of this session.');
      }
      if (commitSummary && summary?.id) {
        results.push(`  Recent session #${summary.id} documents what was done.`);
      }

      return results.join('\n');
    }

    case 'nexus_fleet_overview': {
      const data = await nexusFetch('/api/fleet');
      const lines: string[] = ['◈ Fleet Overview — Cross-Project Priority Matrix', ''];
      if (data.topTasks?.length) {
        for (const t of data.topTasks) {
          const prio = t.priority === 2 ? '!!' : t.priority === 1 ? '! ' : '  ';
          lines.push(`  ${prio}#${t.id} [${t.status}] ${t.title.slice(0, 80)}  (score: ${t.score}, ${t.ageDays}d old)`);
        }
      } else {
        lines.push('  No open tasks across any project.');
      }
      if (Object.keys(data.staleness || {}).length) {
        lines.push('', 'Project staleness (days since last session):');
        for (const [proj, days] of Object.entries(data.staleness as Record<string, number>).sort((a, b) => (b[1] as number) - (a[1] as number))) {
          lines.push(`  ${proj}: ${days}d`);
        }
      }
      return lines.join('\n');
    }

    case 'nexus_calendar_runway': {
      const rawEvents: any[] = Array.isArray(args?.events) ? args.events : [];
      const buffer = Number.isFinite(args?.buffer_minutes) ? Math.max(0, args.buffer_minutes) : 15;

      // Pull current fuel + runway. Nexus owns this data in both HTTP and standalone modes.
      const fuel: any = await nexusFetch('/api/estimator');
      if (!fuel?.tracked) {
        return '◈ No fuel data yet — report usage with nexus_log_usage, then try again.';
      }
      const sessionPct = Math.round(fuel?.estimated?.session ?? 0);
      const runwayMin = fuel?.session?.minutesRemaining ?? null;

      // Normalize + sort events, drop past entries, keep only those within reach.
      const now = Date.now();
      const horizonMin = runwayMin ? Math.max(runwayMin * 2, 300) : 300;
      const upcoming = rawEvents
        .map((e) => {
          const startMs = new Date(e?.start || 0).getTime();
          const title = (e?.title || e?.summary || '(untitled)').toString().slice(0, 80);
          const minutesAway = Math.round((startMs - now) / 60000);
          return { title, startMs, minutesAway };
        })
        .filter((e) => Number.isFinite(e.startMs) && e.minutesAway > 0 && e.minutesAway <= horizonMin)
        .sort((a, b) => a.startMs - b.startMs);

      if (upcoming.length === 0) {
        return (
          `◈ Runway clear.\n` +
          `  Session fuel: ${sessionPct}%${runwayMin ? ` (~${runwayMin}m runway)` : ''}\n` +
          `  No calendar events within runway. Build freely, Captain.`
        );
      }

      const next = upcoming[0];
      const wrapBy = next.minutesAway - buffer;
      let fits: 'comfortable' | 'tight' | 'wrap_now' | 'unreachable';
      if (runwayMin != null && next.minutesAway > runwayMin + buffer) fits = 'unreachable';
      else if (wrapBy < 5) fits = 'wrap_now';
      else if (wrapBy < 30) fits = 'tight';
      else fits = 'comfortable';

      const lines: string[] = [
        `◈ Next: "${next.title}" in ${next.minutesAway}m`,
        `  Session fuel: ${sessionPct}%${runwayMin ? ` (~${runwayMin}m runway)` : ''}`,
        '',
      ];
      switch (fits) {
        case 'unreachable':
          lines.push(`  ⚠ Fuel runs out before the meeting. Log a session summary and preserve remaining fuel.`);
          break;
        case 'wrap_now':
          lines.push(`  ⚠ Wrap up now — meeting in ${next.minutesAway}m, only ${Math.max(0, wrapBy)}m until your ${buffer}m buffer.`);
          break;
        case 'tight':
          lines.push(`  ◦ Tight window — wrap by ${wrapBy}m from now (${buffer}m buffer before meeting).`);
          break;
        case 'comfortable':
          lines.push(`  ✓ Comfortable — wrap by ${wrapBy}m from now. Plenty of room for focused work.`);
          break;
      }

      if (upcoming.length > 1) {
        lines.push('', `  Then (within runway): ${upcoming.slice(1, 4).map(e => `"${e.title}" +${e.minutesAway}m`).join(', ')}`);
      }

      return lines.join('\n');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Server setup ─────────────────────────────────────────
const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;

  // If this is a slow tool and the client requested progress notifications,
  // start a heartbeat that pings `notifications/progress` every few seconds
  // until the tool returns. This is the ONLY reliable way to prevent the
  // MCP client (e.g. Claude Desktop) from timing out a ~60s local-AI call.
  //
  // The MCP spec says clients SHOULD treat each progress notification as
  // activity that delays timeout. If the client didn't request progress
  // (no progressToken), we skip the heartbeat — there's nothing we can do
  // from the server side to extend the timeout in that case, but the tool
  // will still run to completion; we just won't hear back if it overruns.
  const progressToken = request.params._meta?.progressToken;
  let heartbeat: NodeJS.Timeout | null = null;
  let heartbeatCount = 0;

  if (progressToken != null && SLOW_TOOLS.has(name)) {
    // Send an immediate "starting" progress ping so the client sees work
    // begin right away. Failures are non-fatal — swallow them.
    extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: 0,
        message: `${name} started (may take 30-120s for local AI inference)`,
      },
    }).catch(() => {});

    heartbeat = setInterval(() => {
      heartbeatCount += 1;
      const elapsedSec = heartbeatCount * (HEARTBEAT_INTERVAL_MS / 1000);
      extra.sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: heartbeatCount,
          message: `${name} still running... (${elapsedSec}s elapsed)`,
        },
      }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
  }

  try {
    const text = await handleTool(name, args);
    return {
      content: [{ type: 'text', text }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
});

// ── Start ────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers must NOT log to stdout (it would corrupt the JSON-RPC stream).
  // Status messages go to stderr.
  console.error(`◈ Nexus MCP server online — talking to ${NEXUS_BASE}`);
  console.error(`◈ ${TOOLS.length} tools available: ${TOOLS.map((t) => t.name).join(', ')}`);
}

main().catch((err) => {
  console.error('◈ Nexus MCP server failed to start:', err);
  process.exit(1);
});
