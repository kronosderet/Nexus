/**
 * Shared filesystem-path helpers.
 *
 * v4.9.0 #747 — `safeProject` extracted from server/routes/github.ts where it
 * had been the only sanitiser for user-supplied project names. focus.ts and
 * remediate.ts joined the raw param into PROJECTS_DIR without protection — a
 * malicious / careless caller could traverse out of the projects root by
 * passing `..\..\Windows\System32` (or similar). This module is the single
 * source of truth so future routes get the same guard with one import.
 */
import { basename } from 'node:path';

/** Validate a project name is a single safe basename (no separators, no parent
 *  refs, no NUL bytes, non-empty). Returns the name on success or `null` on
 *  rejection. Callers MUST treat null as a 400-class refusal. */
export function safeProject(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  if (name !== basename(name)) return null;
  if (name === '..' || name === '.' || name.includes('\0')) return null;
  return name;
}
