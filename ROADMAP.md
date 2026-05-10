# Nexus Roadmap

## Shipped

### v1.0-v2.0 — The Foundation
- Express + React + Tailwind dashboard, JSON store, WebSocket bridge
- 46-command CLI, 9 dashboard modules
- Full TypeScript migration (100% server)
- GPU telemetry, git fleet monitoring, project health

### v3.0 — The Autonomous Architect
- Knowledge Graph (90+ decisions, 5 typed edge types, blast radius, centrality)
- Local AI Overseer (Gemma 4 26B via LM Studio)
- Self-improving Advice Journal with verdict tracking
- Smart Fuel Intelligence with session/weekly tracking
- Predictive Task Generation from graph gaps
- Autonomous Session Planner
- Thought Stack (LIFO interrupt-recovery)
- Self-Critique (task completion patterns)
- Decision Guard (redundancy check)

### v3.1-v3.2 — The MCP Server
- 20 native MCP tools (brief, plan, guard, search, critique, predict, blast_radius, ask_overseer, create_task, complete_task, log_activity, log_session, log_usage, record_decision, link_decisions, push_thought, pop_thought, ask_overseer_start, get_overseer_result, bridge_session)
- MCPB bundle for one-click Claude Desktop install
- Async Overseer (start/poll pattern — no timeout issues)

### v3.3-v3.5 — Audit & Hardening
- Full codebase audit via parallel agents + MCP recon
- 153 route-level integration tests
- Atomic _flush with 3-generation backup rotation
- 27 (store as any) casts → typed accessors
- WebSocket exponential backoff
- Semantic auto-link via embeddings
- Static fuel display (reported values, not extrapolated)

### v3.6-v3.7 — Intelligence & Restructure
- GPU-aware abort signal (no fixed AI timeouts)
- AI inference semaphore (one at a time)
- aiFetch via undici (no 5min headers timeout)
- Overseer code-audit endpoint (reads own source)
- Frontend restructure: 10 → 7 modules (Command, Dashboard, Fuel, Graph, Overseer, Log, Terminal)

### v4.0-v4.1 — The Plugin
- Self-contained MCP server (in-process NexusStore, no Express needed)
- Claude Code Plugin package (skills, agents, hooks)
- Configurable PROJECTS_DIR (no hardcoded paths)
- 3 lifecycle hooks (SessionStart, Stop, UserPromptSubmit)
- Command module: project filter, priority badges, search, plan caching, expand/collapse, per-task difficulty estimation
- Published as Claude Code marketplace plugin
- Submitted to all 3 Anthropic plugin directories

### v4.1.1 — The Hardening
- Overseer self-audit: 18 findings (5 critical, 8 important, 5 polish) — all fixed
- store.ts: _flush crash rollback, semantic auto-link mutex, cached ID counters
- MCP: nexusFetch retry with 500ms backoff, nexus_brief per-call 10s timeout
- predict.ts: async filesystem ops, improved unvalidated decision matching
- embeddings.ts: SHA-256 cache keys (no collision), 2s debounce (less crash-window loss)
- Dashboard live sync: fs.watch + store.reload() + WebSocket broadcast bridges MCP→browser
- Frontend audit: 7 route signature fixes, in-progress filter bug, Graph divide-by-zero, Fuel null safety, Terminal stable keys, Overseer error display
- Code-audit batch mode (split 15 files into 2 halves for smaller context windows)
- Overseer GUI: dynamic model + GPU info (auto-detected from LM Studio)
- impact.ts: auto-detect model from /v1/models instead of hardcoded

