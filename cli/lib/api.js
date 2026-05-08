/**
 * CLI HTTP layer — talks to the Nexus dashboard's REST API.
 *
 * Extracted from cli/nexus.js in v4.7.5 (#217 part 3). Single source of truth
 * for `BASE`, `NEXUS_VERSION`, and the `api()` helper that every command
 * file uses.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
// `__dirname` here points at cli/lib/. The package.json is two levels up.
const __dirname = dirname(__filename);

// v4.3.7 F1c — read version from root package.json instead of hardcoding.
// Falls back if package.json is missing (e.g. when the CLI is bundled standalone).
let _version = 'unknown';
try {
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  if (existsSync(pkgPath)) {
    _version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version || 'unknown';
  }
} catch {
  // Bundled context — leave as 'unknown'
}
export const NEXUS_VERSION = _version;

export const BASE = process.env.NEXUS_URL || 'http://localhost:3001';

/**
 * GET/POST/etc. wrapper around the Nexus REST API.
 * - Auto-sets Content-Type and serializes `options.body` as JSON.
 * - Hard-exits with a friendly message on ECONNREFUSED (the dashboard isn't
 *   running) — that's the most common CLI failure mode.
 * - Re-throws other errors so callers can decide how to recover.
 */
export async function api(path, options = {}) {
  const url = `${BASE}/api${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('  ◈ Nexus is offline. Start the Nexus server with: nexus-dev.bat or npm run dev');
      process.exit(1);
    }
    throw err;
  }
}
