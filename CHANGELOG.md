# Changelog

Nexus — The Cartographer. Local-first metabrain plugin for Claude Code.

The v4.3.5 → v4.4.6 arc kicked off after the initial "Audit Shakedown" (v4.3.5)
released in mid-April 2026. What follows covers 13 versioned releases plus one
major UI audit, one big `Memory Bridge` import feature, the ambient-telemetry
hook layer (v4.4.0 alpha/beta/final), and six post-v4.4.0 patch releases
closing UI-audit Tier 1 + the small/medium half of Tier 2 backlogs + doc-drift
hardening + audit response.

## v4.4.5 — Doc-Drift Hardening

Return-trip for v4.3.7's single-source-of-truth promise. The v4.3.7 drift test
only guarded the MCPB `tools[]` array — it didn't catch free-text "N native MCP
tools" phrases scattered across 6 other surfaces. As tools were added (v4.3.8's
`nexus_import_cc_memories`, v4.3.7's `nexus_version`) those free-text counts
silently drifted: MCPB manifest's `long_description` still said "25" at v4.4.4,
`plugin/.claude-plugin/plugin.json` still said "20", marketplace.json said "22",
and `plugin/README.md` was both wrong (25) and missing two tools in its lists.

**Fixes (6 files · drift from 20/22/25 → 26)**
- `mcpb/manifest.json` long_description: 25 → 26
- `plugin/README.md`: `Available tools (25)` → `(26)`, added `nexus_version` to
  the Read list and `nexus_import_cc_memories` to the Write list; fixed the
  non-AI count from 20 → 22 (26 total − 4 AI-dependent)
- `cli/nexus.js`: two splash-string occurrences 25 → 26
- `.claude-plugin/marketplace.json` description: 22 → 26
- `plugin/.claude-plugin/plugin.json` description: 20 → 26

**Structural guard (`tests/versionDrift.test.ts`)**

Added a `TOOL_COUNT_DRIFT_CHECKS` array — 12 new assertions scanning every
current-state surface for a `"N native MCP tools"` / `"Available tools (N)"` /
architecture-table `"| N tools"` pattern. Each mismatch fails with the regex
that missed and the captured count vs. `TOOL_COUNT_EXPECTED`. Historical
changelogs (`ROADMAP.md`, this file, `docs/HANDOVER-*.md`) are exempt — they
intentionally record prior counts.

The v4.3.7 promise — "next audit can't surface the same drift class again" —
now actually holds for the free-text surfaces it originally missed.

**Tests:** 189 → **201** (+12 drift specs).
**MCPB:** rebuilt at v4.4.5, smoke-passes on all 26 tools.

## v4.4.6 — Audit Response