### v4.2.0 — The Living Metabrain
- 22 MCP tools (up from 20)
- Decision lifecycle: proposed → active → validated → deprecated + confidence scores
- Task ↔ Decision links: provenance chain (decision_ids on tasks)
- Session → Task completion tracking: sessions auto-record which tasks they closed
- Advice → Decision chain: link Overseer recommendations to resulting decisions
- Cross-project fleet overview: nexus_fleet_overview ranks all tasks by urgency
- Thought auto-resolve: completing a task auto-pops linked thoughts
- Thought auto-recovery: SessionStart hook auto-pops top thought as RESUME context
- nexus_update_decision tool: edit decisions without breaking graph edges
- Selective code audit: audit specific files, not all-or-nothing
- /nexus-health skill: one-command installation verification
- Quick Actions: Start/Ship/Park task workflows (composite server endpoints)
- push_thought now accepts related_task_id for auto-resolve linkage
- MCPB standalone mode: NEXUS_STANDALONE=1 in manifest (MCP works without dashboard)
- Critical DB path race fix: lazy getDbPath() in esbuild bundle
- Plan-aware fuel system: FuelConfig with plan/timezone/schedule, 8 plan presets
- Fuel module rewrite: usage intensity labels, weekly forecast, smart insights
- Fleet module (8th dashboard module): per-project cards, cross-project priority
- ClockWidget: client-side 1s tick with live session/weekly countdowns
- Start/Ship/Park composite workflow buttons in Command UI
- Shared AI endpoint config (lib/aiEndpoints.ts)
- Dual weekly tracking: All models + Sonnet only limits
- 11 Overseer 31B audit patches on fuel pipeline

### v4.2.1 — Dashboard Maturity (shipped in v4.2 sessions)
- NexusProvider: 3 grouped contexts (Core/Fuel/Fleet), 6 modules migrated, ~18→8 API calls
- Activity Timeline: merged chronological stream with session/task/decision markers
- Graph Visual Overhaul: 5 edge type styles, project toggles, click-to-detail sidebar, responsive canvas, 8-color palette
- Overseer Chat History: persistent Q&A backed by advice journal
- Overseer Scheduled Scans: risk every 6h, digest every 24h
- family-coop project integration (M:\family coop NAS)
- Project name normalization: cleaned 29 decisions + 19 sessions
- Megatested: 153 tests, 24/24 API endpoints, full data integrity audit

## Current — v4.8.0 (Structural cleanup · shipped 2026-05-10)

The v4.7.x arc shipped nine point releases — one big refactor (#217 four-part
file split), two polish sweeps (Tier-4), and two Tier-3 closeouts. v4.8.0
collects the **structural** debt that survived: server-persistent auto-link
threshold (closing the long-pending UI ↔ server gap on `#280`), Zod
validation at route boundaries (closing `#219` deferred from the v4.3.6
audit), Vite bundle code-split (initial JS dropped 517kB → 232kB, a 55%
reduction by lazy-loading every dashboard module + the modals), and
`server/db/store.ts` migrations extracted into their own file (1752L → 1341L,
−23%). Plus housekeeping: 10 misfiled cross-project tasks reassigned to
their real homes, `#139` BACKLOG.md task closed as obsolete (the file was
removed long ago).

**Tier-3 deferred backlog: 0.** **Tier-4 polish backlog: 0.** **Both backlogs
that v4.5.10 introduced are now empty.** What's left is forward work — fresh
audits, whatever the next iteration of dashboard usage surfaces — and one
optional structural item: the rest of `server/db/store.ts` (the auto-link
helpers + read/write methods could split further, though the seams are less
natural than migrations).

**423 tests · 30 server endpoints · 29 MCP tools · no migrations · no
breaking changes.**

## Previous — v4.7.9 (Tier-3 closeout — alternative centrality + burst-grouping · shipped 2026-05-10)

Closes the **last two** Tier-3 deferred items from v4.5.10. Centrality view
gains betweenness (Brandes' algorithm) and eigenvector (power iteration with
self-loop shift) ranking metrics alongside the existing degree default —
each surfaces a different shape of "important" decision: hub vs bridge vs
deep core. Server `/api/impact/centrality` accepts `?metric=` and returns
all three values per row plus the requested sort. Log activity stream
gains burst-grouping: ≥3 consecutive same-type events within 60s collapse
into a single expandable row so bursty categories (Plotted, Commit) don't
bury substantive events. Toggleable via a button next to the time-range
chips, persisted in localStorage.

