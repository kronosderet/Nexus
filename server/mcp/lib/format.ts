/**
 * Output formatters for MCP tool responses.
 *
 * Extracted from server/mcp/index.ts in v4.7.6 (#217 part 4). Per-tool handlers
 * import the formatter they need and pass parsed API data through. Keeps each
 * tool body focused on the API call + formatting glue.
 *
 * Three formatters today:
 *   - formatBrief: nexus_brief — composes 6+ endpoint results into the
 *     session-start briefing. Always includes the version + mode header.
 *   - formatPlan: nexus_get_plan — surfaces fuel + AI plan body.
 *   - formatGuard: nexus_check_guard — surfaces similar tasks/decisions/sessions
 *     with similarity matches.
 */

import { STANDALONE, SERVER_VERSION } from './config.ts';

// Brief data comes from a composition of 6+ different endpoint responses —
// each formatter has its own narrow shape so callers can pass typed data
// without defensive checks. v4.8.1 #drift: tightened from
// Record<string, unknown> & {...} to plain interfaces so property accesses
// in formatPlan/formatGuard don't break tsc.
export interface BriefData {
  fuel?: { session?: number | null; weekly?: number | null; runwayMinutes?: number | null } | null;
  activeTasks?: Array<{ id: number; status: string; title: string }>;
  priorSessions?: Array<{ created_at: string; summary: string }>;
  keyDecisions?: Array<{ decision: string }>;
  recentPlans?: Array<{ project?: string | null; title: string; ageDays: number }>;
  totalPlans?: number;
  // ccMemories: each entry has at least one of description/name/filename. The
  // formatter falls back through them in that order, then to a generic label.
  ccMemories?: Array<{ type: string; description?: string; name?: string; filename?: string }>;
  totalMemories?: number;
  risks?: Array<{ message?: string }>;
  // v4.7.3 #310 — auto-suggest contradictions surfaced in the brief.
  pendingContradictions?: number;
  lastContradictionScanAgo?: string;
}

// v4.8.1 #drift — explicit shapes for the other two formatters. Previously
// they took `Record<string, unknown>` which fired tsc on every property
// access. read.ts / nexus_get_plan / nexus_check_guard now construct typed
// objects before calling.
export interface PlanData {
  fuelState?: { session?: number; weekly?: number; runwayMinutes?: number };
  aiPlan?: string;
}

export interface GuardData {
  warning?: string;
  similarTasks?: Array<{ id: number; status: string; title: string; similarity: number }>;
  relatedDecisions?: Array<{ id: number; project: string; decision: string }>;
  pastSessions?: Array<{ id: number; project: string; summary: string }>;
}

