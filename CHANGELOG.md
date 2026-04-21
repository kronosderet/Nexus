# Changelog

Nexus — The Cartographer. Local-first metabrain plugin for Claude Code.

The v4.3.5 → v4.5.3 arc kicked off after the initial "Audit Shakedown" (v4.3.5)
released in mid-April 2026. What follows covers 17 versioned releases plus one
major UI audit, one big `Memory Bridge` import feature, the ambient-telemetry
hook layer (v4.4.0 alpha/beta/final), nine post-v4.4.0 patch releases closing
the **entire** UI-audit backlog, and the v4.5.0 theme-wide "Animated
Instruments" microanimation pass.

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

## v4.5.4 — Fuel Insights Correctness

Three Tier-1-class correctness fixes to the Fuel Intelligence surface. Users
were rightly mistrusting the numbers because they sometimes reflected noise.

**`#257` — outlier filter for Most/Least efficient ranking**
- Previously "Most efficient: 0%/h over 2.2h" (a session where the user
  never re-read fuel mid-work) and "Least efficient: 487.5%/h over 0.2h"
  (a near-instant reading dividing by ~12 minutes) could leak in.
- New filter requires `durationHours ≥ 0.5`, `burnRate in (0, 200]%/h`,
  `dataPoints ≥ 2`. Sessions that fail drop out of the ranking.
- Server returns `null` for `mostEfficient` / `leastEfficient` when the
  filtered set has fewer than 2 entries; client renders "Not enough clean
  session data yet" instead of garbage numbers.
- New `validSessionCount` field lets the UI footnote "based on N of M
  sessions that passed the outlier filter".

**`#258` — confidence gate on timing recommendation**
- Previously "Best efficiency during night sessions (avg 11% burned per
  session)" could ride on n=1. Now requires ≥3 sessions per time slot
  before that slot is eligible for the headline "best" claim.
- New `timingConfidence: 'none' | 'low' | 'normal'` field on the weekly
  plan response. `low` when the winning slot has n < 5. Client renders
  an inline "low confidence" tag so users don't act on noise.
- The recommendation string itself now includes the sample size
  (`"n=4"`) so readers can calibrate immediately.

**`#260` — plain-language backlog clear-time**
- Previously "Est. sessions ~26 to clear backlog" sat next to "Sessions
  affordable 10 this week" and users had to divide in their head.
- Server now computes `backlog.clearTimePlain` with graceful copy:
  - `< 0.5 weeks` → "backlog clears within this week"
  - `< 1.2 weeks` → "backlog clears in ~1 week"
  - else → "backlog clears in ~N weeks"
- Renders as a `◈`-prefixed dim line below the stat grid.

**Side-cleanup: six stray task re-classifications**
Tasks `#135`, `#138`, `#139` were Shadowrun sprint work miscategorized as
Nexus; `#182`, `#183`, `#186` were Level Magazine parser work also
miscategorized. All moved to their correct projects. No code change —
store-level `PATCH /api/tasks/:id` with `{ project }`. Was possible because
of the v4.5.3 project-config refactor that generalized the classifier.

228 tests. 27 MCP tools. No breaking changes.

## v4.5.3 — Project Config + History Cleanup

Maintenance release. No new features, no breaking changes for existing users.

**User-configurable project patterns (`server/lib/projectConfig.ts`)**
- Project classification patterns + extra-project paths now load from an
  optional user config at `$NEXUS_HOME/projects.json` instead of being
  hardcoded in multiple server files.
- Default out-of-the-box patterns match only "Nexus" itself. Anything else
  is classified via the user's config (or falls back to the default).
- Shape: `{ "patterns": [{ "name": "MyProj", "patterns": ["\\bmyproj\\b"] }], "extra": [{ "name": "shared", "path": "D:/shared" }] }`.
- Call-sites updated: `store.ts` (project backfill migration), `memoryIndex.ts`
  (CC memory project inference), `planIndex.ts` (plan scan), `routes/plan.ts`
  (task filtering), `routes/pulse.ts` (extra project directories).
- Client: Overseer Q&A filter now derives "known projects" from the live
  Fleet slice instead of a static list.
- MCP tool descriptions: generalized away from specific project-name examples.

**History hygiene**
- `nexus.json` and `nexus-embeddings.json` were accidentally committed in
  v1.0 / v1.1 and later removed but persisted in git history — 979 KB of
  first-developer state recoverable via `git show <old-sha>:nexus.json`.
  History rewritten via `git-filter-repo` to purge these files from every
  commit. Anyone who had cloned a pre-v4.5.3 copy will need to reclone.
- `_appliedMigrations` shape unchanged; migration ids preserved. No data
  migration needed on existing installs.

228 tests. 27 MCP tools.

## v4.5.2 — Smoke-Test Self-Cleaning + `nexus_delete_task`

