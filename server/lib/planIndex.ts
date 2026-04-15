/**
 * Plan Archaeology — indexes ~/.claude/plans/*.md so Nexus can surface them.
 *
 * CC writes plan files to ~/.claude/plans/ during EnterPlanMode workflows.
 * Nexus reads them (never writes) and stitches them into its view of the world.
 *
 * Design notes:
 * - Pure FS read, no store dependency — can be called from both HTTP routes
 *   and the standalone MCPB localApi.
 * - Skips "agent sub-plans" (files with `-agent-<hex>.md` suffix) since those
 *   are internal Plan agent artefacts, not user-facing plans.
 * - Project inference is best-effort via content keywords / paths. Returns null
 *   when nothing matches — don't lie about provenance.
 *
 * Configure plans dir via NEXUS_CC_PLANS_DIR env var (defaults to ~/.claude/plans).
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';

export interface PlanEntry {
  filename: string;       // e.g. "concurrent-bouncing-lagoon.md"
  path: string;           // absolute path
  title: string;          // first H1, or first non-empty line, or filename
  mtime: string;          // ISO timestamp of last modification
  ageDays: number;        // rounded days since mtime
  project: string | null; // inferred; null if no hint matched
  snippet: string;        // ~200-char preview of body content
}

export interface PlansIndex {
  available: boolean;
  plans: PlanEntry[];
  totalFiles: number;  // total .md files in plans dir (incl. agent subs)
  agentCount: number;  // how many were skipped as agent sub-plans
  plansDir: string;    // resolved path, useful for debugging
}

const PLANS_DIR = process.env.NEXUS_CC_PLANS_DIR || join(homedir(), '.claude', 'plans');
const AGENT_PLAN_PATTERN = /-agent-[a-f0-9]+\.md$/i;

// Project inference — matches against content from the plan file. Order matters:
// more specific patterns first. Path-based matches beat bare-word matches.
const PROJECT_HINTS: Array<{ project: string; patterns: RegExp[] }> = [
  { project: 'Nexus',       patterns: [/[\\/]Projects[\\/]Nexus\b/i, /\bNexus\b/] },
  { project: 'Shadowrun',   patterns: [/\bShadowrun\b/i] },
  { project: 'Firewall',    patterns: [/Firewall[- ]?Godot\b/i, /\bFirewall\b/] },
  { project: 'Level',       patterns: [/[Mm]:[\\/]Level\b/, /Level Magazine/i] },
  { project: 'family-coop', patterns: [/family[- ]coop\b/i] },
  { project: 'rts',         patterns: [/Claude-MD[\\/]rts\b/i] },
];

export function scanPlans(limit = 30): PlansIndex {
  if (!existsSync(PLANS_DIR)) {
    return { available: false, plans: [], totalFiles: 0, agentCount: 0, plansDir: PLANS_DIR };
  }

  const now = Date.now();
  const entries: PlanEntry[] = [];
  let agentCount = 0;
  let totalFiles = 0;

  try {
    const files = readdirSync(PLANS_DIR).filter((f) => f.endsWith('.md'));
    totalFiles = files.length;

    for (const file of files) {
      if (AGENT_PLAN_PATTERN.test(file)) {
        agentCount++;
        continue;
      }

      const fullPath = join(PLANS_DIR, file);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      let content = '';
      try { content = readFileSync(fullPath, 'utf-8').slice(0, 4000); } catch {}

      // Title: first H1, else first non-empty line, else filename stem
      const h1Match = content.match(/^#\s+(.+)$/m);
      const firstLine = content.split('\n').find((l) => l.trim().length > 0);
      const title = (h1Match?.[1] || firstLine || file.replace(/\.md$/, ''))
        .trim()
        .replace(/^#+\s*/, '')
        .slice(0, 140);

      // Project inference — first hint wins
      let project: string | null = null;
      for (const hint of PROJECT_HINTS) {
        if (hint.patterns.some((p) => p.test(content))) {
          project = hint.project;
          break;
        }
      }

      // Snippet: body content after the title, collapsed whitespace
      const bodyStart = h1Match ? content.indexOf(h1Match[0]) + h1Match[0].length : 0;
      const snippet = content
        .slice(bodyStart)
        .replace(/^#+\s+.+$/gm, '')   // drop further headings
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);

      const mtime = stat.mtime.toISOString();
      const ageDays = Math.max(0, Math.round((now - stat.mtime.getTime()) / 86400000));

      entries.push({ filename: file, path: fullPath, title, mtime, ageDays, project, snippet });
    }
  } catch {}

  entries.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

  return {
    available: true,
    plans: entries.slice(0, Math.max(1, limit)),
    totalFiles,
    agentCount,
    plansDir: PLANS_DIR,
  };
}