**Tier-3 deferred backlog: 0.** **Tier-4 polish backlog: 0.** What's left
across the roadmap is structural: the optional `server/db/store.ts` split
(~1700L, last sizable monolith), and whatever a fresh audit pass turns up.

**416 tests (+14 new for centrality algorithms) · 29 tools · no migrations
· no breaking changes.**

## Previous — v4.7.8 (Tier-4 closeout — minimap, export, ambient telemetry · shipped 2026-05-09)

Closes the **last three** deferred Tier-4 polish items in a single sweep —
Graph Visual minimap (`#336`), screenshot export with legend baked in
(`#339`), and SessionStart ambient telemetry now project-scoped with
session-age stamps on stacked thoughts (`#370`). Plus a small data-sweep
side-quest: 28 `Firewall/Godot` slash-form occurrences in the store
normalized to the canonical `Firewall-Godot` (the v4.6.2-D2 hygiene
migration didn't catch them; backup at `~/.nexus/nexus.json.preNormalize`).

**Tier-4 polish backlog: 0.** The visible-polish wave is done. What's left
across the roadmap: Tier-3 deferred (`#301` Centrality alternative ranking
metrics, `#363` Log burst-grouping), the optional `server/db/store.ts`
split (~1700L, last sizable monolith), and whatever the next audit pass
turns up.

**402 tests · 29 tools · no migrations · no breaking changes.**

## Previous — v4.7.7 (Tier-4 polish sweep · shipped 2026-05-09)

Closes 12 of the remaining 15 Tier-4 polish items in one sweep. The
backlog post-#217 was almost entirely visible polish — tooltips, sort
controls, keyboard shortcuts, empty-state diagrams, edge-type contrast,
and the long-pending cs/en localization mix. This release lands them
together so the dashboard feels finished, not in-progress.

**Foundation:** new `client/src/lib/locale.js` (cs ↔ en singleton via
`useSyncExternalStore` + localStorage; no Provider rewrite). Sidebar
footer carries the toggle; Fuel TaskCostPanel + Session Patterns and
Log Today/Yesterday/dates re-render reactively on flip.

**Visual:** edge-type palette diversified — `replaced` gray→cyan and
`experimental` teal→lime so all 7 rel types are clearly distinct; new
`width` field per edge type adds a second visual encoding (depends_on/
contradicts render thicker than related/experimental).

**Power-user:** Graph Visual `/` focus search + 1-3 layout swap +
freshness stamp ("Graph indexed Ns ago"); Log activity tab 1-9 to jump
to filter chips with inline numeric hints.

**Insight:** Centrality auto-callout on top-8 project distribution
(strong / lean / diverse tones); Blast Radius empty-state now shows a
concentric-rings SVG diagram explaining the concept at a glance.

**Closed:** `#243`, `#267`, `#268`, `#270`, `#283`, `#292`, `#304`,
`#323`, `#337`, `#338`, `#365`, `#366`. Deferred for follow-up:
`#336` (Visual minimap), `#339` (screenshot capability), `#370`
(ambient telemetry hook).

**402 tests · 29 tools · no migrations · no breaking changes.**

## Previous — v4.7.6 (MCP server split · shipped 2026-05-08)

Closes the fourth and biggest installment of `#217`. The MCP server
monolith (`server/mcp/index.ts` at 1991L: 29 tool defs + 893-line dispatcher
switch + helpers + stdio setup) breaks into foundation libs
(`server/mcp/lib/{config,nexusFetch,format}.ts`) plus per-category tool
modules (`server/mcp/tools/{read,write,ai,composite}.ts`) plus a tiny entry-
point. **`mcp/index.ts`: 1991L → 164L (−92%).** Same 29 tools, same manifest,
same wire protocol — MCPB smoke-tested end-to-end on the new structure.

`tests/mcpToolsRegistry.test.ts` adds **22 specs** (per-group tool/handler
shape, no-duplicates, total-equals-TOOL_COUNT_EXPECTED, foundation lib
smoke). `tests/versionDrift.test.ts` source-grep updated to scan the new
per-category files. Total 380 → **402 tests · 29 tools · no migrations ·
no breaking changes.**

With this, `#217` is **fully shipped** across all four parts:
v4.7.1 graphLayouts · v4.7.2 graph/ views · v4.7.5 cli/ split · v4.7.6
mcp/ split. Total delta: Graph.jsx −1168L, cli/nexus.js −697L, mcp/index.ts
−1827L.

## Previous — v4.7.5 (CLI command split · shipped 2026-05-07)

Closes the third installment of `#217` (split oversized files). The CLI
monolith (`cli/nexus.js` at 2047L) is broken into foundation libs +
per-group command files: `cli/lib/{format,api}.js` (helpers) and
`cli/commands/{tasks,sessions,ledger,git}.js` (23 commands). **`cli/nexus.js`:
2047L → 1350L (−34%).**

Same UX, same dispatcher, smaller files. The `commands` registry is now a
spread-merge of inline + per-group registries. Surgical extraction used the
guarded Node one-liner pattern from v4.7.2 session #247 (assert landmarks,
splice ranges).