User reported: "smoke test task reappearing... hanging and reloading into
Command and Log." The release smoke test was creating a `SMOKE TEST TASK`
and a `smoke test activity` entry on every `npm run mcpb:test`, then only
marking the task done. Over many releases these piled up in the Command
Done column and the Log activity timeline.

**New MCP tool — `nexus_delete_task`**
- Permanently deletes a task by id (existing `store.deleteTask` was only
  reachable via HTTP). Complement to `nexus_complete_task`. Tool count
  26 → **27**.
- Added to `server/mcp/index.ts` (schema + handler), `mcpb/manifest.json`
  tools array, and `server/lib/version.ts` `TOOL_COUNT_EXPECTED`.

**Drift-guarded surfaces refreshed (26 → 27)**
- `README.md` (hero tagline · section heading · architecture table)
- `CONCEPT.md` (intro bullet · architecture table)
- `mcpb/README.md` (section heading · tool list adds `nexus_delete_task` under Write)
- `plugin/README.md` (tool-list header · tool list)
- `mcpb/manifest.json` (`long_description`)
- `cli/nexus.js` (two splash strings)
- `.claude-plugin/marketplace.json` · `plugin/.claude-plugin/plugin.json`
- `client/src/components/WelcomeScreen.jsx` (`TOOL_COUNT` constant)

**Self-cleaning smoke test — `mcpb/smoke-test-bundle.mjs`**
- After the MCP subprocess exits, `cleanupSmokeTraces()` post-processes
  `~/.nexus/nexus.json` to remove any activity entries from this run
  (matches on "smoke test activity" exact, "safe to delete" in message,
  or task-id match in meta) and usage entries with note=`smoke test`.
- Calls `nexus_delete_task` on the created task right after
  `nexus_complete_task` — exercises both, leaves zero trace.
