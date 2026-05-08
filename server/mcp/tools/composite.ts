/**
 * Composite tools — operations that orchestrate multiple underlying calls.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4). 3 tools:
 *   nexus_bridge_session  — end-of-work ritual (auto-summary + thought push)
 *   nexus_fleet_overview  — cross-project priority matrix
 *   nexus_calendar_runway — fuel-vs-meeting fit classifier (calendar MCP feeder)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { nexusFetch } from '../lib/nexusFetch.ts';

export const compositeTools: Tool[] = [
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
        project: { type: 'string', description: 'Project to bridge (defaults to "Nexus").' },
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
        buffer_minutes: { type: 'number', description: 'Context-switch buffer before the meeting. Default 15.' },
      },
      required: ['events'],
    },
  },
];

export const compositeHandlers: Record<string, (args: any) => Promise<string>> = {
  async nexus_bridge_session(args) {
    const project = args?.project || 'Nexus';
    const commitSummary = args?.commit_summary === true;

    const results: string[] = ['◈ Bridging session'];
    results.push('');

    // Step 1: Generate (and optionally commit) a session summary.
    interface AutoSummaryResponse {
      id?: number;
      error?: string;
      parsed?: { summary: string; decisions?: string[]; tags?: string[] };
    }
    let summary: AutoSummaryResponse | undefined;
    if (commitSummary) {
      summary = await nexusFetch('/api/auto-summary', {
        method: 'POST',
        body: JSON.stringify({ project }),
      }) as AutoSummaryResponse;
      if (summary?.id) {
        results.push(`✓ Session #${summary.id} committed for ${project}`);
      } else if (summary?.error) {
        results.push(`⚠ Summary generation failed: ${summary.error}`);
      }
    } else {
      summary = await nexusFetch(
        `/api/auto-summary?project=${encodeURIComponent(project)}`
      ) as AutoSummaryResponse;
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
      }) as { id: number };
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
  },

  async nexus_fleet_overview() {
    const data = await nexusFetch('/api/fleet') as {
      topTasks?: Array<{ id: number; status: string; title: string; priority?: number; score: number; ageDays: number }>;
      staleness?: Record<string, number>;
    };
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
  },

  async nexus_calendar_runway(args) {
    interface EventLike { start?: string; title?: string; summary?: string }
    const rawEvents: EventLike[] = Array.isArray(args?.events) ? args.events : [];
    const buffer = Number.isFinite(args?.buffer_minutes) ? Math.max(0, args.buffer_minutes) : 15;

    // Pull current fuel + runway. Nexus owns this data in both HTTP and standalone modes.
    interface EstimatorResponse {
      tracked: boolean;
      estimated?: { session?: number };
      session?: { minutesRemaining?: number | null };
    }
    const fuel = await nexusFetch('/api/estimator') as EstimatorResponse;
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
  },
};
