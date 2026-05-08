#!/usr/bin/env node
/**
 * Nexus MCP Server — entrypoint + registry + dispatcher + stdio transport.
 *
 * Exposes the Nexus metabrain as Model Context Protocol tools so every
 * Claude Code instance can call native `mcp__nexus__*` tools instead of
 * shelling out to the CLI or fetching the HTTP API.
 *
 * v4.7.6 (#217 part 4) — architecture:
 *   server/mcp/lib/
 *     config.ts       — STANDALONE / NEXUS_BASE / SERVER_NAME / SERVER_STARTED_AT
 *     nexusFetch.ts   — HTTP/standalone API helper + SLOW_TOOLS + heartbeat constant
 *     format.ts       — formatBrief / formatPlan / formatGuard + BriefData type
 *   server/mcp/tools/
 *     read.ts         — 10 read tools (brief, plan, guard, search, critique, predict_gaps,
 *                       blast_radius, ask_overseer, version, read_handover)
 *     write.ts        — 13 write tools (record/update_decision, push/pop_thought, log_usage,
 *                       create/complete/delete_task, log_activity/session, link_decisions,
 *                       update_handover, import_cc_memories)
 *     ai.ts           — 3 async-AI tools (ask_overseer_start, get_overseer_result, propose_edges)
 *     composite.ts    — 3 composite tools (bridge_session, fleet_overview, calendar_runway)
 *   server/mcp/index.ts (this file) — combined registry + dispatcher + main()
 *
 * Slow tools (nexus_ask_overseer, nexus_bridge_session) get progress-notification
 * heartbeats during execution so a 30–120s local-AI inference doesn't trip the
 * MCP client's tool-call timeout. Spec: progress notifications SHOULD reset
 * the client's inactivity timer per the MCP protocol.
 *
 * Run via: `npx tsx server/mcp/index.ts`
 * Or use the `nexus mcp` CLI subcommand which prints the Claude Code config snippet.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

// ── Configuration + foundation libs ─────────────────────
import { SERVER_NAME, SERVER_VERSION, NEXUS_BASE } from './lib/config.ts';
// Importing nexusFetch.ts here triggers its top-level await (loads the
// standalone localApi adapter when NEXUS_STANDALONE=1). That side-effect
// has to happen before any tool handler runs.
import { SLOW_TOOLS, HEARTBEAT_INTERVAL_MS } from './lib/nexusFetch.ts';

// ── Per-category tool modules ───────────────────────────
import { readTools, readHandlers } from './tools/read.ts';
import { writeTools, writeHandlers } from './tools/write.ts';
import { aiTools, aiHandlers } from './tools/ai.ts';
import { compositeTools, compositeHandlers } from './tools/composite.ts';

// ── Combined tool registry ──────────────────────────────
// Spread order = order in ListTools response. We keep read → write → ai →
// composite as a stable convention; mcpb/manifest.json mirrors this same
// ordering so the drift test stays content-equal.
const TOOLS: Tool[] = [
  ...readTools,
  ...writeTools,
  ...aiTools,
  ...compositeTools,
];

const handlers: Record<string, (args: any) => Promise<string>> = {
  ...readHandlers,
  ...writeHandlers,
  ...aiHandlers,
  ...compositeHandlers,
};

async function handleTool(name: string, args: any): Promise<string> {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args);
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
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${(err as Error).message}`,
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
