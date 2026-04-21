// v4.5.6 — regression guard for the standalone-mode search contract.
//
// Root cause of the bug: `/api/smart-search` on the dashboard returns
// `{ query, method, results, stats }`, but the standalone localApi adapter
// used to return a flat array for BOTH `/api/search` and `/api/smart-search`.
// The MCP handler for `nexus_search` reads `data.results`, so in standalone
// mode (how the MCPB runs inside Claude Desktop) every search silently
// produced "No results".
//
// These specs lock the two shapes so future refactors can't regress:
//   /api/search        → Array (flat, consumed by the dashboard SearchModal)
//   /api/smart-search  → { query, method, results, stats } (consumed by MCP)

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

const TMP_ROOT = join(os.tmpdir(), `nexus-localapi-${Date.now()}`);
const DB_PATH = join(TMP_ROOT, 'nexus.json');
process.env.NEXUS_DB_PATH = DB_PATH;
process.env.NEXUS_STANDALONE = '1';

mkdirSync(TMP_ROOT, { recursive: true });
writeFileSync(DB_PATH, JSON.stringify({
  tasks: [
    { id: 1, title: 'search-me-please needle token', description: '', status: 'backlog', priority: 0, sort_order: 1, linked_files: '[]', project: 'Nexus', created_at: '2026-04-21', updated_at: '2026-04-21' },
  ],
  activity: [],
  sessions: [],
  usage: [],
  gpu_history: [],
  scratchpads: [],
  bookmarks: [],
  ledger: [],
  graph_edges: [],
  advice: [],
  thoughts: [],
  _appliedMigrations: { 'v4.3.5-C1': '2026-04-21', 'v4.3.5-I1': '2026-04-21', 'v4.3.9-H1': '2026-04-21', 'v4.4.0-H2': '2026-04-21', 'v4.4.1-H3': '2026-04-21' },
}));

const { localApiFetch } = await import('../server/mcp/localApi.ts');

describe('localApi search contract (v4.5.6)', () => {
  it('/api/search returns a flat array (dashboard SearchModal shape)', async () => {
    const result = await localApiFetch('/api/search?q=needle');
    expect(Array.isArray(result)).toBe(true);
    const hits = result as Array<{ type: string; title: string }>;
    expect(hits.length).toBeGreaterThan(0);
    // shape sanity — dashboard consumes `type` + `title`
    expect(hits[0]).toHaveProperty('type');
    expect(hits[0]).toHaveProperty('title');
  });

  it('/api/smart-search returns { query, method, results, stats } (MCP shape)', async () => {
    const result = await localApiFetch('/api/smart-search?q=needle') as {
      query?: string;
      method?: string;
      results?: unknown[];
      stats?: { total?: number };
    };
    expect(result).toBeTypeOf('object');
    // MCP reads data.results directly — this was the shape mismatch.
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.query).toBe('needle');
    expect(result.method).toBeTypeOf('string');
    expect(result.stats?.total).toBe((result.results as unknown[]).length);
    expect((result.results as unknown[]).length).toBeGreaterThan(0);
  });

  it('/api/smart-search returns empty results cleanly for no-match query', async () => {
    const result = await localApiFetch('/api/smart-search?q=zzz-definitely-not-in-corpus') as {
      results?: unknown[];
      stats?: { total?: number };
    };
    expect(Array.isArray(result.results)).toBe(true);
    expect((result.results as unknown[]).length).toBe(0);
    expect(result.stats?.total).toBe(0);
  });
});

// Cleanup after all tests in this file run
import { afterAll } from 'vitest';
afterAll(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});
