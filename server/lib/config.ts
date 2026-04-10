import { homedir } from 'os';
import { join } from 'path';

/**
 * Shared configuration — the single source of truth for paths and env.
 *
 * All server files import from here instead of hardcoding paths.
 * Users override via environment variables:
 *   NEXUS_PROJECTS_DIR — where git repos live (default: ~/Projects or C:/Projects)
 *   NEXUS_HOME         — where Nexus stores data (default: ~/.nexus)
 *   NEXUS_DB_PATH      — JSON store path (default: NEXUS_HOME/nexus.json)
 */

// Detect sensible default for projects directory
function defaultProjectsDir(): string {
  if (process.platform === 'win32') {
    // Common Windows dev directories
    const candidates = [
      join(homedir(), 'Projects'),
      join(homedir(), 'repos'),
      join(homedir(), 'src'),
      'C:/Projects',
    ];
    // Just use ~/Projects as default — it's the most common
    return candidates[0];
  }
  return join(homedir(), 'Projects');
}

export const PROJECTS_DIR = process.env.NEXUS_PROJECTS_DIR || defaultProjectsDir();
export const NEXUS_HOME = process.env.NEXUS_HOME || join(homedir(), '.nexus');
