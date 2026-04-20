// v4.3.7 F1c — single source of truth for server version + tool count.
// Imported by every call-site that used to hardcode a version string.
// Drift against package.json / mcpb/manifest.json is guarded by tests/versionDrift.test.ts.
// tsconfig has resolveJsonModule + esbuild inlines JSON imports, so this works bundled and unbundled.
import pkg from '../../package.json' with { type: 'json' };

export const SERVER_VERSION: string = pkg.version;

// Expected MCP tool count. Update this when a tool is added or removed.
// The drift test asserts this matches TOOLS.length in server/mcp/index.ts AND the tools array
// in mcpb/manifest.json — so forgetting to update the manifest goes red in CI.
export const TOOL_COUNT_EXPECTED = 27 as const;