- Existing orphan (task #110 + related entries) cleaned manually during
  this release via `DELETE /api/tasks/110`.

**Tests** 228/228 (unchanged — the drift guard already re-runs against the
new TOOL_COUNT_EXPECTED = 27 and passes because every surface was updated
in lockstep).

## v4.5.1 — Hotfix: Rules of Hooks

Two `useTweenedNumber` calls landed *after* early-return guards in v4.5.0,
which violated the Rules of Hooks and crashed the Dashboard (Pulse) module
and the Fuel module whenever data was loaded.

**Root cause**: on the first render, early-return paths skip the hook calls;
on subsequent renders when data arrives, the hooks execute — React detects
the hook-call-order change and throws, breaking the component tree.

**Affected components**
- `client/src/components/ClockWidget.jsx`: `useTweenedNumber(fuel?.session)`
  and `useTweenedNumber(fuel?.weekly)` were placed after `if (!serverData)
  return null`. Moved above the guard; hook now reads `serverData?.fuel?.session`
  with optional chaining so null pre-load state is safe.
- `client/src/modules/Fuel.jsx`: same pattern with
  `useTweenedNumber(session)` / `useTweenedNumber(weekly)` after the
  `if (!fuel?.tracked) return <empty state>` guard. Moved above; hook reads
  `fuel?.estimated?.session ?? 0`.

**Why tests didn't catch it**: the component-render tests exercise mount with
data already present. They don't flip between null-data and present-data
mid-lifecycle, which is exactly when hook-order violations surface in React.
A future test-quality improvement would mount with null data first, then
update the slice to populate it — but that's a harness change beyond the
scope of this hotfix.

Dashboard tab now renders. Fuel tab now renders. 228 tests.

## v4.5.0 — Animated Instruments

First minor-version bump since v4.4.0. Theme-wide microanimation pass across
the dashboard. The UI went from "correct and functional" to "feels alive" —
every module gets kinetic polish that reinforces state changes without
becoming decorative noise. Full `prefers-reduced-motion` respect means users
who opted out of motion see instant transitions.

**Foundation (`client/src/index.css`, `client/src/hooks/useMotion.js`)**
- Eight new CSS keyframes: `row-reveal`, `page-mount`, `ws-flash`,
  `success-flash`, `status-change`, `shimmer-sweep`, `number-tick`, plus
  welcome-screen carryovers from v4.4.9.
- `useTweenedNumber(target, {duration})` — requestAnimationFrame cubic-out
  easing for numeric displays. Snaps instantly under reduced-motion.
- `useWsFlash(items, getId)` — detects items that arrived after first mount
  so rows can wear an amber flash class once. First-render items never flash.
- `PREFERS_REDUCED_MOTION` constant for JS-side bailouts.
- Single `@media (prefers-reduced-motion: reduce)` block disables every
  decorative animation in one place.

**List reveals** — every list that grows during a session now reveals rows
with a tiny y-translate + opacity fade (180ms per row, 18–40ms stagger,
capped so long lists don't feel sluggish):
- Log activity stream (w/ WS flash on newly-arrived rows)
- Log sessions list
- Fleet project cards
- Command kanban task cards (all columns)
- Overseer chat history
- Graph suggested-contradiction cards

**Page-mount fade** — every module's top-level `<div>` gets `animate-page-mount`
(160ms opacity fade) so navigating between modules feels intentional rather
than abrupt. Applied to: Command, Pulse, Fleet, Fuel, Graph, Overseer, Log.

**Number tweening** — Fuel gauges (session + weekly) and ClockWidget fuel
percentages now animate from old value to new when the user logs a fresh
reading, instead of jumping instantly. 450ms cubic-out.

**Success flash** — `SuggestedContradictionCard` wears `animate-success-flash`
(green wash, 700ms) after Accept/Dismiss before the parent unmounts it.

**Status-change highlight** — `TaskCard` tracks its previous status via a ref;
on change, wears `animate-status-change` (amber bg + ring, 900ms). Fires when
tasks move between kanban columns.

**Overseer scan shimmer** — `ScanContradictionsPanel` scan button wears
`animate-shimmer-sweep` while polling. Diagonal amber highlight sweeps across
the button every 2s to signal the async work is live without competing with
the spinner.

**WebSocket-driven row flash** — Log activity rows that arrive via WS after
the component mounts wear `animate-ws-flash` (amber wash, 900ms) on their
first render. Lets users spot live updates without scanning.

No breaking changes. No new dependencies — all pure CSS + RAF-based JS hooks.
Production build: 47 kB CSS (+ ~0.8 kB for the new keyframes), 428 kB JS
(unchanged — the motion hooks inline into the main chunk).

**228 tests.** No new specs needed — motion is declarative and visual;
regression testing covered by the existing render tests.

## v4.4.9 — Hotfix + Welcome Polish

Two-part patch in response to a user report from a live :5173 Vite session.

**Hotfix (critical) — Log tab crash**
- `client/src/modules/Log.jsx`: the v4.4.6 #382 scroll-to-top anchor introduced
  a temporal dead zone crash. The `useEffect` that tracks "new events since
  scroll" depended on `entries` in its dep array, but `entries` was declared
  *after* the hook. Every render threw `ReferenceError: Cannot access 'entries'
  before initialization` — the Log module failed to mount entirely on :5173.
  Fix: moved the `entries` / `sessions` / `loadingA` / `loadingS` declarations
  above the scroll-anchor hooks that consume them.

**Welcome screen upgrade**
- Nautical boot animation redesign. Layered composite (no new deps, pure CSS):
  - Faint chart-grid radial backdrop (amber + blue).
  - Three staggered **sonar pulse rings** expanding outward (`sonar-pulse`
    keyframe, 0.7s stagger).
  - Rotating **radar sweep** conic-gradient wedge (`radar-sweep` keyframe, 4s
    per revolution) with radial mask so only a ~45° arc is visible.
  - Static bearing ring (N/E/S/W inner border).
  - Centerpiece compass rose ◈ continues to spin (existing `animate-compass`).
  - **NEXUS** wordmark reveals letter-by-letter with staggered delays
    (`letter-reveal` keyframe).
- Version text now pulled from `/api/init` response (was hardcoded "v4.2" and
  four releases behind).
- Tool count + module count moved to a single `TOOL_COUNT` constant at the
  top of the component.

**Drift guard**
- `tests/versionDrift.test.ts` gains an entry matching `TOOL_COUNT = N` in
  `WelcomeScreen.jsx`. The welcome screen won't silently drift again as the
  MCP tools[] array grows.

**New animations** (`client/src/index.css`):
- `@keyframes radar-sweep` · `@keyframes sonar-pulse` · `@keyframes needle-settle` · `@keyframes letter-reveal`

227 → **228 tests** (+1 drift guard).

## v4.4.8 — Contradiction Scan Engine

Closes **#307** — the last Tier 2 BIG item. The Conflicts tab transitions from
a reactive logbook (only shows contradictions the user manually flagged) to a
proactive signal surface (Overseer scans decision pairs and proposes candidates
for review). The entire UI-audit backlog is now resolved.

**Two-stage scan pipeline**
1. **Embedding shortlist** — cosine similarity over decision text + context
   prunes ~O(n²) pairs to a manageable shortlist (default 20). Filters out
   pairs already linked (any rel), already-suggested pairs, already-dismissed
   pairs (sticky), and cross-project pairs. Lifecycle-divergent pairs
   (one active, one deprecated in the same project) get a +0.08 similarity
   boost since lifecycle tension is a primary contradiction signal.
2. **Overseer classification** — the shortlist is packaged into a single
   structured prompt with a tight JSON output schema. The Overseer decides
   `is_contradiction` per pair + confidence + one-sentence reason. Only
   pairs with `is_contradiction=true` AND confidence ≥ 0.55 are stored.

**Data model**
- New `SuggestedContradiction` type in `server/types.ts` — `{from_id, to_id,
  similarity, confidence, reason, status: suggested|dismissed|accepted,
  scan_id, model, timestamps}`.
- `NexusData._suggestedContradictions[]` — append-only log, preserved across
  scans for dedup + audit.
- Four store methods: `getSuggestedContradictions`, `getActiveSuggestedContradictions`,
  `getSuggestionPairKeys` (sorted-tuple dedup set), `addSuggestedContradiction`,
  `updateSuggestedContradiction`.

**Routes**
- `POST /overseer/scan-contradictions` — async scan; returns taskId.
  Accepts `max_pairs`, `similarity_threshold`, `confidence_threshold`,
  `project_scope`. Polls via `/overseer/ask/result/:taskId` (reuses existing
  async task map).
- `GET /ledger/suggested-contradictions` — lists active suggestions hydrated
  with both decision records inline (no second round-trip needed).
- `POST /ledger/suggested-contradictions/:id/accept` — promotes to a real
  `rel='contradicts'` edge with a note citing scan_id + confidence + reason;
  marks suggestion `accepted`.
- `POST /ledger/suggested-contradictions/:id/dismiss` — marks `dismissed`
  so the pair won't re-surface in future scans.
- `GET /impact/contradictions` extended to include `suggestions` + `suggestedCount`.

**Client**
- New `ScanContradictionsPanel` component — fires the async scan, polls every
  3s, refreshes the Graph slice on completion so hydrated suggestions appear
  inline.
- New `SuggestedContradictionCard` component — displays both decisions with
  lifecycle tags, Overseer's reason in quotes, confidence + similarity badges,
  Accept/Dismiss buttons.
- Section renders in `ContradictionsView` above the historical counter row
  whenever active suggestions exist.

**Tests** (`tests/contradictionScan.test.ts`)
- 15 new unit tests: `shortlistContradictionPairs` (skip already-linked, skip
  past suggestions, skip cross-project, threshold filter, highly-similar
  same-project pair inclusion, lifecycle-divergent boost, sort + cap); `buildContradictionPrompt`
  (field rendering, lifecycle-tag suppression); `parseContradictionResponse`
  (empty input, clean JSON, code-fence stripping, prose-prefix tolerance,
  malformed input handling, missing field handling).

212 → **227 tests** (+15 contradiction-scan specs). 26 MCP tools.

## v4.4.7 — Overseer Refine Mode

First of the two Tier 2 BIG items shipped. Closes `#343`: the Overseer
conversation now has two explicit modes instead of forcing the full
SITUATION/PRIORITIES/RISKS/RECOMMENDATIONS scaffolding on every question.

**Two modes**
- **Strategic** (default for first question) — unchanged behavior. Full system
  prompt, full workspace dump, 4-section structured output.
- **Refine** (auto-selected for follow-ups) — slim conversational prompt,
  prior turns included as `[You] / [Overseer]` transcript, reduced context
  dump (just active-task-by-project + current fuel). No forced section
  headers. Target response length ~150 words.

**Auto-switching**
- First question in an empty thread: Strategic.
- Every question after: Refine (unless the user manually picks Strategic).
- Manual override shows an `auto` pill that returns to automatic selection.

**Server (`server/routes/overseer.ts`)**
- `POST /overseer/ask` and `POST /overseer/ask/start` now accept
  `mode: 'analysis' | 'refine'` and `history: Array<{role, text}>`.
- New `OVERSEER_REFINE_SYSTEM` prompt and `formatHistory()` helper (caps at
  last 8 turns, truncates each turn at 2000 chars to keep prompts lean).
- New `buildSlimContext()` function — drops per-project task dump, session
  history, and decisions list. Projects bucketed by open-task count, sorted
  desc. Falls back to `(no state)` when empty.

**Client (`client/src/modules/Overseer.jsx`)**
- Mode toggle Chip pair above the ask input, with placeholder text adapting
  to the active mode.
- Chat history entries now carry a `mode` field; a small `strategic` /
  `refine` badge renders beside each turn's role label. Absent on historic
  entries loaded from the advice journal (pre-v4.4.7 data).
- `askOverseer()` forwards `mode` + last 8 turns as history when refining.

**Tests** (`tests/overseerRefine.test.ts`)
- 11 new unit tests covering `formatHistory` (empty/short/long history, role
  labels, turn-count cap at 8, per-turn text cap at 2000 chars, unknown-role
  passthrough) and `buildSlimContext` (empty state, done-task filtering,
  project bucketing + sort, default-to-Nexus fallback, fuel line, length
  sanity).

201 → **212 tests** (+11 refine specs). 26 MCP tools.

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