`tests/cliCommands.test.js` adds **11 specs** — per-group export shape ×4,
cross-group no-duplicates, foundation lib smoke ×2. Catches the most likely
regression class (silent command drops during the move). Total 369 → **380
tests · 29 tools · no migrations · no breaking changes.**

## Previous — v4.7.4 (Today fusion view · shipped 2026-05-07)

Closes `#240` (Tier-3 UX prototype, deferred since v4.5.10). Single dense
header card on the Command tab fusing **fuel · current task · recent
activity · top risk** into a glance. Visible above both strategic and
kanban views; reuses the same data props those views already consume — no
new fetches, no new endpoints.

Pure derivation logic in `client/src/lib/todayView.js` (formatTimeAgo,
fuelPressure, formatRunway, topRisk, deriveTodayState). JSX in
`client/src/modules/command/TodayView.jsx` is dumb glue. **27 new specs**
(node-only Vitest, no jsdom needed) covering every helper plus the full
derivation. **Total 342 → 369 tests · 29 tools · no migrations · no
breaking changes.**

With `#240` shipped, **all v4.5.10-deferred Tier-3 items are closed**.
Remaining work splits cleanly into structural debt (`#217` part 3 —
`cli/nexus.js` split) and Tier-4 polish.

## Previous — v4.7.3 (Auto-suggest Contradictions · shipped 2026-05-07)

Closes `#310` (deferred Tier-3 since v4.5.10). The v4.4.8 #307 contradiction
scan engine ran only on manual click; v4.7.3 schedules the same scan
automatically on a 24h cadence. With this, the Tier-3 deferred list from
v4.5.10 is fully drained.

**`server/watchers/contradictionPoller.ts`** (NEW): `runContradictionScan()`
performs one full cycle (POST `/scan-contradictions` → poll
`/ask/result/:taskId` until done). `startContradictionPoller()` wires it
into `dashboard.ts` alongside the existing risk/digest scheduled scans.
20 max_pairs per scan (same as manual), 23h skip-if-recent guard, silent
skip when Overseer is down.

**Brief surfacing**: `nexus_brief` now shows
`Pending Overseer suggestions: N contradictions · last scan Xh ago` when
suggestions are queued, with a pointer to the Conflicts tab. New
suggestions also fire a WS toast for live dashboard surfacing.

**9 new tests** in `tests/contradictionPoller.test.ts` — pure
`shouldRunContradictionScan` × 5 (undefined / 1h / boundary / 25h) plus
`runContradictionScan` × 4 (skipped-recent · skipped-overseer-down ·
completed-with-toast · completed-zero-new-no-toast). Total 333 → **342
tests · 29 tools · no migrations · no breaking changes.**

## Previous — v4.7.2 (Graph Splits + Memory Bridge Polish · shipped 2026-05-07)

Stacked batch closing the top three follow-ups from the v4.7.1 handover.