export function formatBrief(data: BriefData, project: string): string {
  const lines: string[] = [];
  // v4.3.7 F1b — version + mode in the header answers "which Nexus am I talking to?"
  // without needing a separate tool call. STANDALONE is resolved at module load time.
  const mode = STANDALONE ? 'standalone' : 'dashboard';
  lines.push(`◈ NEXUS BRIEF — ${project} (v${SERVER_VERSION} · ${mode})`);
  lines.push('');

  if (data.fuel) {
    lines.push(
      `Fuel: session ${data.fuel.session ?? '?'}% | weekly ${data.fuel.weekly ?? '?'}%`
    );
    if (data.fuel.runwayMinutes != null) {
      lines.push(`Runway: ${data.fuel.runwayMinutes}m`);
      // v4.3 #194 — discoverable nudge toward calendar-aware runway check.
      // Only suggest when fuel is in a range where planning matters (not fresh, not critical).
      if (data.fuel.session != null && data.fuel.session <= 80 && data.fuel.session >= 20) {
        lines.push(`  tip: check calendar with /nexus-runway to plan around meetings`);
      }
    }
  }

  if (data.activeTasks?.length) {
    lines.push('');
    lines.push(`Active tasks (${data.activeTasks.length}):`);
    for (const t of data.activeTasks.slice(0, 10)) {
      lines.push(`  #${t.id} [${t.status}] ${t.title}`);
    }
    if (data.activeTasks.length > 10) {
      lines.push(`  ... +${data.activeTasks.length - 10} more`);
    }
  }

  if (data.priorSessions?.length) {
    lines.push('');
    lines.push('Recent sessions:');
    for (const s of data.priorSessions.slice(0, 3)) {
      const date = new Date(s.created_at).toLocaleDateString();
      lines.push(`  ${date}: ${s.summary.slice(0, 100)}`);
    }
  }

  if (data.keyDecisions?.length) {
    lines.push('');
    lines.push('Key decisions:');
    for (const d of data.keyDecisions.slice(0, 5)) {
      lines.push(`  › ${d.decision.slice(0, 100)}`);
    }
  }

  if (data.recentPlans?.length) {
    lines.push('');
    const totalSuffix = data.totalPlans && data.totalPlans > data.recentPlans.length
      ? ` (${data.recentPlans.length} of ${data.totalPlans})`
      : ` (${data.recentPlans.length})`;
    lines.push(`Recent CC plans${totalSuffix}:`);
    for (const p of data.recentPlans.slice(0, 3)) {
      const tag = p.project ? `[${p.project}] ` : '';
      const age = p.ageDays === 0 ? 'today' : p.ageDays === 1 ? '1d ago' : `${p.ageDays}d ago`;
      lines.push(`  › ${tag}${p.title.slice(0, 80)} (${age})`);
    }
  }

  if (data.ccMemories?.length) {
    lines.push('');
    const totalSuffix = data.totalMemories && data.totalMemories > data.ccMemories.length
      ? ` (${data.ccMemories.length} of ${data.totalMemories})`
      : ` (${data.ccMemories.length})`;
    lines.push(`CC memory${totalSuffix}:`);
    for (const m of data.ccMemories.slice(0, 5)) {
      const typeTag = `[${m.type}]`;
      // v4.8.1 #drift — fall back to a generic label when all three fields
      // are missing. Previously the .slice() call could trip on `undefined`.
      const headline = (m.description || m.name || m.filename || 'memory').slice(0, 90);
      lines.push(`  › ${typeTag} ${headline}`);
    }
  }

  if (data.risks?.length) {
    lines.push('');
    lines.push('Risks:');
    for (const r of data.risks) {
      lines.push(`  ! ${r.message || r}`);
    }
  }

  // v4.7.3 #310 — surface pending contradiction suggestions from the auto-scanner
  // so they're visible at session start without opening the Conflicts tab.
  if (data.pendingContradictions && data.pendingContradictions > 0) {
    lines.push('');
    const ago = data.lastContradictionScanAgo ? ` · last scan ${data.lastContradictionScanAgo} ago` : '';
    lines.push(
      `Pending Overseer suggestions: ${data.pendingContradictions} contradiction${data.pendingContradictions === 1 ? '' : 's'}${ago}`,
    );
    lines.push(`  → review in the Conflicts tab (accept → flag, dismiss → hide)`);
  }

  return lines.join('\n');
}

export function formatPlan(data: PlanData): string {
  const lines: string[] = [];
  lines.push('◈ NEXUS SESSION PLAN');
  lines.push('');
  if (data.fuelState) {
    lines.push(
      `Fuel: ${data.fuelState.session ?? '?'}% session | ${data.fuelState.weekly ?? '?'}% weekly | ${data.fuelState.runwayMinutes ?? '?'}m runway`
    );
    lines.push('');
  }
  if (data.aiPlan) {
    lines.push(data.aiPlan);
  } else {
    lines.push('(no plan generated)');
  }
  return lines.join('\n');
}

export function formatGuard(data: GuardData, title: string): string {
  const similarTasks = data?.similarTasks || [];
  const relatedDecisions = data?.relatedDecisions || [];
  const pastSessions = data?.pastSessions || [];
  const total = similarTasks.length + relatedDecisions.length + pastSessions.length;

  if (total === 0) {
    return `◈ Guard check: "${title}"\n\nNo redundancy detected. Safe to proceed.`;
  }

  const lines: string[] = [];
  lines.push(`◈ Guard check: "${title}"`);
  lines.push('');
  if (data.warning) {
    lines.push(`⚠ ${data.warning}`);
    lines.push('');
  }

  if (similarTasks.length > 0) {
    lines.push(`Similar tasks (${similarTasks.length}):`);
    for (const t of similarTasks.slice(0, 5)) {
      lines.push(
        `  • #${t.id} [${t.status}] ${t.title}  (${(t.similarity * 100).toFixed(0)}% match)`
      );
    }
  }
  if (relatedDecisions.length > 0) {
    if (lines.length > 3) lines.push('');
    lines.push(`Related decisions (${relatedDecisions.length}):`);
    for (const d of relatedDecisions.slice(0, 5)) {
      lines.push(`  › #${d.id} [${d.project}] ${d.decision.slice(0, 100)}`);
    }
  }
  if (pastSessions.length > 0) {
    lines.push('');
    lines.push(`Past sessions (${pastSessions.length}):`);
    for (const s of pastSessions.slice(0, 3)) {
      lines.push(`  ▪ #${s.id} [${s.project}] ${s.summary.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}
