/**
 * Nexus HTTP/standalone API helper used by every MCP tool handler.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4). Single source of
 * truth for how tool handlers reach the Nexus data layer:
 *   - Standalone mode (NEXUS_STANDALONE=1): direct in-process calls into
 *     server/mcp/localApi.ts, no HTTP hop. This is the MCPB default.
 *   - Proxy mode: forwards to the Express server at NEXUS_BASE with a single
 *     500ms retry to cover server-restart windows.
 *
 * Also exports SLOW_TOOLS and HEARTBEAT_INTERVAL_MS so the entrypoint can wire
 * progress notifications without importing every tool module.
 */

import { STANDALONE, NEXUS_BASE } from './config.ts';

// Slow tools — get progress-notification heartbeats during execution so a
// 30–120s local-AI call doesn't trip the MCP client's tool-call timeout.
export const SLOW_TOOLS = new Set<string>([
  'nexus_ask_overseer',
  'nexus_bridge_session',
]);

export const HEARTBEAT_INTERVAL_MS = 8000; // ping every 8s — well under typical 60s timeouts

// Standalone-mode adapter: imported lazily so non-standalone runs don't pay
// the cost. Top-level await keeps the original v4.2.0 behavior — by the time
// any tool handler calls nexusFetch(), the import has resolved.
let localApiFetch: ((path: string, init?: { method?: string; body?: string }) => Promise<unknown>) | null = null;
if (STANDALONE) {
  try {
    const mod = await import('../localApi.ts');
    localApiFetch = mod.localApiFetch;
    console.error('◈ Standalone mode — using in-process NexusStore at', process.env.NEXUS_DB_PATH || '~/.nexus/nexus.json');
  } catch (err) {
    console.error('◈ Failed to load standalone adapter:', (err as Error).message);
  }
}

/**
 * Talk to the Nexus data layer. Same shape as fetch() but routes to
 * standalone or proxy depending on env. Returns parsed JSON.
 */
export async function nexusFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  // Standalone mode: route directly to in-process store
  if (localApiFetch) {
    return localApiFetch(path, {
      method: init.method,
      body: init.body
        ? typeof init.body === 'string'
          ? init.body
          : JSON.stringify(init.body)
        : undefined,
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
  } catch (err) {
    // Single retry after 500ms (covers server restart window)
    try {
      await new Promise((r) => setTimeout(r, 500));
      res = await doFetch();
    } catch {
      throw new Error(
        `Nexus server unreachable at ${NEXUS_BASE}. ` +
          `Start with: nexus-dev.bat, or set NEXUS_STANDALONE=1 for direct mode. ` +
          `(${(err as Error).message})`
      );
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Nexus API ${path} → ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}
