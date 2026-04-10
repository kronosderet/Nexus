import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Shared configuration — the single source of truth for paths and env.
 *
 * All server files import from here instead of hardcoding paths.
 * Users override via environment variables:
 *   NEXUS_PROJECTS_DIR — where git repos live (auto-detected or set manually)
 *   NEXUS_HOME         — where Nexus stores data (default: ~/.nexus)
 *   NEXUS_DB_PATH      — JSON store path (default: NEXUS_HOME/nexus.json)
 */

// Detect projects directory — check common locations, use first that exists
function defaultProjectsDir(): string {
  const candidates = [
    'C:/Projects',                    // Common Windows root-level dev dir
    join(homedir(), 'Projects'),      // ~/Projects
    join(homedir(), 'repos'),         // ~/repos
    join(homedir(), 'src'),           // ~/src
    join(homedir(), 'Developer'),     // macOS convention
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  // Nothing found — use ~/Projects as fallback
  return join(homedir(), 'Projects');
}

export const PROJECTS_DIR = process.env.NEXUS_PROJECTS_DIR || defaultProjectsDir();
export const NEXUS_HOME = process.env.NEXUS_HOME || join(homedir(), '.nexus');
