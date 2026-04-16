import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * v4.3.7 F1c — Version + tool-count drift guard.
 *
 * Root cause of the H1/H2 findings from the v4.3.6 audit (docs saying "22 tools"
 * when code had 24, docs saying "153 tests" when code had 169): version strings
 * and tool counts were maintained by hand across 7+ files. This test fails CI
 * the moment any of them disagree, so the drift can't accumulate between audits.
 *
 * Assertions:
 *   1. All declared version strings equal root package.json.version
 *      (package.json, cli/package.json, mcpb/manifest.json, server/lib/version.ts)
 *   2. TOOL_COUNT_EXPECTED matches the actual TOOLS array length in mcp/index.ts
 *      AND the tools list length in mcpb/manifest.json.
 *
 * Run: `npm test` — this file lives in tests/ so vitest picks it up automatically.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

describe('version drift guard (v4.3.7 F1c)', () => {
  const rootPkg = readJson<{ version: string }>(join(REPO, 'package.json'));
  const cliPkg = readJson<{ version: string }>(join(REPO, 'cli', 'package.json'));
  const manifest = readJson<{ version: string; tools: Array<{ name: string }> }>(
    join(REPO, 'mcpb', 'manifest.json')
  );

  it('root package.json version is non-empty semver-ish', () => {
    expect(rootPkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('cli/package.json version matches root', () => {
    expect(cliPkg.version).toBe(rootPkg.version);
  });

  it('mcpb/manifest.json version matches root', () => {
    expect(manifest.version).toBe(rootPkg.version);
  });

  it('server/lib/version.ts exports version matching root package.json', async () => {
    // Dynamic import so any JSON-load error from version.ts surfaces as a failing test.
    const mod = await import('../server/lib/version.ts');
    expect(mod.SERVER_VERSION).toBe(rootPkg.version);
  });

  it('TOOL_COUNT_EXPECTED matches mcpb/manifest.json.tools.length', async () => {
    const mod = await import('../server/lib/version.ts');
    expect(manifest.tools.length).toBe(mod.TOOL_COUNT_EXPECTED);
  });

  it('TOOL_COUNT_EXPECTED matches TOOLS array in server/mcp/index.ts (by source grep)', async () => {
    const mod = await import('../server/lib/version.ts');
    // Count name: entries under TOOLS[]. Grep-based (not importing the MCP module)
    // because the MCP module's top-level code does stdio setup — importing it from
    // a test would try to start a server. Source-regex is cheap and reliable here.
    const mcpSrc = readFileSync(join(REPO, 'server', 'mcp', 'index.ts'), 'utf-8');
    const toolsStart = mcpSrc.indexOf('const TOOLS: Tool[] = [');
    const toolsEnd = mcpSrc.indexOf('\n];', toolsStart);
    expect(toolsStart).toBeGreaterThan(-1);
    expect(toolsEnd).toBeGreaterThan(toolsStart);
    const toolsBlock = mcpSrc.slice(toolsStart, toolsEnd);
    const nameCount = (toolsBlock.match(/^\s{4}name:\s*'nexus_/gm) || []).length;
    expect(nameCount).toBe(mod.TOOL_COUNT_EXPECTED);
  });

  it('every tool name in manifest.json exists in mcp/index.ts source', () => {
    const mcpSrc = readFileSync(join(REPO, 'server', 'mcp', 'index.ts'), 'utf-8');
    for (const tool of manifest.tools) {
      expect(mcpSrc, `tool "${tool.name}" in manifest but not in mcp/index.ts`)
        .toContain(`name: '${tool.name}'`);
    }
  });
});
