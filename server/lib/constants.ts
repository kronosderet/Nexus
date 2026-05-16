/**
 * Shared constants — single source of truth for values that were drifting.
 *
 * v4.9.0 #749 — extracted from server/routes/ledger.ts (EDGE_RELS + GENERIC_TAGS)
 * and server/db/storeMigrations.ts (ORPHAN_RELS + GENERIC_TAGS). Both files
 * carried identical literals; this module is the canonical home so a future
 * widening of the edge-rel union or expansion of the generic-tag blacklist
 * happens in exactly one place.
 */
import type { GraphEdge } from '../types.ts';

/** The seven canonical edge relation types (mirrors GraphEdge['rel'] in types.ts).
 *  Use this array when you need iteration / membership checks at runtime; use
 *  GraphEdge['rel'] when you need the static union for typing. */
export const EDGE_RELS = [
  'led_to',
  'replaced',
  'depends_on',
  'contradicts',
  'related',
  'informs',
  'experimental',
] as const satisfies readonly GraphEdge['rel'][];

export const EDGE_REL_SET: ReadonlySet<GraphEdge['rel']> = new Set(EDGE_RELS);

/** Tags that label cross-cutting metadata (every project ships releases, every
 *  project has a github repo, etc.). Auto-link refuses to draw cross-project
 *  edges based on these because the shared label doesn't imply real coupling.
 *  Pair with the `/^v\d/i` regex via {@link isGenericTag}. */
export const GENERIC_TAGS: ReadonlySet<string> = new Set([
  'milestone', 'shipped', 'released', 'release', 'audit', 'polish',
  'github', 'git', 'hygiene-migration', 'version', 'versioning',
]);

export function isGenericTag(tag: string): boolean {
  return GENERIC_TAGS.has(tag.toLowerCase()) || /^v\d/i.test(tag);
}
