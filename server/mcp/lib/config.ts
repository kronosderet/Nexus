/**
 * MCP server constants.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4) so per-category
 * tool files can read STANDALONE / NEXUS_BASE / SERVER_VERSION without
 * importing the entrypoint module (which has stdio side effects on import).
 */

import { SERVER_VERSION } from '../../lib/version.ts';

export const STANDALONE = process.env.NEXUS_STANDALONE === '1';
export const NEXUS_BASE = process.env.NEXUS_BASE_URL || 'http://localhost:3001';
export const SERVER_NAME = 'nexus';
export const SERVER_STARTED_AT = Date.now();

// Re-export for convenience so tool files can `import { SERVER_VERSION } from '../lib/config'`
// instead of reaching deeper into ../../lib/version.ts.
export { SERVER_VERSION };
