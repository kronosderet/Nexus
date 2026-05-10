/**
 * Idempotent schema migrations for NexusStore.
 *
 * Extracted from server/db/store.ts in v4.8.0 (#217 follow-up — last sizable
 * monolith). The class method delegates here; this file owns the migration
 * logic. Caller flushes the store if the return value is > 0.
 *
 * v4.3.6 M1: each migration records its ID in `_appliedMigrations` after
 * completion so subsequent cold-starts skip the scan. Tests can force a re-run
 * by clearing that map.
 */
import type { NexusData, Decision, Task } from '../types.js';
import { getDefaultMemoryBridgeConfig } from '../lib/memoryBridge.ts';
import { classifyProject } from '../lib/projectConfig.ts';

export function runMigrations(data: NexusData): number {
    let changed = 0;
    if (!data._appliedMigrations) {
      data._appliedMigrations = {};
      changed++;
    }
    const applied = data._appliedMigrations;
    const markApplied = (id: string) => { applied[id] = new Date().toISOString(); };

    // v4.3.5 C1: Backfill `project` on tasks (v4.2 added the field but never migrated old tasks).
    // v4.5.3 — project-detection patterns moved to projectConfig.ts. Users customize via
    // ~/.nexus/projects.json; default matches "Nexus" and falls through to Nexus otherwise.
    const tasksNeedingProject = applied['v4.3.5-C1'] ? [] : data.tasks.filter(t => !t.project);
    if (tasksNeedingProject.length > 0) {
      // Build project name lookup from existing decisions (canonical casing).
      const decisionProjectById = new Map<number, string>();
      for (const d of data.ledger) {
        if (d.project) decisionProjectById.set(d.id, d.project);
      }
      const inferProject = (t: Task): string => {
        // 1. From decision_ids (most authoritative)
        if (Array.isArray(t.decision_ids) && t.decision_ids.length > 0) {
          const projects = t.decision_ids
            .map((id: number) => decisionProjectById.get(id))
            .filter(Boolean) as string[];
          if (projects.length > 0) {
            // Most common
            const counts: Record<string, number> = {};
            for (const p of projects) counts[p] = (counts[p] || 0) + 1;
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
          }
        }
        // 2. Pattern-match against title + description via user-configurable patterns
        const haystack = `${t.title || ''} ${t.description || ''}`;
        return classifyProject(haystack);
      };
      for (const t of tasksNeedingProject) {
        t.project = inferProject(t);
        changed++;
      }
      console.error(`◈ Migration v4.3.5 C1: backfilled \`project\` on ${tasksNeedingProject.length} tasks.`);
      markApplied('v4.3.5-C1');
    } else if (!applied['v4.3.5-C1']) {
      // No tasks needed backfill — still mark applied so we don't rescan on every load.
      markApplied('v4.3.5-C1');
    }

    // v4.3.5 I1: Backfill `lifecycle` on ledger decisions (108/154 lacked it pre-patch).
    // Heuristic: high-centrality (degree ≥3) → validated, recent (<14d) → proposed, else → active.
    const decisionsNeedingLifecycle = applied['v4.3.5-I1'] ? [] : data.ledger.filter(d => !d.lifecycle);
    if (decisionsNeedingLifecycle.length > 0) {
      const degreeByDecision = new Map<number, number>();
      for (const e of data.graph_edges) {
        degreeByDecision.set(e.from, (degreeByDecision.get(e.from) || 0) + 1);
        degreeByDecision.set(e.to,   (degreeByDecision.get(e.to)   || 0) + 1);
      }
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      for (const d of decisionsNeedingLifecycle) {
        const degree = degreeByDecision.get(d.id) || 0;
        const ageDays = (now - new Date(d.created_at).getTime()) / 86400000;
        if (d.deprecated) d.lifecycle = 'deprecated';
        else if (degree >= 3) d.lifecycle = 'validated';
        else if (ageDays < 14) d.lifecycle = 'proposed';
        else d.lifecycle = 'active';
        if (!d.last_reviewed_at) d.last_reviewed_at = nowIso;
        changed++;
      }
      console.error(`◈ Migration v4.3.5 I1: backfilled \`lifecycle\` on ${decisionsNeedingLifecycle.length} decisions.`);
      markApplied('v4.3.5-I1');
    } else if (!applied['v4.3.5-I1']) {
      markApplied('v4.3.5-I1');
    }

    // v4.3.9 H1: combined hygiene migration — fixes three data-quality bugs the UI audit surfaced.
    //   #222 Encoding mojibake: U+FFFD replacement chars in task titles (em-dash loss on import)
    //   #245 Blank project names: sessions logged without project leak as ": 10d" on Fleet staleness
    //   #273 Case inconsistency across task/session/decision records, plus "Projects" (cap P)
    //        leaking in from CC encoded-dir names (not a real project)
    // One pass, one apply, all three resolved. Idempotent via _appliedMigrations.
    // v4.5.3 — project-case map emptied; it was hardcoded to one developer's hostname
    // casing. Anyone on older installs who still has that residue can re-seed the map
    // via a future config hook. The mojibake + blank-project scrubs remain universal.
    if (!applied['v4.3.9-H1']) {
      const mojibake = /\uFFFD/g;
      let mojibakeFixed = 0;
      let blanksFixed = 0;
      let casingFixed = 0;

      const projectCaseMap = new Map<string, string>();
      const normalizeProject = (p: string | undefined): { value: string | undefined; changed: boolean } => {
        if (!p) return { value: p, changed: false };
        const mapped = projectCaseMap.get(p);
        if (mapped && mapped !== p) return { value: mapped, changed: true };
        return { value: p, changed: false };
      };

      // (a) Mojibake scrub across tasks + decisions (title, description, decision text, context).
      for (const t of data.tasks) {
        if (t.title && mojibake.test(t.title)) { t.title = t.title.replace(mojibake, '—'); mojibakeFixed++; }
        if (t.description && mojibake.test(t.description)) { t.description = t.description.replace(mojibake, '—'); mojibakeFixed++; }
      }
      for (const d of data.ledger || []) {
        if (d.decision && mojibake.test(d.decision)) { d.decision = d.decision.replace(mojibake, '—'); mojibakeFixed++; }
        if (d.context && mojibake.test(d.context)) { d.context = d.context.replace(mojibake, '—'); mojibakeFixed++; }
      }

      // (b) Blank-project normalization: sessions and tasks/decisions with empty/whitespace project.
      for (const s of data.sessions || []) {
        if (!s.project || !s.project.trim()) { s.project = 'general'; blanksFixed++; }
      }
      for (const t of data.tasks) {
        if (!t.project || !t.project.trim()) { t.project = 'general'; blanksFixed++; }
      }
      for (const d of data.ledger || []) {
        if (!d.project || !d.project.trim()) { d.project = 'general'; blanksFixed++; }
      }

      // (c) Casing normalization across tasks/sessions/decisions.
      for (const t of data.tasks) {
        const n = normalizeProject(t.project);
        if (n.changed) { t.project = n.value!; casingFixed++; }
      }
      for (const s of data.sessions || []) {
        const n = normalizeProject(s.project);
        if (n.changed) { s.project = n.value!; casingFixed++; }
      }
      for (const d of data.ledger || []) {
        const n = normalizeProject(d.project);
        if (n.changed) { d.project = n.value!; casingFixed++; }
      }

      if (mojibakeFixed > 0 || blanksFixed > 0 || casingFixed > 0) {
        console.error(`◈ Migration v4.3.9 H1: scrubbed ${mojibakeFixed} mojibake chars, ${blanksFixed} blank projects, ${casingFixed} casing issues.`);
        changed += mojibakeFixed + blanksFixed + casingFixed;
      }
      markApplied('v4.3.9-H1');
    }

    // v4.4.0 H2 — second hygiene pass catching residue v4.3.9-H1 didn't touch.
    // Observed in the beta SessionStart hook output: "Fleet uncommitted: Nexus: 1 · nexus: 1"
    // means the sessions log contains BOTH case variants of "Nexus" as distinct project keys.
    // This extends the casing-normalization map with the lowercase-first-letter pattern and
    // does one more sweep. Any future drift gets added here.
    if (!applied['v4.4.0-H2']) {
      const caseMapV2 = new Map<string, string>([
        // "nexus" (lowercase, from hook's detectProject reading pkg.json "name") → "Nexus"
        ['nexus', 'Nexus'],
      ]);
      const normalize = (p: string | undefined): { value: string | undefined; changed: boolean } => {
        if (!p) return { value: p, changed: false };
        const mapped = caseMapV2.get(p);
        if (mapped && mapped !== p) return { value: mapped, changed: true };
        return { value: p, changed: false };
      };
      let casingFixedV2 = 0;
      for (const t of data.tasks) {
        const n = normalize(t.project);
        if (n.changed) { t.project = n.value!; casingFixedV2++; }
      }
      for (const s of data.sessions || []) {
        const n = normalize(s.project);
        if (n.changed) { s.project = n.value!; casingFixedV2++; }
      }
      for (const d of data.ledger || []) {
        const n = normalize(d.project);
        if (n.changed) { d.project = n.value!; casingFixedV2++; }
      }
      if (casingFixedV2 > 0) {
        console.error(`◈ Migration v4.4.0 H2: normalized ${casingFixedV2} 'nexus' → 'Nexus' casing issues.`);
        changed += casingFixedV2;
      }
      markApplied('v4.4.0-H2');
    }

    // v4.4.1 H3 — prune auto-linked edges from the generic-tag explosion (#314 audit).
    // The v4.3.x auto-link route linked any two decisions sharing a tag cross-project,
    // without filtering generic tags like "milestone" or "github" that every project uses.
    // That manufactured ~68 noise edges between Nexus ↔ Firewall-Godot alone. v4.4.1
    // added a blacklist to the auto-linker; this migration cleans up the residue at rest.
    if (!applied['v4.4.1-H3']) {
      const genericTagsSet = new Set([
        'milestone', 'shipped', 'released', 'release', 'audit', 'polish',
        'github', 'git', 'hygiene-migration', 'version', 'versioning',
      ]);
      const isGeneric = (tag: string) => genericTagsSet.has(tag.toLowerCase()) || /^v\d/i.test(tag);
      const before = (data.graph_edges || []).length;
      data.graph_edges = (data.graph_edges || []).filter(e => {
        const match = /^Shared tag:\s*(.+)$/.exec(e.note || '');
        if (!match) return true;
        return !isGeneric(match[1].trim());
      });
      const pruned = before - data.graph_edges.length;
      if (pruned > 0) {
        console.error(`◈ Migration v4.4.1 H3: pruned ${pruned} generic-tag cross-project edges (milestone / github / etc.).`);
        changed += pruned;
      }
      markApplied('v4.4.1-H3');
    }

    // v4.5.7 E1 — edge-type enum hygiene. Historical edges carry rel values
    // (supports / enables / implements / embodies) that were never part of the
    // canonical GraphEdge.rel union. Each occurs in 1-2 edges — they were
    // likely typed in freehand before the enum was locked. The UI and tests
    // assume rel is one of led_to / replaced / depends_on / contradicts /
    // related / informs / experimental. This migration remaps the strays to
    // `related` (the catch-all), preserving the original rel in the edge note
    // so provenance isn't lost.
    if (!applied['v4.5.7-E1']) {
      const ORPHAN_RELS = new Set(['supports', 'enables', 'implements', 'embodies']);
      let remapped = 0;
      for (const e of data.graph_edges || []) {
        if (ORPHAN_RELS.has(e.rel as string)) {
          const originalRel = e.rel;
          e.rel = 'related';
          const provenance = `[was rel=${originalRel}]`;
          e.note = e.note ? `${e.note} ${provenance}` : provenance;
          remapped++;
        }
      }
      if (remapped > 0) {
        console.error(`◈ Migration v4.5.7 E1: remapped ${remapped} orphan-rel edges → 'related' (provenance preserved in note).`);
        changed += remapped;
      }
      markApplied('v4.5.7-E1');
    }

    // v4.6.2 D1 — knowledge-graph hygiene migration. Re-applies the v4.5.8
    // phantom-project cleanup at code level so the store-reload race can't
    // undo it. Pattern-based (not ID-based) so it's safe for any user's
    // store: only mutates entries whose content matches the documented signals.
    //
    // Three concerns:
    //   1. project='claude' renames to 'family-coop' when decision text
    //      mentions Alpha/Beta agent protocol (the original rename intent).
    //   2. project='claude-md' renames to 'Nexus' (DIR_HINTS leaked a
    //      synthetic project from the C--Users-kronos-Claude-MD dir; in
    //      v4.6.2 the hint maps to Nexus directly so future imports don't
    //      repeat).
    //   3. project='general' decisions get content-classified into their
    //      real homes when the content carries an unambiguous prefix
    //      ('SR3'/'Shadowrun', 'Firewall-Godot:', 'Noosphere'), or moved
    //      to 'Nexus' when they're cc-memory imports.
    //   4. Tags matching /^[A-Z]--/ (Windows-encoded path leaks from
    //      importCCMemory's old behavior) are stripped from all decisions.
    //
    // Sessions + thoughts get the project renames too (same pattern).
    if (!applied['v4.6.2-D1']) {
      let renamedClaude = 0, renamedClaudeMd = 0, splitGeneral = 0, scrubbedTags = 0, deletedJunk = 0;

      // Decisions
      const remaining: Decision[] = [];
      for (const dec of (data.ledger || [])) {
        const decText = String(dec.decision || '').trim();
        // 1. claude → family-coop (Alpha/Beta protocol decisions)
        if (dec.project === 'claude' && /alpha|beta|outbox\.json|agent_alpha|agent_beta|profile\.json|conflict resolution|consent boundary|cooperative agent/i.test(decText)) {
          dec.project = 'family-coop';
          renamedClaude++;
        }
        // 2. claude-md → Nexus
        if (dec.project === 'claude-md') {
          dec.project = 'Nexus';
          renamedClaudeMd++;
        }
        // 3. general split
        if (dec.project === 'general') {
          // 3a. junk — exact-match only, conservative on purpose. The `--help`
          // case is a known artefact from a CLI flag leak in early Nexus.
          if (decText === '--help') {
            deletedJunk++;
            continue; // drop from ledger
          }
          // 3b. content-pattern reassignment
          if (/^SR3\b|^Shadowrun\b/i.test(decText)) {
            dec.project = 'Shadowrun';
            splitGeneral++;
          } else if (/^Firewall-Godot[:\s]|Firewall-Godot:/i.test(decText)) {
            dec.project = 'Firewall-Godot';
            splitGeneral++;
          } else if (/^Noosphere\b/i.test(decText)) {
            dec.project = 'noosphere';
            splitGeneral++;
          } else if ((dec.tags || []).includes('cc-memory')) {
            // 3c. cc-memory imports that landed in general → Nexus
            dec.project = 'Nexus';
            splitGeneral++;
          }
          // else leave as general (no clear signal — user can sort manually)
        }
        // 4. strip path-encoded tags (e.g. 'C--', 'C--Users-kronos-Claude-MD')
        if (Array.isArray(dec.tags)) {
          const before = dec.tags.length;
          dec.tags = dec.tags.filter((t: string) => !/^[A-Z]--/.test(String(t)));
          scrubbedTags += before - dec.tags.length;
        }
        remaining.push(dec);
      }
      data.ledger = remaining;

      // Sessions: claude → family-coop (Alpha/Beta sessions)
      let sessionsRenamed = 0;
      for (const s of (data.sessions || [])) {
        if (s.project === 'claude' && /alpha|beta|agent.protocol|outbox/i.test(String(s.summary || ''))) {
          s.project = 'family-coop';
          sessionsRenamed++;
        }
        if (s.project === 'claude-md') {
          s.project = 'Nexus';
          sessionsRenamed++;
        }
      }

      // Thoughts: same renames
      let thoughtsRenamed = 0;
      for (const t of (data.thoughts || [])) {
        if (t.project === 'claude' && /alpha|beta|outbox|agent.protocol/i.test(String(t.text || ''))) {
          t.project = 'family-coop';
          thoughtsRenamed++;
        }
        if (t.project === 'claude-md') {
          t.project = 'Nexus';
          thoughtsRenamed++;
        }
      }

      const total = renamedClaude + renamedClaudeMd + splitGeneral + deletedJunk + scrubbedTags + sessionsRenamed + thoughtsRenamed;
      if (total > 0) {
        console.error(
          `◈ Migration v4.6.2 D1: claude→family-coop ${renamedClaude} · ` +
          `claude-md→Nexus ${renamedClaudeMd} · general split ${splitGeneral} · ` +
          `junk deleted ${deletedJunk} · path-tags scrubbed ${scrubbedTags} · ` +
          `sessions renamed ${sessionsRenamed} · thoughts renamed ${thoughtsRenamed}`
        );
        changed += total;
      }
      markApplied('v4.6.2-D1');
    }

    // v4.6.2 D2 — pattern expansion for stragglers D1's narrower regex left
    // behind. The Alpha/Beta protocol decisions sometimes use "agents" /
    // "relationship-first" / "secrets policy" / "coordination layer" without
    // saying "alpha" or "beta" literally. Same conservative principle:
    // pattern-match content only, no ID references.
    if (!applied['v4.6.2-D2']) {
      let renamedClaudeBroad = 0, generalToNexus = 0;
      for (const dec of (data.ledger || [])) {
        const decText = String(dec.decision || '').trim();
        if (dec.project === 'claude' && /relationship-first|secrets policy|coordination layer is shared|communication translation|agents (?:surface|communicate|preserve)|M:\\claude|\\\\192\.168\.1\.229/i.test(decText)) {
          dec.project = 'family-coop';
          renamedClaudeBroad++;
        }
        // The "Captain says go bigger" note in general was confirmed Nexus by
        // the user during v4.5.8 cleanup. Specific-string match so this
        // doesn't false-positive on other users' stores.
        if (dec.project === 'general' && /Captain says go bigger.*burn rate is efficient/i.test(decText)) {
          dec.project = 'Nexus';
          generalToNexus++;
        }
      }
      const total = renamedClaudeBroad + generalToNexus;
      if (total > 0) {
        console.error(`◈ Migration v4.6.2 D2: claude→family-coop (broad) ${renamedClaudeBroad} · general→Nexus (specific) ${generalToNexus}`);
        changed += total;
      }
      markApplied('v4.6.2-D2');
    }

    // v4.6.0 E1 — seed continuous-handover for the Nexus project from the
    // last dated HANDOVER-X.md TL;DR. Idempotent: only seeds if no handover
    // exists yet for "Nexus", so re-running won't clobber user edits.
    if (!applied['v4.6.0-E1']) {
      if (!data._handovers) data._handovers = {};
      if (!data._handovers['Nexus']) {
        data._handovers['Nexus'] = {
          content: [
            '# Nexus — Continuous Handover',
            '',
            '**v4.6.0 shipped 2026-04-26**: Continuous Handover replaces dated `HANDOVER-YYYY-MM-DD.md` files. This card lives in Nexus and updates per session via `nexus_update_handover` or the Handover tab editor.',
            '',
            '## Current state',
            '- 27 → **29 MCP tools** (added `nexus_read_handover`, `nexus_update_handover`)',
            '- Tier 2 = 0 (cleared at v4.5.9)',
            '- Tier 3: 7 deferred items remaining',
            '- Fuel model: sliding session + sliding weekly (Sat 10:00 Prague)',
            '',
            '## What I\'d pick up first',
            '- **#218** route tests for github / overseer / webhooks (best stability ROI)',
            '- One of 7 deferred Tier-3 items',
            '- Tier 4 polish sweep',
            '',
            'See `docs/ARCHITECTURE.md` for slow-moving content (architecture spine, gotchas, rituals).',
          ].join('\n'),
          updated_at: new Date().toISOString(),
          updated_by: 'migration:v4.6.0-E1',
        };
        console.error('◈ Migration v4.6.0 E1: seeded continuous handover for Nexus project.');
        changed++;
      }
      markApplied('v4.6.0-E1');
    }

    // v4.7.0-M1: populate default `_memoryBridge` config so the multi-source
    // bridge has something to read on first cold-start. The default keeps the
    // v4.6.5-equivalent single-source behavior — the user opts into Cowork-
    // sandbox / cross-machine sources by appending entries to the array
    // (either via `nexus memory sources` CLI when shipped, or by hand-editing
    // ~/.nexus/nexus.json under `_memoryBridge.sources`).
    if (!applied['v4.7.0-M1']) {
      if (!data._memoryBridge) {
        data._memoryBridge = getDefaultMemoryBridgeConfig();
        console.error('◈ Migration v4.7.0 M1: populated default _memoryBridge config (single source, path-dedup, v4.6.5-compatible).');
        changed++;
      }
      markApplied('v4.7.0-M1');
    }

  // Caller flushes if returned > 0.
  return changed;
}