**`#217 part 2` Graph.jsx view extraction**: `CentralityView`,
`ContradictionsView` (with the v4.6.5 #311 resolution workflow + 4 helpers),
and `HolesView` (with `ClusterMiniViz`) lift to per-view files under
`client/src/modules/graph/`. Render dispatch in `GraphModule` unchanged.
**Graph.jsx 2426L → 1327L (−1099 / −45%)**, beating the v4.7.1 handover's
~1500L estimate. The v4.7.1 layouts pattern replicates cleanly for stateful
views with cross-tab navigation and fetch effects.

**`#591` encodedProject sandbox-path bug**: `buildEntry()` in
`memoryIndex.ts` derived `encodedProject` correctly for CC-dev paths but
returned `'mnt'` for Cowork sandbox paths (`/sessions/<id>/mnt/.auto-memory/
file.md`). Fixed by detecting the dot-prefixed memory dir name and walking
one extra `dirname()` level up. 2 new specs covering both layouts.

**`#592` CLI `nexus memory sources`**: deferred from the v4.7.0-M1 spec;
ships now. Reads `~/.nexus/nexus.json` directly (no server hop) and prints
the configured `_memoryBridge.sources[]` with status, machine hints, and
the dedup strategy.

**Bonus**: fixed a date-expired test in `tests/store.test.js` that started
silently failing today (2026-05-07 = 31 days after the hardcoded `2026-04-06`,
past the store's 30-day retention cutoff). Now uses relative timestamps.

**Total 331 → 333 tests · 29 tools · no migrations · no breaking changes.**

## Previous — v4.7.1 (Graph Layouts + Algorithm Extraction · shipped 2026-05-05)

Rides on top of v4.7.0. Half-session Tier-3 batch closing `#332` from the
v4.6.5 handover, originally built locally as v4.6.6 and rebased onto v4.7.0
when the multi-source memory bridge was discovered to have shipped from a
different machine.

**`#332` alternative graph layouts**: VisualView gains `force` /
`circular` / `hierarchical` layouts via a switcher pill group, persisted in
localStorage. Algorithms extracted to `client/src/lib/graphLayouts.js` as
pure functions — `Graph.jsx` shrinks from 2495L → 2426L, demonstrating the
extraction pattern that `#217` will need at scale.

**31 new tests** in `tests/graphLayouts.test.js` — shared-contract checks ×
3 layouts, plus geometry assertions (ring radius equality, hub-at-top in
hierarchical, component slab separation) and force-directed physics. Total
300 → **331 tests · 29 tools · no migrations**.

## Previous — v4.7.0 (Multi-source CC memory bridge · shipped 2026-05-02)

Memory bridge becomes config-driven. The pre-v4.7 single-path scanner
(`~/.claude/projects/*/memory/*.md`) is now one entry in
`_memoryBridge.sources[]`. Append a Cowork-sandbox path or any other glob
to scan multiple surfaces in one call. Optional content-hash dedup collapses
the same persona/feedback file across machines into one Decision while
tracking every source path. Per-source try/catch — a missing sandbox dir
just yields an empty list and a `sourceErrors[]` entry rather than crashing
the import. 17 new tests, 300 total. Spec:
`v4.7.0-M1_multi_source_memory_bridge.md`. Triggered by Nalira's TUL-sandbox
session 2026-05-02 — 19 TUL-project memories that were invisible to the
home-PC bridge are now reachable via a single config edit.

### v4.5.0–v4.6.5 (compressed)

v4.5.0 kicked off as a theme-wide microanimation pass; the v4.5.x train
closed Tier 2 (v4.5.9), swept Tier 3 (v4.5.10), and shipped the sliding
weekly fuel window (v4.5.11/12). v4.6.0 introduced the Continuous Handover
system that v4.7.1 used end-to-end. v4.6.1 added Overseer Sweep +
Route Tests (+33 specs), v4.6.2 ran D1+D2 graph-hygiene migrations, v4.6.3
fixed the orphan metric to exclude reference imports, v4.6.4 hot-fixed
double-stringified POST bodies, v4.6.5 closed the store-reload race and
shipped the Conflicts resolution UI. See **`CHANGELOG.md`** for full
per-release detail.

### The arc in one paragraph
v4.3.5 kicked off with an audit shakedown (data/code/dashboard). v4.3.6
patched a command-injection vuln. v4.3.7 added version visibility. v4.3.8
shipped the Memory Bridge first-run import. v4.3.9/v4.3.10 closed UI-audit
shortlist items. v4.4.0 introduced the ambient-telemetry hook layer (alpha
→ beta → stable). v4.4.1/v4.4.2/v4.4.3/v4.4.4 closed the UI-audit
Tier 1 + Tier 2 small/medium backlogs across Fuel, Dashboard, Fleet,
Graph (Visual/Centrality/Holes/Conflicts), Overseer, Log.

### Remaining from the audit
- **Tier 2 BIG** — both items shipped: `#343` Overseer refine mode (v4.4.7),
  `#307` Contradiction scan engine (v4.4.8). **Backlog empty.**
- **Tier 3/4** — longtail polish. Not urgent. `nexus_search "Tier 3"` for list.

### Non-audit backlog
- `#217` Split oversized files — Graph.jsx done (v4.7.1 layouts + v4.7.2 views,
  2495L → 1327L). Remaining: `cli/nexus.js` (~2049L now), `mcp/index.ts` (1700L+).
- `#218` Route tests for github / overseer / webhooks — partial in v4.6.1.
- `#219` Zod runtime validation at route boundaries — deferred.

## Historical — v4.3 (in flight at the time)

### Philosophy pivot (Decision #144)
Nexus becomes the reasoning layer ON TOP of CC's native scaffolding (memory, plans, scheduled-tasks, chapters, spawn-task, hooks, skills) — not a parallel universe. Every v4.3 item buckets into HARMONIZE (integrate with CC), AMPLIFY (compose on top), or OWN (Nexus-unique).

### Shipped in v4.3
- **#205-#207 Housekeeping** — version bump 4.2.0 → 4.3.0, MCPB rebuild, digest filter case-insensitive + trim
- **#189 HARMONIZE: Plan Archaeology** — `nexus_brief` reads `~/.claude/plans/` and surfaces recent plans, project-filtered
- **#190 HARMONIZE: Kill redundant activity logging** — UserPromptSubmit hook now a no-op stub; CC session JSONL is the raw log
- **#191 AMPLIFY: Chapter Narrator (advisory)** — SessionStart hook emits `mark_chapter()` suggestions; `/nexus-brief` skill documents the convention
- **#195 OWN: Knowledge Graph v3** — 2 new edge types: `informs` (context without dependency), `experimental` (tentative, revisit). Graph visualizer updated with distinct styles.
- **#194 AMPLIFY: Calendar-aware fuel** — new `nexus_calendar_runway` tool + `/nexus-runway` skill. Claude fetches upcoming events via Calendar MCP, Nexus classifies the fit against fuel runway (comfortable / tight / wrap_now / unreachable).
- **#196 OWN+HARMONIZE: Overseer reads CC scaffolding** — `gatherContext` now includes 5 recent CC plans + 10 CC memory entries in the Overseer's prompt. Lets the Overseer cross-reference Nexus decisions against what CC has recorded about the user's workflow.
- **#198 HARMONIZE: Memory Bridge Phase B (advisory write path)** — `nexus_record_decision` gains `emit_cc_memory: true` param. When set, Nexus composes a ready-to-write memory file (YAML frontmatter + body + recommended filename) that Claude can persist via the Write tool. Closes the write half of the Memory Bridge. First-run import of existing memories remains queued as #200.
- **#197 OWN: KG auto-edge generation (Overseer-powered)** — new `nexus_propose_edges` MCP tool + `POST /api/overseer/propose-edges` route. Given a decision id, Nexus pulls candidate decisions, builds a structured JSON prompt, and the Overseer proposes typed edges with confidence + reason. Async — returns taskId; user polls with `nexus_get_overseer_result` and commits chosen edges via `nexus_link_decisions`. Advisory flow respects the "Nexus suggests, Claude acts" pattern.

### v4.3.5 Patch (audit-driven shakedown)
Three-front audit (data / nexus code / dashboard) produced 14 tasks. Shipped:
- **C1 CRITICAL: Task project-field backfill** — idempotent migration in store constructor infers project from decision_ids → keyword patterns → default "Nexus". 146 tasks backfilled on first load. `createTask` now persists project on creation so migration doesn't re-run.
- **C2 CRITICAL: bridge_session standalone mode** — lightweight counts-based `/api/auto-summary` handler in localApi; avoids a 4x bundle bloat from importing the AI stack.
- **C3 CRITICAL: Watcher cleanup on SIGINT** — captured refs from fileWatcher/gpuPoller/overseerPoller, clear/close in SIGINT handler. Fixes memory leak on restart.
- **I1: Decision lifecycle backfill** — 108 decisions gained lifecycle (validated/proposed/active/deprecated) via centrality + age heuristics.
- **I2: Version string sweep** — dashboard.ts, cli/nexus.js, cli/package.json all aligned to 4.3.5.
- **I3: MCPB smoke-test coverage** — added assertions for nexus_calendar_runway (empty-events path) and nexus_propose_edges (standalone-error path).
- **I4: React perf** — delegated in-map onClick handlers via data-attr pattern in Graph.jsx tabs + project toggles; useCallback on Overseer executeFix.
- **I5: Graph.jsx hex → theme tokens** — extracted `client/src/lib/theme.js` with THEME / PROJECT_PALETTE / EDGE_STYLES / LIFECYCLE_COLORS; Graph.jsx imports from there.
- **I6: WS_MAP notification** — added `notification: []` entry documenting ToastOverlay's direct handling as the intentional exception.

### v4.3.6 Patch (external-audit shakedown)
Full-repo audit (2026-04-16) produced 10 ranked findings. Decision #5. Shipped:
- **C1 CRITICAL: Command injection in github.ts:86** — `/commit` endpoint passed user-controlled `message` through `execSync` with quote-only escaping; `$()` + backticks passed through for RCE. Replaced with `execFileSync('git', ['commit', '-m', msg])` argv form. Added `safeProject()` basename guard on `/commits/:project` and `/commit` to block path traversal. Clipped message to 500 chars + stripped control chars.
- **H1: Test-count reconciled** — actual count 169 (5 test files: routes, store, graph, ccScaffolding, estimator). README.md + CONCEPT.md updated from "153 Vitest" → "169 Vitest".
- **H2: Tool-count reconciled** — README.md:108 architecture table and CONCEPT.md both updated "22 tools" → "24 tools". MCPB manifest was missing 2 tool entries; added `nexus_calendar_runway` and `nexus_propose_edges` descriptors. Plugin README "22 non-AI" clarified to "20 non-AI" (4 AI-dependent tools listed).
- **H3: .gitignore generated artifacts** — `mcpb/nexus.mcpb`, `mcpb/server/index.js`, `plugin/server/index.js` (23k-line esbuild output) added to .gitignore so fresh builds don't churn the repo. Still-tracked copies need `git rm --cached` in release commit.
- **H5: Silent catches logged** — `github.ts` (ahead/behind, scanGitRepos, syncAllRepos, getAllCommits), `embeddings.ts` (cache corrupt / fetch failure / write failure) now log via `console.error` or `console.warn`. Gated noise (ahead/behind absent = no upstream) behind `NEXUS_DEBUG`. Hook catches left intentional.
- **M1: Persistent `_appliedMigrations` ledger** — `NexusData._appliedMigrations: Record<string,string>` tracks which one-shot migrations ran. C1 (task.project backfill) and I1 (decision lifecycle) now skip the scan entirely on subsequent cold-starts; mark-applied after every run so empty first-loads don't re-scan forever.
- **Release: version sweep** — 4.3.5 → 4.3.6 across root/cli/manifest package.json, cli/nexus.js splash, server/mcp/index.ts SERVER_VERSION, server/index.ts /api/status, server/dashboard.ts /api/status, server/routes/init.ts /nexus-health.

### Queued for v4.3.7+ (from v4.3.6 audit — deferred scope)
- **H4: Integration tests for github.ts / overseer.ts / webhooks.ts** — 0 coverage on the injection site (now patched) + AI + outbound fetch.
- **M2: Zod runtime validation at route boundaries** — activity.meta stringify/parse drift + untyped request bodies.
- **M3: Split oversized files** — cli/nexus.js (1969), server/mcp/index.ts (1647), server/db/store.ts (1074), server/routes/overseer.ts (674).

### v4.3.7 Patch (version visibility + drift prevention)
Motivated by the post-v4.3.6-restart friction where neither user nor assistant could answer "which Nexus is serving me?" without side-channel checks (extension-folder manifest, `_appliedMigrations` peek). Decision #6. Shipped:
- **F1a: `nexus_version` MCP tool** — returns `{version, mode, store_path, applied_migrations, tool_count, uptime_seconds, overseer}`. Zero side-effects; inlined constants + on-disk migration read + ~2s AI-endpoint probe. Tool count bumps 24 → 25.
- **F1b: Version in `nexus_brief` header** — every brief now starts `◈ NEXUS BRIEF — {project} (v{SERVER_VERSION} · {standalone|dashboard})`. Answers the question without needing `nexus_version` in the common case.
- **F1c: Single source of truth** — `server/lib/version.ts` reads from root `package.json` via JSON import (works bundled via esbuild, unbundled via tsx). Replaced 7 hardcoded version strings across `server/mcp/index.ts`, `server/dashboard.ts`, `server/index.ts`, `server/routes/init.ts`, `cli/nexus.js`. Docs synced 24 → 25 tools in `README.md` / `CONCEPT.md` / `plugin/README.md` / `mcpb/manifest.json`.
- **F1c-test: `tests/versionDrift.test.ts`** — 7 new assertions guarding: (a) `cli/package.json.version === package.json.version`, (b) `mcpb/manifest.json.version === package.json.version`, (c) `SERVER_VERSION` from `version.ts` matches root, (d) `TOOL_COUNT_EXPECTED === mcpb/manifest.json.tools.length`, (e) `TOOL_COUNT_EXPECTED === TOOLS array length in mcp/index.ts` (grep-based so tests don't boot the MCP), (f) every manifest tool name exists in the MCP source. Next audit can't surface the same H1/H2 drift class again — CI goes red the moment they disagree.
- **Smoke-test coverage** — added assertion in `mcpb/smoke-test-bundle.mjs` that `nexus_version` returns the package-declared version and required fields. v4.3.5 I3 precedent.
- **Release**: 176/176 tests green (was 169 + 7 new drift specs); MCPB rebuilt + smoke-passes on all 25 tools.

### Queued for v4.3 (superseded — all shipped or rolled into v4.4 arc)
Kept for historical context. See CHANGELOG for where each item landed:
- **#188 HARMONIZE: Memory Bridge** — shipped in v4.3.8 (first-run import)
- **#192 AMPLIFY: Thought Stack ⇄ spawn_task** — deferred; re-evaluate in v4.5
- **#193 AMPLIFY: Migrate Overseer scans to `mcp__scheduled-tasks__*`** — partial in v4.3.x
- **#194 AMPLIFY: Calendar-aware fuel** — shipped in v4.3
- **#196 OWN+HARMONIZE: Overseer reads CC scaffolding** — shipped in v4.3
- **#197 OWN: KG auto-edge generation** — shipped in v4.3 (`nexus_propose_edges`)

## Future — v5.0 Vision

### Full-Codebase Overseer
- Load entire project source into 200k context
- AI-powered code audit, refactor suggestions, test generation
- Scheduled background audits (daily/weekly)

### Cross-Instance Memory
- Multiple Claude Code instances share the same metabrain
- Thoughts pushed by one instance are popped by another
- Session summaries auto-generated per instance

### Autonomous Metabrain
- Auto-link decisions via AI (not just keyword/embedding)
- Weekly AI-generated digest narrative
- Proactive risk detection (the Overseer flags problems before you ask)
- The metabrain improves itself without being asked

## Non-Goals
- No cloud sync (local-first forever)
- No user accounts or teams
- No mobile app (workstation tool)
- Stays fast, stays opinionated
