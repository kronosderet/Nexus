/**
 * Read tools — the brief / search / status side of the MCP surface.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4). 10 tools:
 *   nexus_brief, nexus_get_plan, nexus_check_guard, nexus_search,
 *   nexus_get_critique, nexus_predict_gaps, nexus_get_blast_radius,
 *   nexus_ask_overseer, nexus_version, nexus_read_handover.
 *
 * Each entry in `readTools` is a tool definition (name + description +
 * inputSchema). Each entry in `readHandlers` is the matching handler that
 * the dispatcher calls. The two are kept side-by-side here so a tool's
 * shape and behavior live in one file.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_COUNT_EXPECTED } from '../../lib/version.ts';
import { STANDALONE, NEXUS_BASE, SERVER_VERSION, SERVER_STARTED_AT } from '../lib/config.ts';
import { nexusFetch } from '../lib/nexusFetch.ts';
import { formatBrief, formatPlan, formatGuard, type BriefData } from '../lib/format.ts';

export const readTools: Tool[] = [
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
            'Project name. Defaults to "Nexus" (the workspace itself). Use whatever canonical name you use in your own ledger for other projects.',
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
    // v4.3.7 F1a — definitive "what version am I talking to?" answer.
    // Zero side-effects; reads in-memory state + one fast probe to the overseer endpoint.
    name: 'nexus_version',
    description:
      'Return the running Nexus server version, mode, applied migrations, tool count, uptime, and overseer availability. ' +
      'Call this when you need to verify which Nexus build is serving the session (after an MCPB update, a Claude Desktop restart, ' +
      'or when debugging a tool that should exist but doesn\'t). Cheap and side-effect-free.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // v4.6.0 #398 — Continuous Handover. Read the live per-project handover card.
    name: 'nexus_read_handover',
    description:
      'Read the continuous handover card for a project. The handover replaces the dated ' +
      'HANDOVER-YYYY-MM-DD.md file workflow — it is a live markdown card stored in Nexus ' +
      'that each instance updates before docking and the next reads on session start. ' +
      'Returns { project, content, updated_at, updated_by? } or a "not yet" signal if the project has no card. ' +
      'Defaults to project="Nexus" since that is the active development project most often.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project name to read the handover for. Defaults to "Nexus".',
        },
      },
    },
  },
];

export const readHandlers: Record<string, (args: any) => Promise<string>> = {
  // v4.3.5 P1 note: `args: any` is intentional. MCP tool arguments come from the
  // client as arbitrary JSON — the protocol has no schema validation at this layer.
  // Each handler validates its own required fields.

  async nexus_brief(args) {
    const project = args?.project || 'Nexus';
    // The /api/init endpoint returns init checks but not a full brief.
    // Compose a brief from multiple endpoints (the same data the CLI uses).
    // Per-call 10s timeout via Promise.race to prevent hanging on slow routes
    const withTimeout = <T>(p: Promise<T>, fallback: T) =>
      Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), 10000))]);
    const [tasks, sessions, ledger, fuel, risks, plansIndex, memoriesIndex, handover, contradictions, scans] = await Promise.all([
      withTimeout(nexusFetch('/api/tasks'), []),
      withTimeout(nexusFetch('/api/sessions'), []),
      withTimeout(nexusFetch('/api/ledger'), []),
      withTimeout(nexusFetch('/api/estimator'), null),
      withTimeout(nexusFetch('/api/overseer/risks'), { risks: [] }),
      withTimeout(nexusFetch('/api/cc-plans?limit=10'), { available: false, plans: [], totalFiles: 0 }),
      withTimeout(nexusFetch('/api/cc-memory?limit=40'), { available: false, memories: [], totalFiles: 0 }),
      // v4.6.0 #398 — Continuous Handover injection. Tolerate 404 when no card exists.
      withTimeout(
        nexusFetch(`/api/handover/${encodeURIComponent(project)}`).catch(() => null),
        null
      ) as Promise<null | { project: string; content: string; updated_at: string; updated_by?: string }>,
      // v4.7.3 #310 — auto-suggest contradictions count + last-scan age.
      withTimeout(
        nexusFetch('/api/impact/contradictions').catch(() => null),
        null
      ) as Promise<null | { suggestions?: unknown[] }>,
      withTimeout(
        nexusFetch('/api/scans?type=contradiction&limit=1').catch(() => null),
        null
      ) as Promise<null | Array<{ timestamp: string }>>,
    ]);

    const projectLower = project.toLowerCase();
    // Build dynamic project list from actual data (no hardcoded list)
    const allProjects = new Set<string>();
    // Sessions/ledger are opaque dispatcher returns (unknown); narrow via minimal shape.
    type HasProject = { project?: string };
    for (const s of sessions as HasProject[]) allProjects.add((s.project || '').toLowerCase());
    for (const d of (Array.isArray(ledger) ? ledger : []) as HasProject[]) allProjects.add((d.project || '').toLowerCase());
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

    // Minimal shapes for these dispatcher-return values — only the fields we read.
    type TaskLite = { status: string; title: string };
    type SessionLite = { project: string; created_at: string; summary: string };
    type DecisionLite = { decision: string; project: string };

    const activeTasks = (tasks as TaskLite[]).filter(
      (t) => t.status !== 'done' && inProject(t.title)
    );
    const priorSessions = (sessions as SessionLite[])
      .filter((s) => s.project === project || s.project?.toLowerCase() === projectLower)
      .slice(0, 5);
    const keyDecisions = (Array.isArray(ledger) ? ledger : [] as DecisionLite[])
      .filter((d: DecisionLite) => d.project === project || d.project?.toLowerCase() === projectLower)
      .slice(0, 5);

    // Filter CC plans by project (if inferred) — show project-matched ones first,
    // fall back to most-recent across projects if none match.
    type PlanEntryLite = { project?: string | null; title: string; ageDays: number; filename: string };
    const pi = (plansIndex || {}) as { plans?: PlanEntryLite[]; totalFiles?: number };
    const allPlans: PlanEntryLite[] = Array.isArray(pi.plans) ? pi.plans : [];
    const matchedPlans = allPlans.filter((p) => p.project && p.project.toLowerCase() === projectLower);
    const recentPlans = matchedPlans.length > 0 ? matchedPlans : allPlans.slice(0, 5);

    type MemoryEntryLite = { project?: string | null; type: string; description?: string; name?: string; filename?: string };
    const mi = (memoriesIndex || {}) as { memories?: MemoryEntryLite[]; totalFiles?: number };
    const allMemories: MemoryEntryLite[] = Array.isArray(mi.memories) ? mi.memories : [];
    const matchedMemories = allMemories.filter((m) => m.project && m.project.toLowerCase() === projectLower);
    const ccMemories = matchedMemories.length > 0 ? matchedMemories : allMemories.slice(0, 5);

    // v4.7.3 #310 — derive pending count + last-scan age for the brief.
    const pendingContradictions = Array.isArray((contradictions as { suggestions?: unknown[] } | null)?.suggestions)
      ? (contradictions as { suggestions: unknown[] }).suggestions.length
      : 0;
    let lastContradictionScanAgo: string | undefined;
    const scansArr = (scans as Array<{ timestamp: string }> | null) || [];
    if (Array.isArray(scansArr) && scansArr.length > 0 && scansArr[0]?.timestamp) {
      const ageH = (Date.now() - new Date(scansArr[0].timestamp).getTime()) / 3600000;
      lastContradictionScanAgo = ageH < 1
        ? `${Math.round(ageH * 60)}m`
        : ageH < 24
          ? `${Math.round(ageH)}h`
          : `${Math.round(ageH / 24)}d`;
    }

    const briefBody = formatBrief(
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
        risks: (risks as { risks?: Array<{ message?: string }> }).risks || [],
        pendingContradictions,
        lastContradictionScanAgo,
      } as BriefData,
      project
    );

    // v4.6.0 #398 — Continuous Handover prepend. When a card exists for the
    // project, lead with it so the next instance reads the live handover
    // before the structured brief. Falls through silently when none.
    if (handover && handover.content) {
      const ageH = (Date.now() - new Date(handover.updated_at).getTime()) / 3600000;
      const ageStr = ageH < 1 ? `${Math.round(ageH * 60)}m` : ageH < 24 ? `${Math.round(ageH)}h` : `${Math.round(ageH / 24)}d`;
      const header = `◈ HANDOVER · ${project} (updated ${ageStr} ago${handover.updated_by ? ' · ' + handover.updated_by : ''})`;
      return `${header}\n\n${handover.content}\n\n${'─'.repeat(60)}\n\n${briefBody}`;
    }
    return briefBody;
  },

  async nexus_get_plan(args) {
    const qs = args?.project ? `?project=${encodeURIComponent(args.project)}` : '';
    const data = await nexusFetch(`/api/plan${qs}`);
    return formatPlan(data as Record<string, unknown>);
  },

  async nexus_check_guard(args) {
    if (!args?.title) throw new Error('title is required');
    const data = await nexusFetch(
      `/api/guard?title=${encodeURIComponent(args.title)}`
    );
    return formatGuard(data as Record<string, unknown>, args.title);
  },

  async nexus_search(args) {
    if (!args?.query) throw new Error('query is required');
    const data = await nexusFetch(
      `/api/smart-search?q=${encodeURIComponent(args.query)}`
    ) as { method?: string; results?: Array<{ type: string; score?: number; display?: string; title?: string; summary?: string; id?: number }> };
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
  },

  async nexus_get_critique() {
    const data = await nexusFetch('/api/critique') as {
      averageCompletionMinutes?: number;
      slowTasks?: Array<{ id: number; status: string; title?: string; minutes: number }>;
      stuckTasks?: Array<{ id: number; title?: string }>;
      insights?: string[];
    };
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
  },

  async nexus_predict_gaps() {
    const data = await nexusFetch('/api/predict') as {
      suggestions?: Array<{ category: string; project?: string; title: string; priority?: number }>;
    };
    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) {
      return '◈ Graph is healthy. No gaps detected.';
    }
    const lines: string[] = [`◈ Predicted gaps (${suggestions.length})`];
    lines.push('');
    const byCategory: Record<string, typeof suggestions> = {};
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
  },

  async nexus_get_blast_radius(args) {
    if (args?.decision_id == null) throw new Error('decision_id is required');
    const data = await nexusFetch(`/api/impact/blast/${Number(args.decision_id)}`) as {
      decision?: { decision?: string };
      blastRadius?: number;
      warning?: string;
      affected?: Array<{ id: number; depth?: number; decision?: string }>;
      related?: Array<{ id: number; decision?: string }>;
    };
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
  },

  async nexus_ask_overseer(args) {
    if (!args?.question) throw new Error('question is required');
    const data = await nexusFetch('/api/overseer/ask', {
      method: 'POST',
      body: JSON.stringify({ question: args.question }),
    }) as { error?: string; answer?: string };
    if (data.error) return `◈ Overseer error: ${data.error}`;
    return `◈ Overseer:\n\n${data.answer || '(no response)'}`;
  },

  async nexus_version() {
    // v4.3.7 F1a — definitive "which Nexus is serving this session?" answer.
    // Reads: in-memory constants (SERVER_VERSION, STANDALONE, TOOL_COUNT_EXPECTED, SERVER_STARTED_AT),
    // the on-disk store for applied_migrations, and probes the local AI endpoint.
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const { detectAI } = await import('../../lib/aiEndpoints.ts');

    const storePath = process.env.NEXUS_DB_PATH || join(homedir(), '.nexus', 'nexus.json');
    let appliedMigrations: string[] = [];
    try {
      if (existsSync(storePath)) {
        const raw = JSON.parse(readFileSync(storePath, 'utf-8')) as { _appliedMigrations?: Record<string, string> };
        appliedMigrations = Object.keys(raw._appliedMigrations || {}).sort();
      }
    } catch (err) {
      console.error('[nexus_version] failed to read applied_migrations:', (err as Error).message);
    }

    const ai = await detectAI();
    const uptimeSeconds = Math.floor((Date.now() - SERVER_STARTED_AT) / 1000);

    const lines = [
      `◈ NEXUS VERSION`,
      ``,
      `  version:            ${SERVER_VERSION}`,
      `  mode:               ${STANDALONE ? 'standalone' : `dashboard (${NEXUS_BASE})`}`,
      `  store_path:         ${storePath}`,
      `  tool_count:         ${TOOL_COUNT_EXPECTED}`,
      `  uptime_seconds:     ${uptimeSeconds}`,
      `  applied_migrations: ${appliedMigrations.length > 0 ? appliedMigrations.join(', ') : '(none)'}`,
      `  overseer:           ${ai.available ? `${ai.provider} · ${ai.model}` : 'unavailable'}`,
    ];
    return lines.join('\n');
  },

  async nexus_read_handover(args) {
    // v4.6.0 #398 — Continuous Handover read.
    const project = String(args?.project || 'Nexus');
    try {
      const entry = await nexusFetch(`/api/handover/${encodeURIComponent(project)}`) as {
        project: string; content: string; updated_at: string; updated_by?: string;
      };
      const ageH = (Date.now() - new Date(entry.updated_at).getTime()) / 3600000;
      const ageStr = ageH < 1 ? `${Math.round(ageH * 60)}m` : ageH < 24 ? `${Math.round(ageH)}h` : `${Math.round(ageH / 24)}d`;
      return [
        `◈ Handover · ${project} (updated ${ageStr} ago${entry.updated_by ? ' · ' + entry.updated_by : ''})`,
        '',
        entry.content,
      ].join('\n');
    } catch (err) {
      if (String((err as Error).message).includes('404')) {
        return `◈ No handover yet for project "${project}". Use nexus_update_handover to write the first one.`;
      }
      throw err;
    }
  },
};
