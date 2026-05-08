/**
 * Write tools — operations that mutate the Nexus store.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4). 13 tools:
 *   nexus_record_decision, nexus_update_decision, nexus_push_thought,
 *   nexus_pop_thought, nexus_log_usage, nexus_create_task, nexus_complete_task,
 *   nexus_delete_task, nexus_log_activity, nexus_log_session,
 *   nexus_link_decisions, nexus_update_handover, nexus_import_cc_memories.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { nexusFetch } from '../lib/nexusFetch.ts';

export const writeTools: Tool[] = [
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
        lifecycle: { type: 'string', enum: ['proposed', 'active', 'validated', 'deprecated', 'reference'], description: 'Decision lifecycle state (optional). \'reference\' marks imported CC memories — v4.3.8.' },
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
      'For the weekly window, pass weekly_reset_in_hours OR weekly_reset_at (ISO) when the user ' +
      'reports the weekly reset time — the legacy hardcoded Thursday-21:00 fallback is only ' +
      'used pre-first-report or when the recorded reset has passed. ' +
      'This feeds the Fuel Intelligence module, burn-rate estimation, workload advisor, and the Overseer ' +
      'risk scanner. Call it whenever the user reports a new fuel reading.',
    inputSchema: {
      type: 'object',
      properties: {
        session_percent: { type: 'number', description: 'Session fuel REMAINING (0-100). If the user says "17% used", pass 83.' },
        weekly_percent: { type: 'number', description: 'Weekly fuel REMAINING (0-100) for "All models" limit. If the user says "42% used", pass 58.' },
        sonnet_weekly_percent: { type: 'number', description: 'Optional: "Sonnet only" weekly fuel REMAINING (0-100). Separate from All models limit.' },
        extra_usage: { type: 'boolean', description: 'Optional: true if user is on pay-per-use overflow (session limit hit but still working).' },
        reset_in_minutes: { type: 'number', description: 'Optional: minutes until the session window resets. If provided, (re)starts the session timing window. Example: "resets in 3h 43m" → 223.' },
        weekly_reset_in_hours: { type: 'number', description: 'Optional: hours until the weekly window resets (sliding model, v4.5.11+). Example: "Resets Sat 10:00 AM" 6 days out → 144. Slides whenever a fresh reading is logged.' },
        weekly_reset_at: { type: 'string', description: 'Optional: ISO timestamp of the next weekly reset. Alternative to weekly_reset_in_hours when the exact time is known.' },
        note: { type: 'string', description: 'Optional free-text note attached to this reading (e.g. "before starting MCP tool work").' },
        plan: { type: 'string', enum: ['free', 'pro', 'max5', 'max20', 'team', 'team_premium', 'enterprise', 'api'], description: 'Optional: Claude subscription plan. Set once and it persists. Affects capacity estimates.' },
        timezone: { type: 'string', description: 'Optional: IANA timezone (e.g. "Europe/Prague", "America/New_York"). Affects reset time display.' },
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
        title: { type: 'string', description: 'Task title. Be specific — "Fix auth bug" is weak, "Fix token refresh race in auth middleware causing 401s after token rotation" is strong.' },
        description: { type: 'string', description: 'Optional longer description or context for the task.' },
        project: { type: 'string', description: 'Optional project name. If omitted, defaults to "Nexus". Use whatever canonical name you use for the target project in your own ledger.' },
        status: { type: 'string', enum: ['backlog', 'in_progress', 'review', 'done'], description: 'Initial status. Defaults to "backlog".' },
        priority: { type: 'number', description: 'Optional priority 0-2 (0=low, 1=normal, 2=high).' },
        decision_ids: { type: 'array', items: { type: 'number' }, description: 'Optional: IDs of decisions this task implements or relates to.' },
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
      properties: { id: { type: 'number', description: 'Task id to mark as done.' } },
      required: ['id'],
    },
  },
  {
    name: 'nexus_delete_task',
    description:
      'Permanently delete a task by id. Unlike nexus_complete_task (which marks done but keeps the ' +
      'task in the ledger), this removes the task entirely. Use for throwaway / smoke-test / ' +
      'duplicate tasks that shouldn\'t live in the metabrain. Prefer nexus_complete_task for real work.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Task id to delete.' } },
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
        message: { type: 'string', description: 'The activity message. Concrete and past-tense.' },
        type: { type: 'string', description: 'Optional entry type for filtering (e.g. "deploy", "fix", "decision", "system"). Defaults to "system".' },
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
        project: { type: 'string', description: 'Project this session belongs to.' },
        summary: { type: 'string', description: 'Narrative summary of the work. 2-5 sentences. Lead with outcomes, not process.' },
        decisions: { type: 'array', items: { type: 'string' }, description: 'Strategic/architectural decisions made during this session. These will be extracted into The Ledger.' },
        blockers: { type: 'array', items: { type: 'string' }, description: 'Things that blocked or impeded work (empty array if none).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Short tags for later search/filter.' },
        files_touched: { type: 'array', items: { type: 'string' }, description: 'File paths modified during this session.' },
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
        from: { type: 'number', description: 'Source decision id.' },
        to: { type: 'number', description: 'Target decision id.' },
        rel: {
          type: 'string',
          enum: ['led_to', 'depends_on', 'contradicts', 'replaced', 'related', 'informs', 'experimental'],
          description: 'Edge type. "led_to" = causal, "depends_on" = prerequisite, "contradicts" = conflict, "replaced" = supersession, "related" = weak association, "informs" = provides context without being a requirement, "experimental" = tentative link, revisit later.',
        },
        note: { type: 'string', description: 'Optional note explaining why the link exists.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    // v4.6.0 #398 — Continuous Handover. Write/replace the per-project handover card.
    name: 'nexus_update_handover',
    description:
      'Write or replace the continuous handover card for a project. Call before docking — the ' +
      'next instance picking up this project will read whatever you write here. Markdown body, ' +
      '~500-word soft cap (no enforcement; treat as discipline). Include: current state, what is ' +
      'in flight, what to pick up next, gotchas. Architecture-spine / slow-moving content belongs ' +
      'in docs/ARCHITECTURE.md instead — keep this card live and short. Returns the saved entry ' +
      'with updated_at timestamp.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        project: { type: 'string', description: 'Project name. Defaults to "Nexus".' },
        content: { type: 'string', description: 'Full markdown content of the new handover card. Replaces any prior card for this project.' },
        updated_by: { type: 'string', description: 'Optional source label (e.g. "claude-cli", "dashboard", "v4.6.0-instance"). Aids audit trail.' },
      },
    },
  },
  {
    // v4.3.8 #200 — Memory Bridge first-run import. Turns CC's auto-memory files into reference decisions.
    name: 'nexus_import_cc_memories',
    description:
      'Import Claude Code\'s auto-memory files as reference decisions in The Ledger. ' +
      'v4.7.0+ scans every source configured in `_memoryBridge.sources[]` (default: ' +
      '~/.claude/projects/*/memory/*.md, identical to v4.6.x behavior). Add Cowork-sandbox / ' +
      'cross-machine paths by appending entries to that array in ~/.nexus/nexus.json. Each memory ' +
      'becomes a decision with lifecycle=\'reference\' and tag \'cc-memory\'. Safe to re-run; skips ' +
      'already-imported memories and refreshes ones whose content changed. Use dry_run first to ' +
      'preview what would be imported. References don\'t pollute getActiveDecisions or test-gap ' +
      'analysis but ARE searchable via nexus_search and linkable via nexus_link_decisions. ' +
      'Set source_filter to a source name (e.g. "cowork-sandbox") to scan just one source for debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Optional: only import memories whose inferred project matches (case-insensitive).' },
        dry_run: { type: 'boolean', description: 'If true, report counts + samples without writing. Recommended for the first invocation. Default false.' },
        force: { type: 'boolean', description: 'If true, re-import even already-tracked memories (refreshes their decision content). Default false.' },
        source_filter: { type: 'string', description: 'v4.7.0+: limit scan to one configured source by name (e.g. "cowork-sandbox"). Useful for debugging a specific source. Default: scan all enabled sources.' },
      },
    },
  },
];

export const writeHandlers: Record<string, (args: any) => Promise<string>> = {
  async nexus_record_decision(args) {
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
    }) as { id: number };
    let out = `◈ Decision #${result.id} recorded for ${args.project}\n  ${args.decision}`;

    // v4.3 #198 Phase B — optional CC memory emission.
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
  },

  async nexus_update_decision(args) {
    if (args?.id == null) throw new Error('id is required');
    const body: Record<string, unknown> = {};
    if (args.decision) body.decision = args.decision;
    if (args.rationale) body.context = args.rationale;
    if (args.project) body.project = args.project;
    if (args.tags) body.tags = args.tags;
    if (args.lifecycle) body.lifecycle = args.lifecycle;
    if (args.confidence != null) body.confidence = args.confidence;
    const result = await nexusFetch(`/api/ledger/${Number(args.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as { id: number; decision: string };
    return `◈ Decision #${result.id} updated\n  ${result.decision}`;
  },

  async nexus_push_thought(args) {
    if (!args?.text) throw new Error('text is required');
    const result = await nexusFetch('/api/thoughts', {
      method: 'POST',
      body: JSON.stringify({
        text: args.text,
        context: args.context || undefined,
        project: args.project || undefined,
        related_task_id: args.related_task_id || undefined,
      }),
    }) as { id: number };
    const base = `◈ Thought #${result.id} pushed onto the stack.\n  "${args.text}"${
      args.context ? `\n  context: ${args.context}` : ''
    }`;
    // #192 bridge suggestion: when linked to a task, nudge toward spawn_task.
    if (args.related_task_id) {
      return base + `\n\n  ◈ Bridge: consider mcp__ccd_session__spawn_task("Resolve #${args.related_task_id}", ...) to run this as a CC side-task. Completing the spawned task via nexus_complete_task(${args.related_task_id}) will auto-pop this thought.`;
    }
    return base;
  },

  async nexus_pop_thought(args) {
    const body = args?.id ? { id: args.id } : {};
    try {
      const result = await nexusFetch('/api/thoughts/pop', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as { id: number; text: string; context?: string; project?: string };
      return `◈ Popped thought #${result.id}:\n\n  ${result.text}${
        result.context ? `\n\n  context: ${result.context}` : ''
      }${result.project ? `\n  project: ${result.project}` : ''}`;
    } catch (err) {
      if ((err as Error).message?.includes('404')) {
        return '◈ Stack is empty. Nothing to pop.';
      }
      throw err;
    }
  },

  async nexus_log_usage(args) {
    if (args?.session_percent == null && args?.weekly_percent == null) {
      throw new Error(
        'Provide session_percent and/or weekly_percent (percentages REMAINING, not used).'
      );
    }
    const body: Record<string, unknown> = {};
    if (args.session_percent != null) body.session_percent = Number(args.session_percent);
    if (args.weekly_percent != null) body.weekly_percent = Number(args.weekly_percent);
    if (args.sonnet_weekly_percent != null) body.sonnet_weekly_percent = Number(args.sonnet_weekly_percent);
    if (args.extra_usage != null) body.extra_usage = !!args.extra_usage;
    if (args.reset_in_minutes != null) body.reset_in_minutes = Number(args.reset_in_minutes);
    if (args.weekly_reset_in_hours != null) body.weekly_reset_in_hours = Number(args.weekly_reset_in_hours);
    if (args.weekly_reset_at) body.weekly_reset_at = String(args.weekly_reset_at);
    if (args.note) body.note = String(args.note);
    if (args.plan) body.plan = args.plan;
    if (args.timezone) body.timezone = args.timezone;

    const result = await nexusFetch('/api/usage', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as {
      session_percent?: number;
      weekly_percent?: number;
      timing?: { session?: { countdown?: string }; weekly?: { countdown?: string } };
    };

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
    if (result.session_percent != null && result.session_percent <= 15) {
      lines.push(`  ⚠ Session fuel LOW (${result.session_percent}%) — consider wrapping up.`);
    }
    if (result.weekly_percent != null && result.weekly_percent <= 10) {
      lines.push(`  ⚠ Weekly fuel CRITICAL (${result.weekly_percent}%) — ration carefully.`);
    }
    return lines.join('\n');
  },

  async nexus_create_task(args) {
    if (!args?.title) throw new Error('title is required');
    const body: Record<string, unknown> = {
      title: args.title,
      status: args.status || 'backlog',
    };
    if (args.description) body.description = args.description;
    if (args.priority != null) body.priority = Number(args.priority);
    if (args.decision_ids) body.decision_ids = args.decision_ids;
    if (args.project) body.project = args.project;
    const result = await nexusFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as { id: number; status: string; title: string };
    return `◈ Task #${result.id} plotted [${result.status}]\n  ${result.title}`;
  },

  async nexus_complete_task(args) {
    if (args?.id == null) throw new Error('id is required');
    const result = await nexusFetch(`/api/tasks/${Number(args.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    }) as { id: number; title: string; resolvedThoughts?: number };
    const lines = [`◈ Landmark reached #${result.id}`, `  ${result.title}`];
    if ((result.resolvedThoughts || 0) > 0) {
      lines.push(`  ◈ Auto-resolved ${result.resolvedThoughts} linked thought${result.resolvedThoughts! > 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  },

  async nexus_delete_task(args) {
    if (args?.id == null) throw new Error('id is required');
    await nexusFetch(`/api/tasks/${Number(args.id)}`, { method: 'DELETE' });
    return `◈ Task #${Number(args.id)} removed from charts`;
  },

  async nexus_log_activity(args) {
    if (!args?.message) throw new Error('message is required');
    const body = {
      type: args.type || 'system',
      message: String(args.message),
    };
    const result = await nexusFetch('/api/activity', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as { type: string; message: string };
    return `◈ Logged [${result.type}]: ${result.message}`;
  },

  async nexus_log_session(args) {
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
    }) as { id: number; project: string; summary: string };
    const lines = [
      `◈ Session #${result.id} recorded for ${result.project}`,
      `  ${result.summary.slice(0, 120)}${result.summary.length > 120 ? '...' : ''}`,
    ];
    if (body.decisions.length) lines.push(`  ${body.decisions.length} decision${body.decisions.length !== 1 ? 's' : ''} captured`);
    if (body.blockers.length) lines.push(`  ⚠ ${body.blockers.length} blocker${body.blockers.length !== 1 ? 's' : ''}`);
    if (body.tags.length) lines.push(`  tags: ${body.tags.join(', ')}`);
    return lines.join('\n');
  },

  async nexus_link_decisions(args) {
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
    }) as { id?: number };
    let response = `◈ Linked #${body.from} --[${body.rel}]--> #${body.to}${
      result.id ? ` (edge #${result.id})` : ''
    }`;
    // v4.5.10 #278 — when caller picks the generic 'related' edge, suggest more specific.
    if (body.rel === 'related') {
      response += '\n  💡 Consider a more specific type: `led_to` (A caused B), `depends_on` (B requires A), `informs` (A provides context for B), `supersedes` (B replaces A), `experimental` (tentative, revisit).';
    }
    return response;
  },

  async nexus_update_handover(args) {
    // v4.6.0 #398 — Continuous Handover write.
    if (typeof args?.content !== 'string') throw new Error('content (string) is required');
    const project = String(args?.project || 'Nexus');
    const body = JSON.stringify({
      content: args.content,
      ...(args?.updated_by ? { updated_by: String(args.updated_by) } : {}),
    });
    const entry = await nexusFetch(`/api/handover/${encodeURIComponent(project)}`, {
      method: 'PUT', body,
    }) as { project: string; content: string; updated_at: string };
    return `◈ Handover saved · ${entry.project} · ${entry.content.length} chars · ${entry.updated_at}`;
  },

  async nexus_import_cc_memories(args) {
    // v4.3.8 #200 — Memory Bridge first-run import.
    // v4.7.0-M1 — multi-source: respects `_memoryBridge.sources[]` config; supports `source_filter`.
    const body = JSON.stringify({
      project: args?.project,
      dry_run: !!args?.dry_run,
      force: !!args?.force,
      source_filter: args?.source_filter,
    });
    type ImportResult = {
      imported: number; skipped: number; updated: number; failed: number;
      totalScanned: number; totalFilesScanned?: number; uniqueScanned?: number; dryRun: boolean;
      samples: Array<{ path: string; project: string | null; type: string; name: string; action: string; source?: string; machineHint?: string }>;
      sourceErrors?: Array<{ source: string; error: string }>;
      sourcesScanned?: number;
    };
    const result = await nexusFetch('/api/import-cc-memories', { method: 'POST', body }) as ImportResult;

    const filterTags: string[] = [];
    if (args?.project) filterTags.push(`project: ${args.project}`);
    if (args?.source_filter) filterTags.push(`source: ${args.source_filter}`);
    const filterSuffix = filterTags.length ? ` (filtered to ${filterTags.join(', ')})` : '';

    const header = result.dryRun ? '◈ Memory Bridge import — dry run' : '◈ Memory Bridge import complete';
    // v4.7.0-M1 — show raw-files / unique / post-filter counts when they differ
    const rawFiles = result.totalFilesScanned ?? result.totalScanned;
    const unique = result.uniqueScanned ?? result.totalScanned;
    const sourcesN = result.sourcesScanned ?? 1;
    const scanLine =
      rawFiles === result.totalScanned
        ? `  ${result.totalScanned} memor${result.totalScanned === 1 ? 'y' : 'ies'} scanned across ${sourcesN} source${sourcesN === 1 ? '' : 's'}${filterSuffix}`
        : `  ${rawFiles} files seen across ${sourcesN} source${sourcesN === 1 ? '' : 's'} → ${unique} unique → ${result.totalScanned} after filters${filterSuffix}`;
    const lines = [
      header,
      scanLine,
      `  · ${result.imported} new${result.dryRun ? ' (would import)' : ''}`,
      `  · ${result.skipped} already on file (skipped)`,
      `  · ${result.updated} updated${result.dryRun ? ' (would refresh)' : ''}`,
    ];
    if (result.failed > 0) lines.push(`  · ${result.failed} failed — see server logs`);
    if (result.sourceErrors && result.sourceErrors.length > 0) {
      lines.push('');
      lines.push('  Source errors (continuing past these):');
      for (const se of result.sourceErrors) {
        lines.push(`    ! [${se.source}] ${se.error}`);
      }
    }
    if (result.samples.length > 0) {
      lines.push('');
      lines.push('  Samples:');
      for (const s of result.samples) {
        const projTag = s.project ? ` (${s.project})` : '';
        const srcTag = s.source ? `  ← ${s.source}${s.machineHint ? `/${s.machineHint}` : ''}` : '';
        lines.push(`    › [${s.type}] ${s.name}${projTag}  ${s.action}${srcTag}`);
      }
    }
    if (result.dryRun && (result.imported > 0 || result.updated > 0)) {
      lines.push('');
      lines.push('  Re-invoke without dry_run to apply.');
    }
    return lines.join('\n');
  },
};
