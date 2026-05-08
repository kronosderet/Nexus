/**
 * Async-AI tools — fire-and-poll Overseer operations.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4). 3 tools:
 *   nexus_ask_overseer_start, nexus_get_overseer_result, nexus_propose_edges.
 *
 * These return a taskId immediately and rely on the caller to poll
 * /api/overseer/ask/result/:taskId — designed to outlast the MCP client's
 * tool-call timeout for long local-AI inferences.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { nexusFetch } from '../lib/nexusFetch.ts';

export const aiTools: Tool[] = [
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
        question: { type: 'string', description: 'The strategic question to ask.' },
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
        task_id: { type: 'string', description: 'The taskId returned by nexus_ask_overseer_start.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'nexus_propose_edges',
    description:
      'Ask the local Overseer (LM Studio) to propose typed Knowledge Graph edges for a decision. ' +
      'Given a decision id, Nexus pulls candidate decisions (project-matched, newest first), builds a ' +
      'structured prompt, and the Overseer returns JSON edge proposals with {from_id, to_id, rel, confidence, reason}. ' +
      'Async — returns taskId; poll with nexus_get_overseer_result. After reviewing, commit the edges you like ' +
      'via nexus_link_decisions. Requires the Nexus dashboard running (async task infrastructure). ' +
      'Use after recording a significant decision to let the Overseer suggest non-obvious connections ' +
      'beyond keyword/embedding overlap.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: { type: 'number', description: 'ID of the subject decision to propose edges for.' },
        candidate_pool_size: { type: 'number', description: 'How many existing decisions to compare against. Default 10, max 30.' },
        project_scope: { type: 'string', description: 'Optional: restrict candidates to this project. Defaults to the subject decision\'s project.' },
      },
      required: ['decision_id'],
    },
  },
];

export const aiHandlers: Record<string, (args: any) => Promise<string>> = {
  async nexus_ask_overseer_start(args) {
    if (!args?.question) throw new Error('question is required');
    const data = await nexusFetch('/api/overseer/ask/start', {
      method: 'POST',
      body: JSON.stringify({ question: args.question }),
    }) as { error?: string; taskId?: string; status?: string };
    if (data.error) return `◈ Overseer error: ${data.error}`;
    return `◈ Overseer query started.\n  taskId: ${data.taskId}\n  status: ${data.status}\n\nPoll with nexus_get_overseer_result({ task_id: "${data.taskId}" }) every 10-15s.`;
  },

  async nexus_get_overseer_result(args) {
    if (!args?.task_id) throw new Error('task_id is required');
    const data = await nexusFetch(`/api/overseer/ask/result/${encodeURIComponent(args.task_id)}`) as {
      status: string; elapsed?: number; error?: string; answer?: string;
    };
    if (data.status === 'pending') {
      return `◈ Overseer still thinking... (${data.elapsed}s elapsed)\n  Poll again in 10-15 seconds.`;
    }
    if (data.status === 'error') {
      return `◈ Overseer error: ${data.error}`;
    }
    return `◈ Overseer (completed in ${data.elapsed}s):\n\n${data.answer || '(no response)'}`;
  },

  async nexus_propose_edges(args) {
    if (args?.decision_id == null) throw new Error('decision_id is required');
    const body = {
      decision_id: Number(args.decision_id),
      candidate_pool_size: args.candidate_pool_size,
      project_scope: args.project_scope,
    };
    interface ProposeEdgesResponse {
      error?: string;
      taskId?: string;
      candidates?: number;
      subject?: { id: number; decision: string; project: string };
    }
    const result: ProposeEdgesResponse = await nexusFetch('/api/overseer/propose-edges', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as ProposeEdgesResponse;
    if (result?.error) return `◈ Edge proposal unavailable: ${result.error}`;
    const lines = [
      `◈ Edge proposal started for decision #${result.subject?.id}: "${result.subject?.decision?.slice(0, 80) || ''}"`,
      `  Project: ${result.subject?.project || '(none)'} · Candidates compared: ${result.candidates}`,
      `  Task ID: ${result.taskId}`,
      '',
      `  Poll with: nexus_get_overseer_result(task_id: "${result.taskId}")`,
      `  Expect JSON: { "proposals": [ { "from_id", "to_id", "rel", "confidence", "reason" } ] }`,
      `  Commit chosen edges via nexus_link_decisions(from, to, rel, note).`,
    ];
    return lines.join('\n');
  },
};
