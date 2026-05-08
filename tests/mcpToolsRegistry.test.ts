/**
 * Tests for v4.7.6 (#217 part 4) — MCP tools registry split into per-category files.
 *
 * Catches the most likely regression class for a module split: a tool silently
 * dropped during the move (renamed export, missing key in handlers, etc.). Same
 * shape as tests/cliCommands.test.js from v4.7.5.
 *
 * Imports the per-category modules directly (no entrypoint side-effects — the
 * stdio server setup lives only in server/mcp/index.ts which we don't import
 * here, so this test does not start a server).
 */
import { describe, it, expect } from 'vitest';

const { readTools, readHandlers } = await import('../server/mcp/tools/read.ts');
const { writeTools, writeHandlers } = await import('../server/mcp/tools/write.ts');
const { aiTools, aiHandlers } = await import('../server/mcp/tools/ai.ts');
const { compositeTools, compositeHandlers } = await import('../server/mcp/tools/composite.ts');
const { TOOL_COUNT_EXPECTED } = await import('../server/lib/version.ts');

const ALL_GROUPS = [
  ['read', readTools, readHandlers],
  ['write', writeTools, writeHandlers],
  ['ai', aiTools, aiHandlers],
  ['composite', compositeTools, compositeHandlers],
] as const;

// ──────────────────────────────────────────────────────────
// Per-group: every tool def has a matching handler
// ──────────────────────────────────────────────────────────

describe('MCP tool category groups', () => {
  for (const [name, tools, handlers] of ALL_GROUPS) {
    describe(`${name}`, () => {
      it('has at least one tool', () => {
        expect(tools.length).toBeGreaterThan(0);
      });

      it('every tool has a non-empty name starting with nexus_', () => {
        for (const t of tools) {
          expect(t.name).toMatch(/^nexus_/);
          expect(t.description?.length).toBeGreaterThan(20);
          expect(t.inputSchema).toBeDefined();
        }
      });

      it('every tool has a matching async handler in the registry', () => {
        for (const t of tools) {
          const handler = handlers[t.name];
          expect(handler, `handler missing for ${t.name}`).toBeDefined();
          expect(typeof handler).toBe('function');
          expect(handler.constructor.name).toBe('AsyncFunction');
        }
      });

      it('every handler has a matching tool definition (no orphan handlers)', () => {
        const toolNames = new Set(tools.map((t) => t.name));
        for (const handlerName of Object.keys(handlers)) {
          expect(toolNames.has(handlerName), `handler "${handlerName}" has no matching tool def`).toBe(true);
        }
      });
    });
  }
});

// ──────────────────────────────────────────────────────────
// Cross-group: no duplicates, total count matches TOOL_COUNT_EXPECTED
// ──────────────────────────────────────────────────────────

describe('MCP tool registry composition', () => {
  it('no tool name appears in two groups', () => {
    const seen = new Map<string, string>(); // name → groupName
    for (const [groupName, tools] of ALL_GROUPS) {
      for (const t of tools) {
        if (seen.has(t.name)) {
          throw new Error(`Tool "${t.name}" appears in both ${seen.get(t.name)} and ${groupName}`);
        }
        seen.set(t.name, groupName);
      }
    }
  });

  it('total tool count across all groups equals TOOL_COUNT_EXPECTED', () => {
    const total =
      readTools.length + writeTools.length + aiTools.length + compositeTools.length;
    expect(total).toBe(TOOL_COUNT_EXPECTED);
  });

  it('expected category sizes (read 10 · write 13 · ai 3 · composite 3 = 29)', () => {
    expect(readTools.length).toBe(10);
    expect(writeTools.length).toBe(13);
    expect(aiTools.length).toBe(3);
    expect(compositeTools.length).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────
// Foundation lib smoke — imports work, exports are sensible
// ──────────────────────────────────────────────────────────

describe('server/mcp/lib', () => {
  it('config.ts exposes the expected constants', async () => {
    const cfg = await import('../server/mcp/lib/config.ts');
    expect(typeof cfg.STANDALONE).toBe('boolean');
    expect(typeof cfg.NEXUS_BASE).toBe('string');
    expect(cfg.NEXUS_BASE).toMatch(/^https?:\/\//);
    expect(cfg.SERVER_NAME).toBe('nexus');
    expect(typeof cfg.SERVER_STARTED_AT).toBe('number');
    expect(typeof cfg.SERVER_VERSION).toBe('string');
  });

  it('format.ts exports formatBrief / formatPlan / formatGuard', async () => {
    const fmt = await import('../server/mcp/lib/format.ts');
    expect(typeof fmt.formatBrief).toBe('function');
    expect(typeof fmt.formatPlan).toBe('function');
    expect(typeof fmt.formatGuard).toBe('function');
    // formatGuard with empty data returns the no-redundancy message
    const out = fmt.formatGuard({} as Record<string, unknown>, 'test title');
    expect(out).toContain('No redundancy detected');
    expect(out).toContain('test title');
  });

  it('nexusFetch.ts exports nexusFetch + SLOW_TOOLS + HEARTBEAT_INTERVAL_MS', async () => {
    const mod = await import('../server/mcp/lib/nexusFetch.ts');
    expect(typeof mod.nexusFetch).toBe('function');
    expect(mod.SLOW_TOOLS instanceof Set).toBe(true);
    expect(mod.SLOW_TOOLS.has('nexus_ask_overseer')).toBe(true);
    expect(mod.SLOW_TOOLS.has('nexus_bridge_session')).toBe(true);
    expect(typeof mod.HEARTBEAT_INTERVAL_MS).toBe('number');
    expect(mod.HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
  });
});