Response to the Overseer dashboard audit (advice #26) run immediately after
v4.4.4. Six polish-pass findings shipped in one release. No breaking changes.
(Version bumped to v4.4.6 after rebase — v4.4.5 was claimed by the doc-drift
hardening patch below, which landed concurrently.)

**Regression fix**
- `#379` Fuel `TaskCostPanel` — memoize known-categories set and collapse
  expand-state if the selected key falls off the set (e.g. after categorizer
  output shifts mid-session). Prevents orphaned expand state.

**UX improvements**
- `#380` Fleet → Graph quick-jump — new Network icon on each project card
  navigates to Graph/Visual with hiddenProjects seeded to everything except
  the target project. Audit flagged multi-click drill-down as friction. Added
  `navOptions` plumbing through App → ActiveComponent → Graph → VisualView
  for cross-module hints.
- `#381` Overseer Copy-as-Markdown — clipboard button on Strategic Analysis
  block and every Overseer chat answer. Transient "Copied" confirmation.
  Falls back to `document.execCommand('copy')` when `navigator.clipboard`
  is blocked (insecure context).
- `#382` Log scroll-to-top anchor — IntersectionObserver on a header sentinel
  detects when user scrolls away from latest; badge shows only when NEW events
  have arrived since leaving the top. Fixed-position bottom-right button
  smooth-scrolls back.

**Coherence**
- `#383` Shared `<Chip>` primitive — `client/src/components/Chip.jsx`.
  Two sizes (sm default / md), states (active / muted / default), renders as
  `<button>` when interactive or `<span>` when display-only. Migrated: Log
  time-range pills, Log sessions project chips, Overseer Q&A date-range pills,
  Overseer Q&A project chips. Graph view tabs + Fuel PLAN_DETAILS left alone
  (different visual role — tabs and rows, not chips).
- `#384` Empty-state tone standardized on **Status + Action/Education**.
  Log activity / sessions / timeline all gained actionable next-steps: "Clear
  all filters" when filters are active, or an education line pointing at the
  right mechanism (e.g. `nexus_log_session`) when genuinely empty.

26 MCP tools. Tests 189/189.

## v4.4.4 — Tier 2 Finale

Eight more Tier 2 items closed — the small/medium remainder of the UI-audit
Tier 2 backlog. The two BIG items (#343 Overseer refine mode, #307 LLM
contradiction detection) are carried forward to their own focused releases.

**Fuel (2 tasks)**
- `#264` Session Patterns headline metrics (burn rate, duration, fuel/session)
  now show week-over-week delta badges with color-coded direction. Analyzed
  sub-line exposes this-week / prior-week session counts.
- `#265` Task Cost by Category is click-to-expand — each row opens a list of
  the actual tasks that produced the average, with cost + session date.
  Server response now carries per-category task list.

**Dashboard (1 task)**
- `#238` ClockWidget week-ahead strip gains a burn-rate projection overlay.
  Server computes projected end-of-day weekly% based on 72h burn rate; UI
  tints days ≤40% (amber) / ≤15% (red), highlights the first day the line
  crosses zero with a red ring + "0%" label.

**Overseer (1 task)**
- `#344` Past Q&A now searchable once history ≥3 pairs. Three filter axes:
  free-text (question + answer), date range preset (today / 7d / 30d),
  detected-project chip. Filters compose as AND with a Clear pill.

**Graph Conflicts (2 tasks)**
- `#308` Empty-state copy expanded into three Q/A blocks: what is a conflict,
  why care, how to use it. Keeps the "No conflicts flagged" lead and the
  `rel='contradicts'` code tag.
- `#309` Always-visible historical counter row: Active · Ever flagged ·
  Resolved. "Ever flagged" counts all contradicts edges plus auto-detected
  potentials; "Resolved" counts flags where at least one endpoint decision
  is deprecated. Gives the tab a live state readout even at zero active.

**Log (2 tasks)**
- `#357` Time-range preset pills (All / Last hour / Today / 7d) narrow both
  the activity stream and the timeline view. Pairs with the existing search
  for precision lookups during bursty sessions.
- `#358` Per-type mute toggle — each type chip gains a small eye icon that
  hides that type from the stream for this session. Muted chips display
  struck-through. "Unmute all (N)" pill appears when any mute is active.
  Does not affect single-type-filter mode (user already narrowed).

No breaking changes. 26 MCP tools. Tests 189/189.

## v4.4.3 — Tier 2 Sweep II

12 more Tier 2 items closed. Mixed-theme release; Graph sub-tabs gain
meaningful interactivity.

**Fleet (3 tasks)**
- `#249` Cross-Project Priority rows show numeric score alongside `!!` bangs
- `#250` Project card title click → Command view
- `#251` "events/week" relabeled "events last 7d" with rolling-window tooltip

**Graph (8 tasks)**
- `#287` Blast Radius depth slider (1–4 hops); server `/impact/blast/:id`
  accepts `?depth=N`
- `#298` Centrality pagination — show top 15 by default with Load more /
  Show all / Collapse controls
- `#317` Holes healthy-projects label "×N decisions" (plural-aware)
- `#319` Holes hygiene warning — DIREWOLF / Projects artifacts show amber
  badge + ⚠ glyph (regression signal)
- `#330` Visual search/focus-by-ID input — matching nodes pulse; non-matching
  fade
- `#331` Visual controls hint ("drag node to move · click for details")
- `#334` Visual "Hide auto-linked" toggle — reveals the typed backbone by
  hiding `related` edges marked `auto-linked` or `semantic-linked`
- `#335` Visual color mode toggle — by project (default) or by cluster
  (connected-component). Makes "N clusters" claim visually verifiable.

**Log (1 task)**
- `#359` Expand-on-click for truncated messages via native `title` tooltip

**Docs**
- This CHANGELOG extended through v4.4.3
- README refresh (version + feature summary)
- GitHub repo description + topics updated

No breaking changes. 26 MCP tools. Tests 189/189.

## v4.4.2 — Tier 2 Sweep

First Tier 2 batch — 12 mixed-theme items. Key win: Graph sub-tabs finally
compose via `jumpToBlast` / `jumpToVisual` root helpers.

**Labels + precision**
- `#236` Dashboard Most Active "events" unit label
- `#237` Dashboard Thursday reset marker tooltip spells out weekly-fuel reset
- `#261` Fuel Learned Costs rounded from 3-decimal to 2 decimals
  (`1.953%` → `1.95%`)
- `#262` Fuel Session History column header + `pts` → `Readings`

**Overseer UX**
- `#345` Smart timestamps — today / yesterday / Nd / full date; hover shows
  full locale datetime
- `#346` Analyze Fleet button discloses cost: "~20-40s · ~1 GB VRAM spike on
  local AI · no Anthropic fuel"

**Graph discoverability**
- `#277` Knowledge Graph refresh button + spinner state
- `#263` Fuel time-of-day recommendation with n<2 + spread<10% guards to
  avoid n=1 false confidence

**Graph crosslinks**
- `#286` Blast Radius "Latest" shortcut — one-click analyze most-recent
  decision
- `#296` Centrality rows click-through to Blast Radius
- `#316` Holes orphan cards get "Link →" shortcut to Blast Radius
- `#329` Centrality hover Network icon deep-links to Visual with node focused

## v4.4.1 — Tier 1 Cleanup

12 remaining Tier 1 items closed. One of the larger single-release hauls.

**Headers + semantics**
- `#221` Command active-project chip when filtered
- `#246` Fleet "open tasks" → "not-done" with explicit semantics. Also fixed
  a real bug in `pulse.ts`: per-project task filter was title-substring-only,
  missing every task with a `project` field but no project name in the title.
  Nexus card was showing "2 open" when actual backlog was 150+.

**Log view**
- `#354` Activity entries click-through to source module
- `#355` Distinct icons + colors per event type (expanded TYPE_CONFIG for
  `graph` / `git_commit` / `git_fetch` / `memory_import`; sharpened existing —
  MapPin for Plotted, Lightbulb for Decision, Brain for Thought)
- `#356` Pagination beyond 200-cap with Load More button

**Graph polish**
- `#285` Blast Radius decision-ID autocomplete — new `DecisionPicker`
  combobox for type-searching by ID / text / project / tags
- `#306` Conflicts tab manual "Flag contradiction" form — first write-path
  on that tab; uses DecisionPicker for both endpoints
- `#315` Holes "Fragmented decision graphs" cards rearchitected with pill
  size badge, descriptor row, bordered divider, indented sample titles

**Live-data WS refresh**
- `#235` DigestWidget subscribes to WS events + freshness indicator + manual
  refresh
- `#247` WS_MAP extended so task / session / activity events invalidate
  `fleet` + `pulse` slices

**Overseer + audit**
- `#342` Dedup identical recent Ask questions (30-min window, soft-block
  with "Send anyway" override)
- `#314` Audited 77 anomalous Nexus ↔ Firewall-Godot cross-project edges —
  68/77 were fakes from generic-tag auto-linking (milestone ×52, github ×16).
  Added `GENERIC_TAGS` blacklist to `/ledger/auto-link`. v4.4.1-H3 migration
  pruned the residue at rest.

**New reusable primitive**
- `DecisionPicker.jsx` — combobox autocomplete for any "pick a decision"
  flow. Ready for future orphan-linking and Overseer "convert to decision"
  flows.

## v4.4.0 — Ambient Telemetry (final)

Consolidates v4.4.0-alpha + v4.4.0-beta into the stable v4.4.0 release. Adds two
final polish items:

- **v4.4.0-H2 hygiene migration** — normalizes the lowercase `"nexus"` project
  name (leaking in via `package.json`'s `"name"` field) to the canonical
  capital-N `"Nexus"` across all stored sessions / tasks / decisions. Extends
  the v4.3.9-H1 migration pattern. Residue surfaced in the v4.4.0-beta hook
  output's `Fleet uncommitted: Nexus: 1 · nexus: 1` line.
- **#369 Smarter project detection** — `cli/hooks/session-start.js` now checks
  `CLAUDE.md` for an explicit `# ProjectName` heading first, then falls through
  to `package.json`, `git remote`, and CWD basename. Every output is routed
  through a canonical casing map to kill the `nexus` / `Nexus` drift at the
  source.

No breaking changes from beta. Tests 189/189. 26 MCP tools.

## v4.4.0-beta — Ambient Telemetry Complete

Ships the four deferred items from alpha, closing the original Tier A+B
ambient-telemetry spec. `SessionStart` hook becomes async to support parallel
I/O.

- **#371 Tests baseline** — greps the last 10 commit messages for a
  `tests N/N green` pattern (leveraging our existing commit convention).
- **#373 Fleet-wide uncommitted** — bounded scan of the top-5 most-active
  projects from the sessions log. `git status --porcelain` per repo with 500ms
  timeout. `NEXUS_PROJECTS_DIR` env var configures the scan root.
- **#374 Overseer snapshot** — reads `_scheduledScans` in `nexus.json` and
  surfaces the latest digest + risk scan if fresh (<24h). Zero external calls.
- **#375 Services heartbeat** — parallel `net.createConnection` probes for
  LM Studio (`:1234`), Ollama (`:11434`), Dashboard (`:3001`), Vite (`:5173`).
  `Promise.all` batched; total cost ~200ms.

## v4.4.0-alpha — Ambient Telemetry (SessionStart)

First release of the v4.4 ambient-telemetry line. Enriches Claude's startup
context with 5 cheap high-value injections answering "what can Claude not see
that Nexus could provide?"

- **#368 Fuel freshness stamp** — `(read Nm ago)` + `⚠ STALE` warning over 2h.
- **#372 Git commits since last session** — `git log --since=<timestamp>` with
  the most-recent Nexus session as the cutoff.
- **#376 Memory pressure warning** — `⚠ elevated` ≥85% / `⚠ CRITICAL` ≥95% via
  `node:os`.
- **#377 Store health** — `nexus.json` size + backup freshness line.
- **#378 Working-tree diff summary** — `git diff --shortstat` one-liner when
  dirty.

## v4.3.10 — Graph Readability

10 Tier 1 fixes to the Knowledge Graph view and its 6 sub-tabs, selected for
"make the Graph view legible" theme.

- Centrality gets a column-header row, uniform truncation with hover-expand,
  and a "what's this?" degree-centrality explainer (#293, #294, #295).
- Visual gets hover tooltips including project name, an explicit project-color
  legend caption, and a V/A/D/P/R lifecycle letter legend. Fixed a missing
  `'R'` case in `lcLetter` that had v4.3.8 reference decisions rendering as
  `'A'` since their introduction (#325, #326, #327).
- Conflicts empty-state rewritten to stop implying active detection (#305).
- Blast Radius gains an explainer card + "Try one" chips auto-populated from
  most-recent + top-3 highest-centrality decisions (#284).
- Overview surfaces a `related` edge origin breakdown (keyword-auto /
  semantic-auto / manual) so signal is separable from auto-link noise (#271).
- Auto-link button becomes two-phase preview/confirm. Server supports
  `?dry_run=true` returning counts + up to 10 sample edges without writes
  (#272).

## v4.3.9 — Honest Instruments

10-task shortlist from the UI audit, themed "stop lying in the dashboard
before adding new surfaces."

Bug fixes: `#340` Overseer `undefined events` digest template, `#313` Graph
Overview Holes chip (was reading fragmented-project count instead of orphan
count — 7× under-reporting).

Label rewrites: `#234` "waiting for reset" session labels, `#233` System Pulse
"All instruments nominal" was lying at 97% memory.

Hygiene migration **v4.3.9-H1** (combining three tasks): U+FFFD mojibake scrub
across task titles and decisions, blank-project normalization across sessions
+ decisions (fixed Fleet Staleness `": 10d"` ghost row), `DIREWOLF` + `Projects`
alias normalization.

Features: `#259` shared `FuelFreshnessStamp` component, **`#220` Command-view
fuel widget** (the biggest UX win — session% / weekly% / minutes-left inline
on the landing page), `#341` Risk Scanner expanded from 5 to 9 categories.

## v4.3.8 — Memory Bridge First-Run Import

Ships the 26th MCP tool `nexus_import_cc_memories`. Scans
`~/.claude/projects/*/memory/*.md` (CC's auto-memory files) and imports each
as a `lifecycle: 'reference'` decision in the Ledger, tagged `cc-memory`.
Idempotent by design — file-path dedup via a new `_memoryImports` map on the
store. Mtime drift triggers update-in-place. Supports `dry_run`, `force`,
`project` filter.

Pre-existing gap fixed: `/api/cc-memory` was only served in standalone mode;
now wired in `dashboard.ts` too.

Tests 176 → 184 (+7 hermetic fixtures in `tests/memoryBridgeImport.test.js`).

## v4.3.7 — Version Visibility + Drift Prevention

Adds `nexus_version` (25th MCP tool) so "which Nexus is serving this session?"
has a definitive answer. Reports version, mode, applied migrations, tool
count, uptime, and overseer availability.

Single source of truth: `server/lib/version.ts` reads from root
`package.json`. Added a CI drift test asserting `TOOL_COUNT_EXPECTED` matches
both the `TOOLS` array AND `mcpb/manifest.json`.

## v4.3.6 — Audit Shakedown Patch

External-audit-driven patch. Security: `github.ts` `/commit` switched from
`execSync` with quote-escaping to `execFileSync` with argv, closing a command-
injection vector via the message body. Added `safeProject()` path-traversal
guard.

Idempotent migrations: new `_appliedMigrations` ledger records migration IDs
+ ISO timestamps so cold-start skips scans instead of re-walking tasks.
Bundle artifacts moved to `.gitignore` (rebuild locally).

## Before that

v4.3.5 and earlier: see git history and the tagged releases on GitHub.
