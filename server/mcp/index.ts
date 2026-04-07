#!/usr/bin/env node
/**
 * Nexus MCP Server — v3.1
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
 * v1.1 toolset (7 tools):
 *   - nexus_brief             — current state for a given project
 *   - nexus_get_plan          — AI-generated session plan with fuel context
 *   - nexus_check_guard       — redundancy check before starting work
 *   - nexus_record_decision   — write a strategic decision into the Ledger
 *   - nexus_push_thought      — push a thought onto the interrupt-recovery stack
 *   - nexus_pop_thought       — pop the top thought (recover from interruption)
 *   - nexus_log_usage         — log session/weekly fuel readings (closes the last bash gap)
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
const NEXUS_BASE = process.env.NEXUS_BASE_URL || 'http://localhost:3001';
const SERVER_NAME = 'nexus';
const SERVER_VERSION = '3.1.1';

// ── HTTP helper ──────────────────────────────────────────
async function nexusFetch(
  path: string,
  init: RequestInit = {}
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${NEXUS_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (err: any) {
    throw new Error(
      `Nexus server unreachable at ${NEXUS_BASE}. ` +
        `Start it with: cd C:/Projects/Nexus && npm run dev:server. ` +
        `(${err.message})`
    );
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
      'Decisions become first-class nodes in the knowledge graph and feed into Overseer analysis, blast-radius queries, and the Compass module.',
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
      },
      required: ['decision', 'project'],
    },
  },
  {
    name: 'nexus_push_thought',
    description:
      'Push a thought onto the LIFO Thought Stack — the interrupt-recovery working memory. ' +
      'Call this BEFORE switching context, getting interrupted, or stopping mid-task. ' +
      'When you (or another Claude instance) return, call nexus_pop_thought to recover what you were doing. ' +
      'This is the cross-session continuity primitive.',
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
          description: 'Weekly fuel REMAINING (0-100). If the user says "94% used", pass 6.',
        },
        reset_in_minutes: {
          type: 'number',
          description: 'Optional: minutes until the session window resets. If provided, (re)starts the session timing window. Example: "resets in 3h 43m" → 223.',
        },
        note: {
          type: 'string',
          description: 'Optional free-text note attached to this reading (e.g. "before starting MCP tool work").',
        },
      },
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
      const [tasks, sessions, ledger, fuel, risks] = await Promise.all([
        nexusFetch('/api/tasks').catch(() => []),
        nexusFetch('/api/sessions').catch(() => []),
        nexusFetch('/api/ledger').catch(() => []),
        nexusFetch('/api/estimator').catch(() => null),
        nexusFetch('/api/overseer/risks').catch(() => ({ risks: [] })),
      ]);

      const projectLower = project.toLowerCase();
      const KNOWN = ['nexus', 'firewall-godot', 'noosphere', 'resonance godot', 'resonance-godot', 'shadowrun'];
      const inProject = (s: string) => {
        const t = (s || '').toLowerCase();
        if (t.includes(projectLower)) return true;
        if (projectLower === 'nexus') {
          return !KNOWN.filter((p) => p !== 'nexus').some((p) => t.includes(p));
        }
        return false;
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
      return `◈ Decision #${result.id} recorded for ${args.project}\n  ${args.decision}`;
    }

    case 'nexus_push_thought': {
      if (!args?.text) throw new Error('text is required');
      const result = await nexusFetch('/api/thoughts', {
        method: 'POST',
        body: JSON.stringify({
          text: args.text,
          context: args.context || undefined,
          project: args.project || undefined,
        }),
      });
      return `◈ Thought #${result.id} pushed onto the stack.\n  "${args.text}"${
        args.context ? `\n  context: ${args.context}` : ''
      }`;
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
      if (args.reset_in_minutes != null) body.reset_in_minutes = Number(args.reset_in_minutes);
      if (args.note) body.note = String(args.note);

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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
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
