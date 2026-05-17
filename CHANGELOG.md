# Changelog

Nexus — The Cartographer. Local-first metabrain plugin for Claude Code.

The v4.3.5 → v4.5.3 arc kicked off after the initial "Audit Shakedown" (v4.3.5)
released in mid-April 2026. What follows covers 17 versioned releases plus one
major UI audit, one big `Memory Bridge` import feature, the ambient-telemetry
hook layer (v4.4.0 alpha/beta/final), nine post-v4.4.0 patch releases closing
the **entire** UI-audit backlog, and the v4.5.0 theme-wide "Animated
Instruments" microanimation pass.

## v4.9.1 — v4.9.0 backlog closeout

Closes all 10 items that v4.9.0 deferred. Three new client lib helpers
(`lib/time.js`, `components/ProgressBar.jsx`, `components/EmptyState.jsx`,
`components/ConfirmDialog.jsx`), a new server lib (`lib/path.ts`'s sibling
`lib/constants.ts` from v4.9.0 gets a companion), 10 new CLI verbs that close
the MCP/CLI asymmetry the v4.8.2 audit flagged, two store-side hot-path wins
(`withBatchedFlush` coalescing + per-decision word-set cache), and three test
files (1 new, 2 extended) lifting integration coverage from 13/38 → 16/38
routes and bundle smoke-test from 13/34 → 30/34 tools.

**477 tests (+22 net) · 34 MCP tools · no migrations · no breaking changes.**
The audit-driven backlog from v4.9.0 is empty.

### Performance (Q3 + Q4)

- **`_flush()` coalescing.** `recordDecision → _autoLinkDecision → addEdge × N`
  previously chained `1 + min(5, N)` full-store JSON serialisations per call.
  The auto-link cascade is now wrapped in `withBatchedFlush(() => …)` so only
  the outermost call writes to disk. New `_realFlushCount` counter exposed for
  test instrumentation; `tests/flushCoalescing.test.ts` pins the behaviour
  (3 specs).
- **`_significantWords` per-decision cache.** Keyword auto-link's inner loop
  re-tokenised every candidate decision on every `recordDecision`. A
  `_wordSetCache: Map<number, Set<string>>` survives across calls; invalidated
  by `updateDecision` when the text or context changes.

### Standalone awareness (Q5)

`nexus_brief` now prints a one-line footer when running in standalone (MCPB)
mode, reminding the operator that the 5-min risk poller, 6-h digest, 24-h
contradiction auto-scan, and GPU/file watchers are dashboard-only. Pre-fix
standalone-only users saw a "healthy" brief while their auto-scans were
silently off (visible in the v4.9.0 diagnosis session as "missing automatic
suggestions"). Cross-process mutex deferred — the visibility fix is cheaper
and lower-risk.

### CLI surface symmetry (Q6)

Ten new verbs close the asymmetry against the MCP tool surface that v4.8.2
introduced:

- **Tasks:** `update-task <id> [-s status] [-p priority] [-t title] [-d desc]`
  and `delete-task <id>` (mirrors `nexus_update_task` + `nexus_delete_task`).
- **Handover:** new `cli/commands/handover.js` with `read-handover <project>`,
  `update-handover <project> [content | -f file] [--by label]`, and
  `list-handovers` — the v4.6.0 Continuous Handover protocol is finally
  reachable from the shell.
- **Sessions:** `list-sessions [-p project] [-n limit]`.
- **Ledger:** `update-decision <id> [-d text] [-c context] [-p project]
  [-t tags] [--lifecycle X] [--confidence N]`.
- **Misc:** `fleet` (cross-project priority matrix), `import-cc-memories`
  (dry-run by default; `--commit` to write), `propose-edges <id>`,
  `bridge-session [project] [--commit] [--thought "…"] [--context "…"]`.

`tests/cliCommands.test.js` extended +4 specs (handover group + extended
counts on tasks/sessions/ledger groups).

### Test coverage (Q8 + Q9)

- **`tests/routesDeferred.test.ts` (NEW, 15 specs)** covers
  `routes/handover.ts` (the Captain's flagship v4.6.0 protocol, previously
  zero tests), `routes/usage.ts` (every fuel call), and
  `routes/estimator.ts`. 13/38 → 16/38 routes with integration specs.
  `plan.ts` and `autoSummary.ts` deferred — they require mocking `detectAI()`.
- **`mcpb/smoke-test-bundle.mjs` expanded 13 → 30 tools.** New coverage:
  `nexus_get_plan`, `nexus_read_handover`, `nexus_list_tasks`, `nexus_list_decisions`,
  `nexus_list_thoughts`, `nexus_list_sessions`, `nexus_fleet_overview`,
  `nexus_get_blast_radius`, `nexus_update_task` (round-trip), `nexus_push_thought` +
  `nexus_pop_thought` (self-cleaning pair), `nexus_record_decision` +
  `nexus_update_decision` + `nexus_link_decisions` (smoke-tagged chain),
  `nexus_log_session`, `nexus_update_handover`, `nexus_import_cc_memories`
  (dry-run). Cleanup extended to scrub ledger / graph_edges / sessions /
  thoughts / `_handovers` by deterministic markers ("safe to delete" suffix
  + `project='smoke-test'`). Only the four AI / side-effect tools remain
  skipped (`ask_overseer`, `ask_overseer_start`, `get_overseer_result`,
  `bridge_session`).

### Polish (E_*)

- **`lib/time.js` (NEW).** `relativeAge(iso, opts)` + `elapsedDuration(iso)`
  replace six near-identical implementations across Command, Fleet,
  Handover, ProjectHealth, DigestWidget, and the older `lib/todayView.js`.
  `formatTimeAgo` re-exported for backwards-compat with the existing
  `tests/todayView.test.js`.
- **`components/ProgressBar.jsx` + `components/EmptyState.jsx` (NEW).**
  Replace the Fuel `Bar`, Pulse `GaugeBar`, and Command `EmptyState` private
  helpers plus 5+ inline copies. `colorClass` accepts a function for
  dynamic-threshold fills so Fuel's burn-rate coloring still works through
  a thin wrapper.
- **`deleteSession()` + accessor pass.** Five `store.data.*` reads/writes
  in `routes/{sessions,plan,init,autoSummary,advice}.ts` routed through
  typed accessors. `sessions.ts` DELETE now calls `store.deleteSession(id)`
  instead of splicing the array in place.
- **`<ConfirmDialog>` (NEW).** Replaces `window.confirm` / `window.prompt`
  in four spots (Fleet commit, Overseer InlineCommitRow commit, Handover
  delete-card, ContradictionsView "Keep both"). Real modal with focus
  trap, ESC handling, optional text input for prompt-style use, and
  `danger` styling for destructive ops.

### Patterns codified

- **Coalesce with a counter, not a timer.** Counter-based batched flush
  preserves synchronous "everything on disk when the entry-point returns"
  semantics without crash-window exposure from deferred writes.
- **Test against observable disk state, not call-site spies.** A function
  that early-returns under a flag still appears "called" to `vi.spyOn`;
  the counter on the actual write block is the honest signal.
- **Surface the silent.** Standalone mode silently disabled four pollers;
  one line in the brief output is cheaper insurance than building the
  cross-process mutex that would let them run safely.
- **Smoke tests deserve cleanup.** Extended `cleanupSmokeTraces` now scrubs
  ledger / graph_edges / sessions / thoughts / `_handovers` so the bundle
  smoke test can exercise write tools without polluting the user's store.

### Files touched

24 modified + 4 new (3 client components + 1 CLI commands file + 1 server
lib + 2 server type fields). See `git diff --stat v4.9.0..HEAD` for the
full surface.

## v4.9.0 — Hook & memory hardening

Audit-driven release. Three parallel agents (server, client, CLI/packaging) and
a full read of `store.ts`, `dashboard.ts`, `storeMigrations.ts`, `types.ts`,
and the MCP entrypoint surfaced 36 findings; this release lands **26 of them**
(10 P0 bugs, 8 of 14 P1 quality items, 8 of 12 P2 polish bundles). The
remaining 10 are well-scoped and queued for v4.9.1.

**455 tests (+26 net) · 34 MCP tools · no migrations · no breaking changes.**
Three new test files (`tests/hooks.test.ts`, `tests/storeFlush.test.ts`,
`tests/taskCompletionAttribution.test.ts`) plus a +7-spec extension of
`versionDrift.test.ts`. ~600 LOC of dead code deleted (`server/routes/{ai,
notify,plans,terminal}.ts`).

### P0 bug fixes (10 / 10)

| # | What | Where |
|---|---|---|
| **B1** | Thought schema bug: hooks wrote `created_at`, schema is `pushed_at` — handoff thoughts NaN-sorted to the bottom of the LIFO and never resurfaced | `cli/hooks/session-stop.js` + plugin copy |
| **B2** | Plugin hook drift — `plugin/server/hooks/` resynced byte-identical to `cli/hooks/`; prompt-submit no longer reverts to pre-v4.3 noise, session-start regains v4.7.6 Chapter Narrator | `plugin/server/hooks/{*.js}` |
| **B3** | Kanban drop ReferenceError on every drag — `setTasks` → `tasksSlice.patch` | `client/src/modules/Command.jsx:280` |
| **B4** | Rules-of-Hooks violation in `AnalysisBlock` crashed first Overseer chat reply — `useState` hoisted above early returns | `client/src/modules/Overseer.jsx:267-299` |
| **B5** | StrategicView gap→task threw `fetchAll is not defined` — `onRefresh` prop now destructured | `client/src/modules/Command.jsx` |
| **B6** | Duplicate embedding cache: route + lib both wrote `EMBED_CACHE_PATH` with divergent keys. Routes module dropped its fork; `lib/embeddings.ts` now in-memory-evicts on every `set` | `server/routes/embeddings.ts`, `server/lib/embeddings.ts` |
| **B7** | `_flush()` mtime race — `_lastFlushAt` stamped BEFORE the rename so a failed flush no longer makes the watcher misclassify our own write as external | `server/db/store.ts:198-249` |
| **B8** | `.claude-plugin/marketplace.json` was advertising v4.2.0 to `/plugin marketplace add` users; both `metadata.version` and `plugins[].version` now drift-guarded | `tests/versionDrift.test.ts` + marketplace bump |
| **B9** | `recordTaskCompletion` silently dropped attribution when a task closed before today's session was logged. New `_pendingTaskCompletions` buffer drains in `createSession()` on matching project + day | `server/db/store.ts:579-630` |
| **B10** | `/suggested-contradictions/:id/accept` and `/dismiss` now broadcast WS so the Conflicts tab updates without manual refresh | `server/routes/ledger.ts:306-336` |

### P1 quality (8 / 14 shipped)

- **Q1** Wired webhook routes back into `dashboard.ts` (unmounted since the
  v4.7.6 MCPB split) and deleted four truly dead route files (`ai.ts`,
  `notify.ts`, `plans.ts`, `terminal.ts`) — ~600 LOC removed.
- **Q2** Consolidated three `detectAI()` implementations through
  `lib/aiEndpoints.ts`. Added Anthropic to the canonical endpoint list +
  `detectAI(endpoints)` overload. `autoSummary.ts` and `plan.ts` drop their
  local forks; the Ollama-only-user gap in autoSummary is closed.
- **Q7** `NexusProvider` context values (`coreVal` / `fuelVal` / `fleetVal`)
  and per-slice handles now memoised. Kills the wide re-render cascade where
  every WS event re-rendered every module.
- **Q10** Drift guards for the three unguarded CLI tool-count strings
  (`cli/nexus.js:468`, `:495`, `:1250`) and a new per-tool assertion: every
  manifest tool must appear in `plugin/README.md` AND `mcpb/README.md`. Plugin
  README Write section gains the missing `nexus_update_task`.
- **Q11** `DigestWidget` WS refresh debounced 1 s — bursts of 4 events no
  longer fire 4 sequential `/api/digest` fetches.
- **Q12** Throttled error logging in `gpuPoller` + `overseerPoller`
  (warning at most every 5 min so sustained outages surface instead of
  silently dropping the 60 s GPU sample / 5 min risk scan).
- **Q13** Path-traversal guards extracted: `safeProject()` lives in
  `server/lib/path.ts` and is applied in `focus.ts` + `remediate.ts`
  (previously only `github.ts` had it).
- **Q14** Stable list keys across Overseer chat (the chat input cursor jump
  fix), `Log` decisions/blockers, and `Fuel` per-task rows.

**Deferred to v4.9.1** (well-scoped): Q3 `_flush` coalescing, Q4
`_significantWords` per-decision caching, Q5 standalone-mode poller story,
Q6 CLI verbs for the 10 MCP-only operations, Q8 route tests for
handover/usage/estimator/plan/autoSummary, Q9 extending the MCPB smoke test
from 13/34 to 28/34 tool coverage.

### P2 polish (8 / 12 shipped)

- **E_const** Shared `EDGE_RELS`, `EDGE_REL_SET`, `GENERIC_TAGS`, `isGenericTag`
  in new `server/lib/constants.ts` — three duplicate literals collapsed.
- **E_type** `_autolinkConfig` typed on `NexusData` — drops two `as any` casts
  in `store.ts`.
- **E_store** Three single-line store fixes: heatmap activity cap honest
  (2000 → 500 to match `store.ts:413`), `getSelfCritique` ceiling 24 h → 30 d
  so multi-day tasks surface, `_significantWords` regex Unicode-aware
  (`\p{L}\p{N}`) so non-ASCII decisions auto-link.
- **E_terminal** Terminal `onclose` stale-closure fixed via `outputLenRef` (no
  more "Terminal not available" spam on reconnect).
- **E_winregex** `risk.fix.cmd` regex accepts both Windows and POSIX path
  separators so risk-fix actions don't lose the `project` arg on Win11.
- **E_skillname** Added required `name:` frontmatter (per 2026 SKILL.md
  spec) to 9 skills + 1 agent.
- **E_searchparallel** `smartSearch.ts` uses `Promise.all` instead of
  sequential `await` — ~30× speed-up on cold cache for ~300 corpus items.
- **E_locale** Replaced 6 hardcoded `cs-CZ` literals (Overseer × 4, Command,
  ClockWidget) with `formatLocaleTime` / `formatLocaleDate` /
  `formatLocaleDateTime`. New `formatLocaleDateTime` helper in `lib/locale.js`.

**Deferred to v4.9.1**: `E_time` `lib/time.js` consolidating 6 `relativeAge`
duplicates, `E_components` `<ProgressBar>` + `<EmptyState>` extraction,
`E_accessors` `deleteSession()` etc. (5 direct `store.data.*` mutations),
`E_confirm` `<ConfirmDialog>` replacing `window.prompt`/`window.confirm`.

### New test files

- `tests/hooks.test.ts` — 11 specs covering canonical Thought shape (4 ×
  CLI + 4 × plugin = 8) and CLI↔plugin hook byte-parity (3).
- `tests/storeFlush.test.ts` — 4 specs covering `_lastFlushAt` timing and
  the mtime grace window.
- `tests/taskCompletionAttribution.test.ts` — 4 specs covering direct
  attribution, deferred buffer drain, cross-project isolation, and
  deduplication.

### Patterns codified

- **Silent metabrain regressions deserve type-guarded fixtures**
  (`tests/hooks.test.ts` — schema mismatch couldn't have shipped if a 5-line
  fixture spec existed).
- **Buffer when ordering is uncertain**: `_pendingTaskCompletions` drains on
  the natural pairing event (`createSession`) instead of losing data when
  the ordering invariant is wrong.
- **Cross-process race fences need both pre- and post- markers**
  (`_lastFlushAt` stamped twice around the rename).
- **Single-cache rule**: when two modules write the same file with different
  keys, the cache is dead in the worst possible way — silently halved.
- **Drift guards must scan version literals AND per-tool listings**: tool
  count alone doesn't catch a missing entry in a 34-tool list.

### Files touched

48 modified, 4 deleted, 4 added. See `git diff --stat 5655d3a..HEAD` for the
full surface.

## v4.8.2 — MCP management coverage

Post-v4.8.1 patch closing the standing MCP-tool asymmetry. The Captain's
audit observation: the task-management surface had `create_task` +
`complete_task` (only sets status=done) + `delete_task` but **no general
update** (can't move backlog → in_progress → review) and **no list** (couldn't
read all project tasks without `nexus_brief`'s cap or `nexus_search`'s
semantic mode). Same gap applied to decisions, thoughts, and sessions.

**Five new MCP tools (29 → 34).** Pure additions; no deprecations; no
behavior changes elsewhere.

**429 tests (+5 for the new endpoints/filters) · 34 MCP tools · no
migrations · no breaking changes.**

### The five new tools

| Tool | Bucket | Closes |
|---|---|---|
| `nexus_list_tasks` | read | "show me all in-progress tasks in Nexus" / "every backlog item across projects" / "high-priority items only" — the core gap |
| `nexus_update_task` | write | move a task through statuses (backlog → in_progress → review → done), change priority, reassign project, fix title/description |
| `nexus_list_decisions` | read | "all decisions in project X" / "decisions tagged 'audit'" |
| `nexus_list_thoughts` | read | inspect the Thought Stack without the pop side effect |
| `nexus_list_sessions` | read | "what did I do this week" / "last few sessions on project X" |

### Tool buckets after v4.8.2

| Bucket | Count | Tools |
|---|---|---|
| Read | 14 | brief, get_plan, check_guard, search, get_critique, predict_gaps, get_blast_radius, ask_overseer, version, read_handover, **list_tasks**, **list_decisions**, **list_thoughts**, **list_sessions** |
| Write | 14 | create_task, **update_task**, complete_task, delete_task, log_activity, log_session, log_usage, record_decision, update_decision, link_decisions, push_thought, pop_thought, import_cc_memories, update_handover |
| Async AI | 3 | ask_overseer_start, get_overseer_result, propose_edges |
| Composite | 3 | bridge_session, fleet_overview, calendar_runway |
| **Total** | **34** | |

### Server-side support

`GET /api/tasks` now accepts query-param filters (`project`, `status`,
`priority`, `limit`). Unfiltered calls still return everything — the
dashboard contract is preserved. The other endpoints (`/ledger`,
`/thoughts`, `/sessions`) already had filter support, so the four read
tools just pass arguments through.

### Audit context (what the Captain caught)

The MCP-tool audit walked every tool by bucket and checked coverage:

- **Tasks** ❌ — only create / complete (→done) / delete. **No list, no
  move-status.** Most-called tool family (`task_created` 235× in the
  activity log) but the management story was incomplete.
- **Decisions** — `record` / `update_decision` / `link_decisions` covered
  CUD, but listing was only via `brief` (top 5) or `search` (semantic).
- **Thoughts** — push / pop with the LIFO contract was correct, but
  there was no way to peek at the stack without the pop side effect.
- **Sessions** — `log_session` covered create, no way to list.
- **Probably rarely called** (kept, no changes): `calendar_runway` (needs
  external calendar MCP), `ask_overseer` sync variant (10s timeout —
  async path is preferred).
- **No deprecations.** Every existing tool has a clear purpose.

### Implementation notes

- `nexus_update_task` rejects no-op calls (at least one mutating field
  required). Prevents silent success when the caller forgets to specify
  what to update.
- `nexus_list_thoughts` defaults to `status=active` (the live stack);
  `status=all` returns resolved + abandoned too. Matches the
  `/api/thoughts` endpoint contract.
- `nexus_list_tasks` returns a Cartographer-style formatted text output
  (`!! #id [status] [project] title`) — same shape as the brief and the
  CLI `nexus tasks` command, so callers get a recognizable rendering.
- All four list tools include a "no matches" friendly path so callers
  don't get an empty string.

### Files touched

- `server/mcp/tools/read.ts` — 4 new tool defs + 4 new handlers
  (list_tasks / list_decisions / list_thoughts / list_sessions)
- `server/mcp/tools/write.ts` — 1 new tool def + 1 new handler
  (update_task), inserted between complete_task and delete_task
- `server/routes/tasks.ts` — query-param filters on GET /
- `server/lib/version.ts` — `TOOL_COUNT_EXPECTED` 29 → 34
- `mcpb/manifest.json` — 5 new tool entries
- `tests/mcpToolsRegistry.test.ts` — category sizes 10/13/3/3 → 14/14/3/3
- `tests/routes.test.ts` — 5 new specs for filter params + status
  transitions
- README.md / CONCEPT.md / mcpb/README.md / plugin/README.md /
  marketplace.json / plugin/.claude-plugin/plugin.json /
  cli/nexus.js / client/src/components/WelcomeScreen.jsx — count refs
  29 → 34
- `package.json`, `cli/package.json`, `mcpb/manifest.json`,
  `plugin/.claude-plugin/plugin.json` — version 4.8.1 → 4.8.2
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### Patterns codified

- **Asymmetric CRUD is a smell.** When you have create + the special-case
  done-transition + delete but no general update, you're betting that no
  one will need intermediate transitions. The bet failed.
- **List tools deserve filter args at the API level.** Filtering inside
  the MCP tool over a full-board fetch works for small stores but
  doesn't scale. `/api/tasks` query params now push the filter down to
  the store layer.
- **Reading without side effects matters.** `pop_thought` is great when
  you want to commit to consuming the top; `list_thoughts` is for when
  you want to look first.

## v4.8.1 — Audit-driven type drift cleanup

Post-release patch following the v4.8.0 audit pass. The audit walked five
dimensions: Claude Code surface coverage, code-quality markers, documentation
drift, TypeScript drift, and stale modules. Five real findings; all addressed.

**No code-behavior changes** — every fix is type-level or version-level.
**424 tests · 29 MCP tools · no migrations.**

### Audit findings

| Dimension | Finding |
|---|---|
| **Surface coverage** | Plugin has 9 skills + 3 lifecycle hooks + MCPB stdio. ✓ Complete. |
| **Code-quality markers** | 0 TODO / FIXME / HACK / XXX in source. ✓ Clean. |
| **Documentation drift** | Test count (423) and tool count (29) in sync across README / CONCEPT / CHANGELOG / `version.ts`. ✓ Clean. |
| **TypeScript drift** | **49 errors** — 39 fixable, 10 pre-existing AIConnection family. **Fixed.** |
| **Plugin manifest drift** | `plugin/.claude-plugin/plugin.json` stuck at `4.1.0` since release. **Fixed.** |

### TypeScript drift — 49 → 10 errors (39 fixed)

Most errors clustered in code introduced by the v4.7.6 mcp-split (`format.ts`)
and a handful of pre-existing-but-uncovered shapes. Categorized:

| File | Before | Cause | Fix |
|---|---|---|---|
| `mcp/lib/format.ts` | 17 | `formatPlan` / `formatGuard` typed as `Record<string, unknown>` — every property access tripped tsc | New explicit `PlanData` + `GuardData` interfaces; `BriefData` tightened from `Record & {...}` to plain interface |
| `mcp/tools/read.ts` | 5 | Cascade from `format.ts`: `as BriefData` cast failed; `fuel?.estimated` accessed on opaque dispatcher result; `TaskLite` missing `id` | Local `FuelLite` narrowing + explicit `briefData: BriefData = {...}` + `id` added to `TaskLite` |
| `routes/estimator.ts` | 4 | `learnedBurn` / `sessionBurn` / `estimate.estimated` possibly undefined | `?? 0` coalesce + explicit narrowing before subtraction |
| `routes/smartSearch.ts` | 3 | `CorpusItem` requires `project` but task/activity/scratchpad inserts omitted it | Added `project: t.project ?? ''` to all three call sites |
| `mcp/localApi.ts` | 3 | `MemoryEntryLike` index-signature mismatch + `RiskItem` missing `category` field | Removed unnecessary type annotation; added `category: 'fuel'` to risk pushes |
| `routes/predict.ts` | 2 | Return-type `stats: Record<string, number>` didn't match nested actual shape | New `DetectGapsStats` interface |
| `dashboard.ts` | 2 | `createSmartSearchRoutes` signature changed to require `embedCache`; risk-scan response typed as `{level}` not `RiskItem[]` | Default `embedCache = {}` for backward-compat callers; tightened response type to `RiskItem[]` |
| `routes/focus.ts` | 1 | `commits` not in declared type but emitted in object | Type widened to match construction shape |
| `routes/webhooks.ts` | 1 | `hook.format` is `string \| undefined` passed where `string` required | `?? 'json'` coalesce |
| `watchers/contradictionPoller.ts` | 1 | `'contradiction'` literal not in `ScheduledScan.type` union | Extended union to `'risk' \| 'digest' \| 'contradiction'` |
| `routes/overseer.ts` | 9 | Pre-existing `AIConnection` vs `AIConfig` drift (handover keeps marked as untouched) | **Skipped** — separate dedicated commit when AI-handling refactor lands |
| `routes/autoSummary.ts` | 1 | Same AIConnection family | **Skipped** |

### Plugin manifest drift

`plugin/.claude-plugin/plugin.json` had been silently stuck at `4.1.0` since
the v4.1 plugin first shipped. None of the existing drift tests scanned it,
so the gap accumulated through every v4.2 → v4.8.0 release. Now:

- Manifest bumped 4.1.0 → 4.8.1 (matches the rest of the surfaces).
- `tests/versionDrift.test.ts` extended to scan it. Same kind of drift will
  fail CI on the next release, so it can't accumulate again.

### Type-system patterns codified

- **Formatters take typed inputs, not `Record<string, unknown>`.** When a
  pure-presentation function receives composed-from-many-endpoints data,
  give it a real interface even if some fields are optional. `Record &
  {...}` reads as "permissive" but actually fails on every typed access.
- **Cascade fixes upstream.** `read.ts` errors weren't independent — they
  surfaced because `format.ts` types were loose. Fixing the lib first made
  the consumer fixes obvious.
- **Drift tests evolve with surfaces.** Plugin manifest is a versioned
  surface; it belongs in `versionDrift.test.ts`. Add new versioned surfaces
  there as they appear (mcpb, cli, plugin all done; future ones to follow).

### Files touched

- `server/mcp/lib/format.ts` — `BriefData` tightened, new `PlanData` /
  `GuardData` interfaces, nullable `filename` fallback in formatBrief
- `server/mcp/tools/read.ts` — typed `briefData`, `FuelLite` narrowing,
  `TaskLite.id`, `formatPlan` / `formatGuard` calls use new types
- `server/routes/estimator.ts` — nullish guards on learned/session burn
- `server/routes/smartSearch.ts` — `project` field on all `CorpusItem`
  insertions; `embedCache` parameter defaults to `{}`
- `server/mcp/localApi.ts` — `RiskItem.category` field; removed implicit
  `MemoryEntryLike` annotation
- `server/routes/predict.ts` — `DetectGapsStats` interface
- `server/dashboard.ts` — `RiskItem` import + typed risk-scan response
- `server/routes/focus.ts` — `git` shape widened
- `server/routes/webhooks.ts` — `hook.format ?? 'json'` coalesce
- `server/types.ts` — `ScheduledScan.type` union extended
- `plugin/.claude-plugin/plugin.json` — version 4.1.0 → 4.8.1
- `tests/versionDrift.test.ts` — new spec scanning plugin manifest
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version
  bump 4.8.0 → 4.8.1
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### Pre-existing drift left untouched

10 errors remain — all in the `AIConnection` vs `AIConfig` family
(`server/routes/overseer.ts` 9 + `server/routes/autoSummary.ts` 1). The
handover has marked these as untouched since v4.5.x. Fix belongs in a
dedicated AI-handling refactor, not this audit-driven patch.

### What's next

The v4.7.x → v4.8.0 → v4.8.1 arc is closed. Both Tier-3 and Tier-4
deferred backlogs are at zero, structural cleanup is done, type drift is
down to one well-understood family. Forward direction is integration
work (Cowork plugin packaging, Dispatch webhook listener, Memory Stores
bridge — see v4.8.0 brief) rather than internal cleanup.

## v4.8.0 — Structural cleanup

The v4.7.x arc shipped nine point releases over two days. v4.8.0 collects
what's left of the structural debt and closes a handful of long-pending
items. **Tier-3 and Tier-4 deferred backlogs are both at zero**, the
initial JS bundle is **55% smaller**, route boundaries now validate input
at runtime, and the last sizable monolith dropped 23%.

**423 tests (+7 new for Zod + autolink-config) · 29 MCP tools · no
migrations · no breaking changes.**

### Vite bundle code-split

Pre-split, the initial bundle was **517.79kB** because every dashboard
module + modal shipped at startup even though the user only views one at
a time. Wrapping each module + the rarely-opened modals in `React.lazy +
Suspense` drops the initial chunk to **232.11kB (−55%)**. Each module is
its own chunk, loaded on demand:

| Chunk | Size | When |
|---|---|---|
| `index` (initial) | 232.11kB | always |
| `Graph` | 94.27kB | when Graph tab opens |
| `Command` | 41.45kB | when Command tab opens |
| `Log` | 29.95kB | when Log tab opens |
| `Overseer` | 29.74kB | when Overseer tab opens |
| `Fuel` | 25.99kB | when Fuel tab opens |
| `Pulse` | 23.72kB | when Dashboard tab opens |
| `Fleet` | 15.41kB | when Fleet tab opens |
| `Handover` | 7.57kB | when Handover tab opens |
| `SearchModal` / `ThoughtStackModal` / `ShortcutHelpModal` | 3-6kB each | when opened |

Suspense fallback uses the Cartographer "◈ Scanning..." style so the
swap reads as "module thinking" rather than "broken page." `App.jsx` is
the only file that needed touching.

### Auto-link similarity threshold — server hookup (#280)

The slider has existed since v4.5.10 but only persisted in localStorage —
the server's `_semanticAutoLink` had its own hardcoded `0.55` threshold
and never read the UI value. Closed the gap:

- New `data._autolinkConfig: { semanticThreshold: number }` persisted in
  `~/.nexus/nexus.json`. Defaults to 0.55 (the prior hardcoded value);
  range clamped 0.4..0.95 to match the UI slider.
- `NexusStore.getAutolinkConfig()` / `setAutolinkConfig()` accessors.
- `_semanticAutoLink` reads from store: `findSimilar(query, candidates,
  5, semanticThreshold)`.
- New endpoints: `GET /api/ledger/autolink-config` (returns current
  threshold), `PATCH /api/ledger/autolink-config` (validates + persists,
  Zod-checked).
- Client UI in Graph.jsx fetches initial value from server on mount,
  PATCHes on slider change. `localStorage` kept as offline mirror so
  refresh-before-fetch shows the right value. Default value bumped 0.7 →
  0.55 to match server.
- "syncing…" hint while the PATCH is in flight.

### Zod validation at route boundaries (#219)

Deferred from the v4.3.6 audit — Express routes did ad-hoc input
validation (`if (!body.title?.trim())`) which left every mutation to
re-derive shape rules. v4.8.0 introduces:

- New `server/lib/validate.ts` — `validate()` returns a discriminated
  union; `validateBody()` writes the 400 + returns null on failure so
  routes can `if (!body) return;` and continue with typed data.
- New `server/lib/validators.ts` — Zod schemas for the most-used
  mutation bodies: `NewTaskSchema`, `UpdateTaskSchema`,
  `NewDecisionSchema`, `NewSessionSchema`, `NewThoughtSchema`,
  `NewUsageSchema`, `NewActivitySchema`, `AutolinkConfigSchema`.
- Routes converted: `POST /api/tasks`, `PATCH /api/tasks/:id`,
  `POST /api/ledger`, `POST /api/sessions`, `POST /api/thoughts`,
  `POST /api/activity`, `POST /api/usage`, `PATCH /api/ledger/autolink-config`.
- Manual NaN guards in `POST /api/usage` removed — Zod's range checks
  cover them, and the route is shorter for it.
- Validation tests added: rejects invalid status enum, out-of-range
  priority, non-integer priority, out-of-range threshold, non-numeric
  threshold.

### `server/db/store.ts` split (#217 follow-up)

Last sizable monolith from the #217 refactor arc. Extracted the
421-line migrations block (`v4.3.5-C1` through `v4.7.0-M1`, 8 applied
migrations) into `server/db/storeMigrations.ts` as a pure function:

```ts
// server/db/storeMigrations.ts
export function runMigrations(data: NexusData): number { ... }

// server/db/store.ts
private _runMigrations(): void {
  const changed = runMigrations(this.data);
  if (changed > 0) this._flush();
}
```

`store.ts`: **1752L → 1341L (−411L, −23%)**. The `_autoLinkDecision` /
`_semanticAutoLink` cluster could split further but its `this`
references would force a less natural seam — left for a future pass if
the file grows again.

### Cross-project task leak hygiene

The brief's standing note ("~15 tasks under `project='Nexus'` actually
belong elsewhere") finally addressed: 10 tasks reassigned via store
sweep to their real projects:

- `#75` `#76` `#80` `#81` `#82` → **Firewall-Godot** (Hex / ForceRegistry / Living Strata / Shadow Heptarchy / Eigenforge — game mechanics)
- `#135` `#138` → **shadowrun** (Sprint 2 Knockdown + Delayed action)
- `#182` `#183` `#186` → **direwolf** (Phase-3 PDF parser items)

Out-of-tree data sweep; backup at `~/.nexus/nexus.json.preMigrate`.

### #139 closed as obsolete

`Update BACKLOG.md` referenced a file that no longer exists in the repo
(removed during a prior cleanup commit). Closed.

### Files touched

- NEW `server/db/storeMigrations.ts` (~430L, extracted)
- NEW `server/lib/validate.ts` (~50L)
- NEW `server/lib/validators.ts` (~110L)
- `server/db/store.ts` — `_runMigrations` slimmed to delegating call;
  `getAutolinkConfig` / `setAutolinkConfig` + `_semanticAutoLink` reads
  from store. **−411 net lines.**
- `server/routes/{tasks,ledger,sessions,thoughts,activity,usage}.ts` —
  Zod validation + `validateBody()` calls; ledger gets the new
  GET/PATCH `/autolink-config` endpoints.
- `server/package.json` — `zod` dep added.
- `client/src/App.jsx` — every module + modal `lazy()`; `<Suspense>`
  boundaries; Cartographer-style fallback.
- `client/src/modules/Graph.jsx` — slider fetches from server on mount,
  PATCHes on change; "syncing…" hint; default 0.7 → 0.55.
- `tests/routes.test.ts` — +7 specs (Zod rejection, autolink-config
  GET/PATCH).
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version
  bump 4.7.9 → 4.8.0.
- `README.md`, `CONCEPT.md`, `CHANGELOG.md`, `ROADMAP.md` — copy +
  test count update (402 → 423).

### What's next

Both Tier-3 and Tier-4 deferred backlogs are at **zero**. The visible-polish
+ algorithm + structural waves are all done. From here:

1. **Fresh audit pass** — same playbook as v4.7.7/v4.7.8. Now that the
   bundle is 55% smaller and validation is at boundaries, the next round
   of "what bugs the eye" will surface different things.
2. **Optional further `store.ts` extraction** — auto-link + read/write
   helpers. Less natural seams; only worth it if the file grows again.
3. **Cross-project work** — fleet overview ranks 200+ tasks across
   Firewall-Godot, Shadowrun, noosphere, direwolf, etc. Several have
   priority 2 and 25+ days of staleness.

### Patterns codified

- **Lazy + Suspense for dashboard modules** — `App.jsx` becomes the
  Suspense boundary; every route-level component splits cleanly.
  Repeat for any heavy modal added later.
- **Zod at the boundary, types inferred from schemas** — once a route
  calls `validateBody(NewXSchema, req, res)`, the rest of the handler
  has a fully-typed `body`. New routes should follow the same pattern;
  `server/lib/validators.ts` is the registry.
- **Pure functions for store hot-paths** — `storeMigrations.ts` shows
  the seam: read-only on `data`, no `this`, return change-count, caller
  decides flush. Reusable for any future `_thing` method that doesn't
  need much class state.

## v4.7.9 — Tier-3 closeout (alternative centrality · log burst-grouping)

Closes the **last two** Tier-3 deferred items from the v4.5.10 sweep.
Centrality view gets Brandes' betweenness + power-iteration eigenvector
metrics alongside degree; Log activity gets burst-grouping for bursty
categories. With this, both Tier-3 and Tier-4 deferred backlogs are at
**zero**.

**416 tests (+14 new for the centrality algorithms) · 29 tools · no
migrations · no breaking changes.**

### Centrality: alternative ranking metrics (#301)

The Centrality tab has shown only **degree centrality** since v3.x —
"who has the most direct edges." That answers _hub-finding_, but two
other classic metrics answer different questions:

| Metric | Question it answers |
|---|---|
| **Degree** (default) | Who has the most direct connections? Hubs. |
| **Betweenness** | Who sits on the most shortest paths between others? Bridges — removing them cuts the graph. |
| **Eigenvector** | Who is connected to other influential nodes (recursively)? "Deep core" decisions. |

Both new metrics computed once per `/api/impact/centrality` request over
the full graph. Performance: ~400-decision graphs land well under 100ms
(Brandes is O(V·E); power iteration converges in ~30-50 iterations for
typical structure).

**Server (`server/routes/impact.ts`):**

- `computeBetweennessCentrality()` — Brandes' algorithm (Brandes 2001).
  Per-source BFS to compute σ_sv (number of shortest paths) and
  predecessor list, then dependency accumulation in reverse-BFS order.
  Divide by 2 at end since each undirected pair counts twice.
- `computeEigenvectorCentrality()` — power iteration with self-loop
  shift. Pure A·x oscillates on bipartite graphs (consecutive iterates
  flip between two shadows of the principal eigenvector — a star
  converges to "everyone equal" rather than "center > leaves"). Adding
  x_old to each iteration is equivalent to power-iterating (A + I) —
  same principal eigenvector but eigenvalues shift from ±λ to 1±λ,
  killing the bipartite sign flip. Standard NetworkX-style fix.
- Each `centrality[]` entry now carries `betweenness` and `eigenvector`
  fields.
- Slice cap raised 20 → 50 so when the user toggles metric, the top-N
  for that metric actually surfaces (a high-betweenness node may not be
  in the degree top-20).
- `?metric=total|betweenness|eigenvector` query param picks the sort key
  (defaults to `total`).
- New `_centralityInternals` export so tests can exercise the algorithms
  directly without the Express harness.

**Client (`client/src/modules/graph/CentralityView.jsx`):**

- "Rank by:" toggle with three pills (Degree · Betweenness · Eigenvector).
- Selection persisted in localStorage (`nexus.centrality.metric`).
- Bar fill width + value column reflect the active metric, not just the
  edge count. Bar color shifts amber → blue when an alternative metric
  is active so it's visually obvious which view you're in.
- Column header label tracks the active metric.

**Tests:** new `tests/centralityAlgorithms.test.ts` (14 specs):

- `buildUndirectedAdjacency` symmetry + empty handling
- `computeBetweennessCentrality` — empty graph, no edges, two-node
  endpoints, **star** (center has C(n,2) betweenness, leaves zero),
  **path** (textbook value of 4 for the dead-center of a 5-path),
  disconnected components.
- `computeEigenvectorCentrality` — empty graph, no edges (zero vector),
  two-node equality, **star** (center > leaves, leaves equal by
  symmetry), L2-normalized 4-cycle.

### Log: burst-grouping (#363)

Bursty categories (Plotted at task-import time, Commit at deploy time,
session-end auto-summaries) can stack 50+ rows in the same minute and
bury substantive events. Burst-grouping collapses **≥3 consecutive
same-type entries within 60s** into a single expandable row.

**Heuristic:** segment per-day arrays after filtering. A burst:

- Same `type` across all entries
- Each consecutive pair within 60s of the next

Singles render unchanged. Burst rows show: time-span (or single time if
all within the same minute), type icon, count + label
(`12× Plotted events bursting in 14:32-14:33`), expand/collapse chevron.
Expanded state shows the underlying entries indented inside a
left-border rule.

**Toggle:** a "Group bursts" button sits next to the time-range chips
(activity tab only). Default ON. State persisted in localStorage
(`nexus.log.bursts`). Off → original firehose render.

**Doesn't span date boundaries:** the segmenter operates on per-day
arrays inside `groupedActivity`, so a burst can't cross "Today →
Yesterday."

### Files touched

- `server/routes/impact.ts` — algorithm helpers (Brandes' +
  power-iteration), `CentralityEntry` shape extension, `?metric=` sort,
  slice 20 → 50, `_centralityInternals` export.
- `client/src/modules/graph/CentralityView.jsx` — METRICS array, metric
  toggle UI, sort + bar + value column wired to active metric, header
  label tracks active metric, localStorage persistence.
- `client/src/modules/Log.jsx` — `segmentBursts()` helper, burst toggle
  + state, expanded-burst tracking, render loop processes segments
  (single vs burst), expanded burst inlines entries with left-border.
- `tests/centralityAlgorithms.test.ts` — NEW (14 specs).
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version
  bump 4.7.8 → 4.7.9.
- `CHANGELOG.md`, `ROADMAP.md` — this entry.

### What's next

Both Tier-3 and Tier-4 deferred backlogs are at **zero**. Remaining
roadmap items:

1. **`server/db/store.ts` split** (~1700L) — last sizable monolith.
   Less natural seams than the v4.7.x file splits; consider
   extract-method-cluster as the first-pass approach.
2. **Fresh audit pass** — same playbook that produced the v4.7.7 +
   v4.7.8 sweeps; likely turns up a small batch of new tier-4-ish
   items.
3. **Vite bundle code-split** — 517.79kB warning persists. Lazy-load
   Graph + Overseer modules would meaningfully shrink initial load.
4. **Auto-link similarity threshold (#280) UI slider** — still doesn't
   drive the server. Hookup is straightforward but queued.

### Patterns codified

- **Power iteration on bipartite graphs needs a self-loop shift.**
  Documented in `computeEigenvectorCentrality` header.
- **Algorithm + API in one file with a `_internals` export.** Keeps
  routes self-contained while still letting tests reach in. Pattern is
  now usable for any future graph-algorithm additions.
- **Render-time segmentation for the activity stream.** Burst-grouping
  doesn't change the data shape — singles and bursts are rendering
  decisions, not store concepts. Mirrors how `formatDate`/sanitizeMessage
  treat display-time as the right place for "imperfect data normalized
  for the user."

## v4.7.8 — Tier-4 closeout (minimap · export · ambient telemetry)

Closes the **last three** Tier-4 polish items deferred from v4.7.7. Graph
Visual now has a minimap and a screenshot export; SessionStart ambient
telemetry is project-scoped with session-age stamps on stacked thoughts.
Plus a small data-sweep side-quest in the store.

**Tier-4 polish backlog: 0.** **402 tests · 29 tools · no migrations · no
breaking changes.**

### Graph Visual: minimap (#336)

Scaled-down view of the same graph anchored top-right inside the main SVG.
Hidden filters propagate (`hiddenProjects`, `hideAutoLinked`); cluster vs
project coloring respects the live mode. Click a node in the minimap to
select it. Threshold: `graph.nodes.length >= 40` — small graphs don't
need it; medium and large do. Implemented as a `<g transform>` group
inside the same SVG so coords stay layout-agnostic — no separate DOM
positioning layer to maintain.

### Graph Visual: screenshot export (#339)

Two new buttons in the toolbar — **SVG** (vector, keeps editing in
Inkscape/Figma) and **PNG** (2× DPI raster, easy to paste into docs).
Both bake in a legend strip at the bottom of the export with all 7 edge
types + footer (`Nexus · N nodes · M edges · layout <id> · YYYY-MM-DD HH:MM:SS`).
The live minimap is stripped from the export so it doesn't render twice
in the corner of the static image. Implementation factors into a shared
`buildExportSVG()` helper so the SVG and PNG paths stay in sync —
`exportSVG()` serializes via `XMLSerializer`, `exportPNG()` rasterizes
via canvas at 2× scale.

### SessionStart hook: ambient telemetry (#370)

The hook now project-scopes the in-progress and backlog task counts so
cross-project work doesn't pollute the resume context. Tasks without an
explicit project still surface (treated as shared/legacy). Cross-project
in-progress count surfaces as a one-line footer when non-zero so the user
knows there's other work alive elsewhere.

Active thoughts get the same project-scope treatment. Each surfaced
thought now carries a session-age stamp (`(N sessions ago)` for older
ones, `(this session)` for fresh) so freshness is obvious — three
sessions of drift means the context is probably stale.

`plugin/server/hooks/session-start.js` — same single-file change,
no new dependencies, no schema additions.

### Side-quest: `Firewall/Godot` slash-form normalization

28 occurrences of `"Firewall/Godot"` in `~/.nexus/nexus.json` (project
keys + tags + references) normalized to the canonical `"Firewall-Godot"`.
The v4.6.2-D2 hygiene migration's regex didn't catch all of them. Sweep
done as a one-shot Node script (read whole, regex replace, atomic
rename); backup at `~/.nexus/nexus.json.preNormalize`. Hyphen-form total
339 → 389; slash-form 28 → 0.

### Files touched

- `client/src/modules/Graph.jsx` — VisualView gets `buildExportSVG`/
  `exportSVG`/`exportPNG` callbacks, two new toolbar buttons (Download
  SVG, Camera PNG), and the minimap `<g>` group inside the main SVG.
  `Download` and `Camera` icons added to the lucide import.
- `plugin/server/hooks/session-start.js` — project-scoped task filter,
  cross-project footer, project-scoped thought filter, session-age stamps.
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
  4.7.7 → 4.7.8.
- `CHANGELOG.md`, `ROADMAP.md` — this entry.

### What's next

The visible-polish wave is finished. Three real next directions:

1. **Tier-3 deferred (`#301` + `#363`)** — algorithm + design work, not
   polish. Centrality alternative ranking metrics (betweenness, eigen-
   vector); Log burst-grouping collapse.
2. **`server/db/store.ts` split** (~1700L) — last sizable monolith.
   Less natural seams than the v4.7.x split set; consider extract-
   method-cluster as the first-pass approach rather than file split.
3. **Fresh audit pass** — walk the dashboard end-to-end again now that
   the visible polish is in. Likely turns up small things.

## v4.7.7 — Tier-4 polish sweep

Closes **12 of the 15** remaining Tier-4 polish items in a single sweep. The
post-`#217` backlog was almost entirely visible polish — tooltips, sort
controls, keyboard shortcuts, empty-state diagrams, edge-type contrast, and
the long-running cs/en localization mix. This release lands them together
so the dashboard reads "finished," not "in progress."

**402 tests · 29 tools · no migrations · no breaking changes.**

### Foundation: cs ↔ en locale toggle

New `client/src/lib/locale.js` carries the cs/en singleton via
`useSyncExternalStore` + `localStorage` — no Provider rewrite, no context
plumbing. Default `cs` (Europe/Prague). Sidebar footer carries a small toggle
button; consuming components re-render reactively when locale flips.

| API | Use |
|---|---|
| `useLocale()` | hook returning `'cs' \| 'en'` — subscribes to the singleton |
| `useLabels()` | hook returning the active label dictionary |
| `getLocale()` / `setLocale(loc)` | imperative read/write |
| `formatLocaleDate(d, opts)` / `formatLocaleTime(d, opts)` | locale-aware formatters that read at call time |
| `LABELS[loc]` | static label dictionary (`today`, `yesterday`, `sessions`, `points`, `thisWeek`, `prior`) |

Surfaces converted: Fuel TaskCostPanel dates (`cs-CZ` literal → `formatLocaleDate`),
Fuel Session Patterns "this wk · prior" + "sess" abbreviations, Log
Today/Yesterday/short dates. Closes `#243` (parent toggle), `#268` (Fuel
mix), `#365` (Log mix).

### Visual: edge-type contrast

`replaced` swapped from `THEME.gray` (#6b7280) to `THEME.cyan` — `gray` and
`slate` (used for `related`) were nearly identical Tailwind neutrals, hard
to distinguish on small edges. `experimental` swapped from `THEME.teal` to
`THEME.lime` to separate it from the blue/purple cluster. New `width` field
on each `EDGE_STYLES` entry adds a second visual dimension: stronger
relations (`depends_on`, `contradicts`) render heavier than weak ones
(`related`, `experimental`). Wired into VisualView main render, the legend,
and HolesView ClusterMiniViz. Closes `#337`.

### Power-user shortcuts

| View | Key | Action |
|---|---|---|
| Graph Visual | `/` | Focus search input |
| Graph Visual | `1` / `2` / `3` | Switch layout (`LAYOUTS[idx]`) |
| Log activity | `1`-`9` | Jump to filter chip at `typesPresent[idx]` |

Listeners scope themselves to the active view (Graph subview / Log tab) and
suppress when typing in inputs/textareas/contenteditable. Chip labels in
Log carry a small numeric hint for the first 9 chips. Closes `#338`, `#366`.

### Centrality insight callout

Auto-derived one-liner above the table: computes top-8 by edge count,
clusters by project, classifies as **strong** (≥60% in one project),
**lean** (≥40%), or **diverse**. Tone-styled box (amber for strong, dim
for lean/diverse). Recomputes on every fetch so the observation rotates as
the graph evolves. Closes `#304`.

### Blast Radius empty-state diagram

`BlastEmptyDiagram` — a small SVG of three concentric rings around a
central decision node, with satellite dots scattered on each ring at
varying angles, and faint "1/2/3" hop labels. Sits next to the explainer
copy in the empty state (hidden on narrow screens via `hidden sm:block`).
Communicates the blast-radius concept at a glance. Closes `#292`.

### Holes sort controls

Three-mode toggle on the fragmented-projects list: **Orphans ↓** (default
— most actionable surfaces first), **A → Z** (project name), **Recent**
(max `memberId` per project, descending — proxy for newest decisions
fragmented). Shown only when `fragmented.length > 1`. Closes `#323`.

### Tooltips

- **#267 Plan tier (Fuel):** `Max 5x` and `2x capacity` were opaque
  without context. New `planTooltip` derives a one-liner anchored to the
  Pro baseline: "2× more capacity than the Pro plan · $100/mo · ~88k
  tokens per 5h window." Attached to both the plan label and the
  multiplier-capacity span via `title=` + `cursor-help`.
- **#283 Graph `general` row:** decisions without an explicit project
  bucket into `general`. The row now renders italic + faint with a
  `cursor-help` tooltip explaining the dumping-ground semantic ("Decisions
  recorded without an explicit project assignment. Review and reassign in
  The Ledger.").

### Freshness stamp on Graph Visual

Small "Graph indexed Ns ago" line above the StatCards, ticking every 5s.
Pattern lifted from `Log.jsx` `liveState` — re-tick interval drift, no WS
hookup needed. `indexedAt` advances when the graph reference changes
(parent refetch). Pairs with the keyboard-shortcut summary line on the
right (`/ search · 1-3 layout`). Closes `#338`.

### `#270` UI audit — closed

Meta-task to walk Graph/Overseer/Log and queue improvements. Discovery
happened on 2026-04-18 (when `#283`/`#292`/`#304`/`#323`/`#336`–`#339`/
`#365`/`#366` were plotted); this sweep was the implementation. Closing
the meta task now that the queue it spawned is largely cleared.

### Deferred for a future session

- **`#336` Visual minimap** — viewport overlay + click-to-jump; non-
  trivial SVG/state work.
- **`#339` Visual screenshot capability** — PNG/SVG export with legend
  baked in; legend-rendering pass needed.
- **`#370` Ambient telemetry — in-flight tasks + thoughts** — hook-layer
  change, different surface from dashboard polish.

### Patterns codified

- **Pure-lib + thin presentation** — `locale.js` follows the
  `graphLayouts.js` / `todayView.js` / `cli/lib` / `mcp/lib` precedent.
  Now exercised 5×.
- **`useSyncExternalStore` for cross-tree localStorage state** — first
  use in Nexus. Cleaner than a Provider rewrite when the state is a
  global singleton (locale, theme, etc.). Pattern documented in
  `client/src/lib/locale.js` header.
- **Per-type stroke width as second visual encoding** — pairs with color
  + dash so all 7 edge types are distinguishable through 3 dimensions.
  Renderers read `style.width || 1` so the field is optional.
- **Insight derivation from data shape** — Centrality top-N callout
  follows the v4.5.4 #258 confidence-tagged-recommendation precedent
  (suppress when sample is too thin, rotate as data evolves).

### Files touched

- `client/src/lib/locale.js` — NEW (~80L)
- `client/src/lib/theme.js` — `EDGE_STYLES` color + width updates
- `client/src/components/Sidebar.jsx` — locale toggle button in footer
- `client/src/modules/Fuel.jsx` — plan tooltip, locale wiring,
  `labels.sessions/thisWeek/prior` substitutions
- `client/src/modules/Graph.jsx` — `general` tooltip, freshness stamp,
  keyboard shortcuts, BlastEmptyDiagram, edge `width` reads in VisualView
  + legend
- `client/src/modules/Log.jsx` — `formatDate`/`formatTime` locale-aware,
  `useLocale()` subscription, 1-9 chip shortcuts + numeric hints
- `client/src/modules/graph/CentralityView.jsx` — auto-insight callout
- `client/src/modules/graph/HolesView.jsx` — sort controls, edge `width`
  in ClusterMiniViz
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
  4.7.6 → 4.7.7
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### What's next

Tier-4 polish backlog is down to 3 items, all explicitly larger than a
polish-tier fix:

1. `#336` Visual minimap
2. `#339` Visual screenshot
3. `#370` Ambient telemetry hook

Plus the long-standing optional structural item:

4. `server/db/store.ts` split (~1700L) — last sizable monolith, less
   natural seams than the v4.7.x split set.

## v4.7.6 — MCP server split (#217 part 4)

Closes the **fourth and biggest** installment of `#217`. The MCP server
monolith (`server/mcp/index.ts` at 1991L: imports + helpers + 29 tool
defs + 893-line dispatcher switch + stdio setup) breaks into foundation
libs + per-category tool modules + a tiny entrypoint. **Same 29 tools, same
manifest, same wire protocol.**

**402 tests (+22) · 29 tools · no migrations · no breaking changes.**

### Why this was the big one

The CLI split (v4.7.5, 2047L → 1350L) was the warm-up. `mcp/index.ts` was
the real beast: a single switch statement for 29 tools where every case
shared the same fetch + format helpers, no natural seams, all in one file.
The risk was higher (the MCP stdio server is sensitive — any error and
Claude Desktop breaks) but the impact much greater (per-category files
make adding/changing a tool straightforward).

### What moved

**Foundation libs** (`server/mcp/lib/`):

| File | Lines | Contents |
|---|---|---|
| `config.ts` | 18 | `STANDALONE` · `NEXUS_BASE` · `SERVER_NAME` · `SERVER_STARTED_AT` (+ re-exports `SERVER_VERSION`) |
| `nexusFetch.ts` | 86 | `nexusFetch()` HTTP/standalone wrapper · `SLOW_TOOLS` set · `HEARTBEAT_INTERVAL_MS`. Top-level `await import('./localApi.ts')` for standalone mode lives here |
| `format.ts` | 197 | `formatBrief` · `formatPlan` · `formatGuard` + `BriefData` type |

**Tool category modules** (`server/mcp/tools/`):

| File | Tools | Notes |
|---|---|---|
| `read.ts` | 10 | `nexus_brief` · `get_plan` · `check_guard` · `search` · `get_critique` · `predict_gaps` · `get_blast_radius` · `ask_overseer` · `version` · `read_handover` |
| `write.ts` | 13 | `record/update_decision` · `push/pop_thought` · `log_usage` · `create/complete/delete_task` · `log_activity/session` · `link_decisions` · `update_handover` · `import_cc_memories` |
| `ai.ts` | 3 | `ask_overseer_start` · `get_overseer_result` · `propose_edges` (the async-poll trio) |
| `composite.ts` | 3 | `bridge_session` · `fleet_overview` · `calendar_runway` |

Each tool module exports `{ <category>Tools, <category>Handlers }`. The
entrypoint spread-merges into a combined registry, then dispatches via
`handlers[name](args)` — same shape as the v4.7.5 CLI registry pattern.

### Result

- **`server/mcp/index.ts`: 1991L → 164L (−92%)**. Just imports + the combined
  registry + the existing heartbeat-aware dispatcher + `main()`.
- Total MCP surface: 1962L across 8 files (was 1991L in 1 file). Each file
  18–620L now; the largest is `tools/write.ts` because write tools have the
  biggest input schemas.

### Compatibility

**Zero wire-protocol changes.** Tool order in `ListTools` is preserved
(`read → write → ai → composite`); `mcpb/manifest.json` ordering is
unchanged; every tool's `inputSchema` is byte-for-byte the same. The MCPB
smoke test exercises 12 tools end-to-end via the bundled stdio server —
all green on the new structure.

### Test updates

- **`tests/versionDrift.test.ts`** — the v4.3.7 source-grep test was
  scanning `server/mcp/index.ts` for `name: 'nexus_'` matches; now scans
  the union of `server/mcp/tools/{read,write,ai,composite}.ts`. Same regex,
  expanded file set. The "every manifest tool exists in source" test got
  the same expansion.
- **`tests/mcpToolsRegistry.test.ts`** (NEW, 22 specs):
  - Per-group: every tool has a name + description + schema + matching
    async handler · no orphan handlers · expected category sizes
    (10 / 13 / 3 / 3 = 29).
  - Cross-group: no tool name appears twice; total = `TOOL_COUNT_EXPECTED`.
  - Foundation lib smoke: `config.ts` exports + types · `format.ts`
    formatters work on empty data · `nexusFetch.ts` exposes
    `SLOW_TOOLS` correctly populated.

### Patterns codified

- The **"big switch" → handler-map dispatcher** pattern from v4.7.5 (CLI)
  ports cleanly to TypeScript with proper `Record<string, (args: any) => Promise<string>>`
  typing. The two registries are now structurally identical (CLI + MCP).
- **Top-level await in lib modules** (`nexusFetch.ts` loading the
  standalone adapter) works the same way the entrypoint did, and gets
  triggered exactly once when the entrypoint imports it.
- **Drift tests evolve with the structure.** When a file split changes
  what a regex should scan, the test gets updated as part of the same
  release — not as a follow-up.

### Files touched

- `server/mcp/lib/config.ts` — NEW (18L)
- `server/mcp/lib/nexusFetch.ts` — NEW (86L)
- `server/mcp/lib/format.ts` — NEW (197L)
- `server/mcp/tools/read.ts` — NEW (505L)
- `server/mcp/tools/write.ts` — NEW (620L)
- `server/mcp/tools/ai.ts` — NEW (121L)
- `server/mcp/tools/composite.ts` — NEW (251L)
- `server/mcp/index.ts` — 1991L → 164L (registry + dispatcher + main)
- `tests/versionDrift.test.ts` — drift scans expanded to per-category files
- `tests/mcpToolsRegistry.test.ts` — NEW (22 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
- `README.md`, `CONCEPT.md` — test count 380 → 402
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### What's next

`#217` is **fully shipped**. All four parts done:

| Part | What | Result |
|---|---|---|
| 1 | `client/src/lib/graphLayouts.js` extraction (v4.7.1) | Graph.jsx 2495 → 2426L |
| 2 | `client/src/modules/graph/{Centrality,Contradictions,Holes}View.jsx` (v4.7.2) | Graph.jsx 2426 → 1327L (−47% total) |
| 3 | `cli/lib/` + `cli/commands/` (v4.7.5) | cli/nexus.js 2047 → 1350L (−34%) |
| 4 | `server/mcp/lib/` + `server/mcp/tools/` (v4.7.6, this) | mcp/index.ts 1991 → 164L (−92%) |

Remaining structural debt is small: `server/db/store.ts` (~1700L, but the
seams are less natural — it's a single coherent class). `#219` Zod
validation at route boundaries is unrelated and can wait.

Next priorities (per handover): **Tier-4 polish sweep** for the visible
delta, or `Firewall/Godot` slash-form normalization for store hygiene.

## v4.7.5 — CLI command split (#217 part 3)

Closes the third installment of `#217` (split oversized files). The CLI
monolith (`cli/nexus.js` at 2047L with ~45 commands inline) is broken into
foundation libs + per-group command files. Same UX, same dispatch, smaller
files.

**380 tests (+11) · 29 tools · no migrations · no breaking changes.**

### Why now

After v4.7.1's `client/src/lib/graphLayouts.js` and v4.7.2's
`client/src/modules/graph/` extractions, the client side of `#217` is
done (Graph.jsx 2495 → 1327L, −47%). v4.7.5 starts the equivalent server-
side work. Same pattern as v4.7.4's TodayView: pure helpers in `lib/`,
feature surfaces in dedicated files, registration test catches drops.

### What moved

**Foundation libs** (`cli/lib/`):
- `cli/lib/format.js` — ANSI color helpers (`dim`, `amber`, `green`,
  `blue`, `red`), `STATUS_COLORS`, `formatTask`, `timeSince`, `progressBar`.
  Anything formatting-related used by multiple commands.
- `cli/lib/api.js` — `BASE`, `NEXUS_VERSION` (read from root
  `package.json`), and the `api()` HTTP helper with `ECONNREFUSED` →
  friendly-exit handling. Single source of truth for the dashboard URL.

**Command groups** (`cli/commands/`):

| File | Commands |
|---|---|
| `tasks.js` | `task` · `tasks` · `done` · `quick` (4 — task lifecycle + one-glance status) |
| `sessions.js` | `log` · `note` · `session` · `context` · `summarize` · `digest` · `activity` · `handoff` (8 — session/activity history + end-of-day rituals) |
| `ledger.js` | `record` · `decisions` · `search` · `impact` · `link` · `graph` · `seek` · `find` (8 — knowledge graph read/write) |
| `git.js` | `sync` · `commit-all` · `repos` (3 — fleet git workflow) |

23 commands moved. ~22 commands stay inline (status / brief / pulse / mcp /
hooks / help / planning suite / overseer suite / fuel suite / etc.) —
they're either small or glue heavy enough that an extraction would mostly
move boilerplate.

### Result

- **`cli/nexus.js`: 2047L → 1350L** (−697L, −34%)
- Total CLI surface: 2183L across 7 files (was 2047L in 1 file). Slight
  growth from imports/exports overhead; each individual file is now
  56–292L.

### Surgical extraction technique

The big-block deletion used the same guarded Node one-liner pattern from
v4.7.2 session #247 — assert the line ranges contain what's expected,
then splice. Approach:

1. Write the new files (`lib/format.js`, `lib/api.js`, four `commands/*.js`)
   with the extracted bodies copied verbatim.
2. Run a Node script that reads `cli/nexus.js`, asserts landmark lines
   (`async quick`, `async task`, `['commit-all']`, `async activity`,
   dispatcher), drops the moved ranges, and replaces the imports + the
   `commands` opener + the dispatcher prelude with the new wiring.
3. Smoke-test 6+ representative CLI commands (`help`, `mcp`, `memory
   sources`, `hooks`, `status`, `brief`) before committing.

### Tests

`tests/cliCommands.test.js` adds **11 specs**:

- Per-group exports × 4 (`tasks` · `sessions` · `ledger` · `git`) — assert
  the exact command set per file. Catches accidentally-dropped or renamed
  commands.
- Cross-group registry check — no command name appears in two groups.
- Foundation lib smoke × 2 — `format.js` color helpers + `formatTask` shape
  + `progressBar` length; `api.js` shape + version regex.

End-to-end CLI behavior is covered by the existing manual smoke tests
(`node cli/nexus.js help`, etc.) — we verified all extracted command
groups still work over a real Nexus dashboard.

### Compatibility

Zero user-facing changes. Every `nexus <cmd>` invocation works exactly the
same as v4.7.4. The dispatcher signature is unchanged (`commands[cmd]
(args)`). Imports added: `BASE`, `join`, `resolve`, `existsSync`,
`readFileSync`, `writeFileSync`, `homedir` — all of which were previously
imported anyway, just now from explicit module sources.

### Files touched

- `cli/lib/format.js` — NEW (~60L)
- `cli/lib/api.js` — NEW (~60L)
- `cli/commands/tasks.js` — NEW (~85L)
- `cli/commands/sessions.js` — NEW (~290L)
- `cli/commands/ledger.js` — NEW (~265L)
- `cli/commands/git.js` — NEW (~80L)
- `cli/nexus.js` — 2047L → 1350L (registry + dispatcher + remaining inline)
- `tests/cliCommands.test.js` — NEW (11 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
- `README.md`, `CONCEPT.md` — test count 369 → 380
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### What's next

`#217` part 4 — `server/mcp/index.ts` split (1700L+). Pattern is now well-
exercised: pure helpers in `server/mcp/lib/`, tools grouped by category
(read / write / async-ai / composite). The central `handleTool` switch
makes it trickier than the CLI split; expect more thinking, less boilerplate.

Tier-4 polish sweep is the safer alternate.

## v4.7.4 — Today fusion view

Closes `#240` (Tier-3 UX prototype, deferred since v4.5.10). New dense
header card on the Command tab that fuses four signals into one glance:
**fuel · current task · recent activity · top risk**. Visible above both
strategic and kanban views.

**369 tests (+27) · 29 tools · no migrations · no breaking changes.**

### Why a header card

Pre-v4.7.4 the four signals were scattered across StrategicView panels
(Now/Next/Later/Done columns + risks bar) and across the Fuel tab. A user
opening the Command tab to "see where we are" had to read three or four
sections to assemble the answer. TodayView puts the answer in one row.

### Design

Single bordered card at the top of Command, with a 4-column responsive
grid (1-col on phones, 2x2 on tablets, 4-col on desktop):

| Column | Shows |
|---|---|
| **Fuel**   | session % (color-coded by pressure) · weekly % · runway label |
| **Now**    | most-recently-touched in-progress task · project tag · elapsed · `+N more` for the rest |
| **Pulse**  | last 3 activity entries with relative timestamps (`5m`, `2h`, `1d`) |
| **Signal** | top risk by severity (critical > warning > info) OR "Calm waters." when none |

No new fetches, no new endpoints. Reuses the same `fuel`, `inProgress`,
`recentActivity`, and `visibleRisks` props that `StrategicView` already
consumes. Pure additive; the existing risks bar + Now panel still render
below for the deeper view.

### Pure-logic split

All derivation lives in `client/src/lib/todayView.js`:

- `formatTimeAgo(iso, now?)` — compact relative-time labels
- `fuelPressure(pct)` — `'critical' | 'low' | 'normal' | null`
- `formatRunway(minutes)` — minutes / hours / days, with `<1m` floor
- `topRisk(risks)` — picks highest-severity, ties broken by first-encountered
- `deriveTodayState({ fuel, inProgress, recentActivity, risks, now })` —
  single-pass derivation returning the full `{fuel, now, pulse, signal}`
  block ready to render

The JSX in `client/src/modules/command/TodayView.jsx` is dumb glue. This
split keeps tests in node-only Vitest (no jsdom / no @testing-library/react
setup needed) and makes the rendering trivially swappable later.

### Tests

`tests/todayView.test.js` adds **27 specs**:

- `formatTimeAgo` × 5 (null / just-now / minutes / hours / days)
- `fuelPressure` × 4 (null / critical / low / normal with boundaries)
- `formatRunway` × 5 (null / sub-minute / minutes / hours / days)
- `topRisk` × 4 (empty / severity ranking / tie-break / unknown levels)
- `deriveTodayState` × 9 (empty workspace / estimated > reported / reported
  fallback / critical pressure / lead-task selection / activity formatting /
  risk surfacing / four-signal integration / idle + calm-waters)

All deterministic via an injected `now` parameter (no clock-drift flakes
like the v4.7.2 `store.test.js` bonus fix).

### Files touched

- `client/src/lib/todayView.js` — NEW (~140L, pure)
- `client/src/modules/command/TodayView.jsx` — NEW (~140L, presentation)
- `client/src/modules/Command.jsx` — `import TodayView` + 1 render line
  before the strategic/kanban switch
- `tests/todayView.test.js` — NEW (27 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
- `README.md`, `CONCEPT.md` — test count 342 → 369
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### What's next

With `#240` closed, all v4.5.10-deferred Tier-3 items are shipped. Remaining
work: structural debt (`#217` part 3 — `cli/nexus.js` split) and the Tier-4
polish sweep.

## v4.7.3 — Auto-suggest Contradictions

Closes `#310` (deferred Tier-3 since v4.5.10) — the contradiction scan engine
shipped in v4.4.8 #307 ran only when a human clicked the "Scan for
contradictions" button in the Conflicts tab. v4.7.3 makes the same scan
automatic on a 24h cadence so suggestions accumulate while you work.

**342 tests (+9) · 29 tools · no migrations · no breaking changes.**

### What's new

- **`server/watchers/contradictionPoller.ts`** (NEW, ~200L) — `runContradictionScan`
  performs one full cycle (POST `/scan-contradictions` → poll
  `/ask/result/:taskId` until done) and reports
  `{ status, newSuggestions, totalEvaluated, durationMs }`. The pure
  `shouldRunContradictionScan(lastScan, now, minIntervalMs)` helper is
  exported for unit tests.
- **`startContradictionPoller`** — `setInterval` wrapper. Initial run after
  60s (lets the server + LM Studio settle); subsequent runs every 24h.
  Skip-if-recent guard prevents a dashboard restart from immediately
  re-firing.
- **`server/dashboard.ts`** — wires the poller alongside the existing
  `runRiskScan` (6h) and `runDigest` (24h) scheduled scans. `port`,
  `broadcast`, and the `store` are passed through.
- **Brief surfacing** — `nexus_brief` now fetches
  `/api/impact/contradictions` and `/api/scans?type=contradiction&limit=1`
  in its `Promise.all` block. When `pendingContradictions > 0` the brief
  prints a "Pending Overseer suggestions: N · last scan Xh ago" line with
  a pointer to the Conflicts tab.
- **Dashboard toast** — when a scan finds new suggestions, the poller
  broadcasts `{type: 'notification', payload: {title, message}}` over the
  WS bridge. `ToastOverlay` already listens for this shape (used by
  `overseerPoller`'s critical-risk alerts since v4.4.x).

### Why a wrapper, not a refactor of the existing route

The route's async-task pattern (`asyncTasks.set(taskId, ...)` + poll
endpoint) is HTTP-specific. Refactoring it into a shared core would have
been ~200L of churn in `overseer.ts`. Instead the poller calls the existing
route via `localhost` fetch and polls the same `/ask/result/` endpoint the
frontend uses. Single source of truth (the route) stays as-is; the poller
is purely additive.

### Budget

- **20 max_pairs per auto-scan** — same as the manual button (Captain
  pick). Stage 1 (embedding shortlist) is cheap; Stage 2 (Overseer LLM
  classification) is the cost driver. ~20 pair evaluations × ~500 tokens
  each = single-digit cents per daily run with Gemma 4 31B locally.
- **23h skip guard** so dashboard restarts within 24h don't double-fire.
- **Silent skip when Overseer is down** — no error toast, no scheduled-scan
  record. The next interval re-attempts.

### Tests

`tests/contradictionPoller.test.ts` adds **9 specs**:

- `shouldRunContradictionScan` × 5: undefined / 1h-ago / boundary / 25h-ago.
- `runContradictionScan` × 4: skipped-recent (no fetch) · skipped-overseer-
  down (mock 'No local AI') · completed-with-toast (mock POST + poll, asserts
  `addScheduledScan` + WS broadcast) · completed-zero-new (asserts NO toast
  when delta is 0).

End-to-end (real Express + real LM Studio) is covered by the existing
`/api/overseer/scan-contradictions` route tests in `tests/routes.test.ts`.

### Files touched

- `server/watchers/contradictionPoller.ts` — NEW (~210L)
- `server/dashboard.ts` — `startContradictionPoller` import + wiring
- `server/mcp/index.ts` — brief composer fetches `/api/impact/contradictions`
  + `/api/scans?type=contradiction`; `formatBrief` adds the suggestions line
- `tests/contradictionPoller.test.ts` — NEW (9 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
- `README.md`, `CONCEPT.md` — test count 333 → 342
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### What's next

With `#310` closed, the Tier-3 deferred list from v4.5.10 is fully drained.
Next priorities (per the v4.7.2 handover):

- **Tier-4 sweep** (~13 polish items) — visible delta, low risk
- **`#240` "Today" fusion view** — Tier-3 UX prototype
- **`#217` part 3+** — `cli/nexus.js` (~2049L) + `server/mcp/index.ts`
  (1700L+) splits

## v4.7.2 — Graph Splits + Memory Bridge Polish

Stacked batch closing the v4.7.1 handover's top three follow-ups: `#217 part 2`
(Graph.jsx view extraction), `#591` (encodedProject derivation for Cowork
sandbox paths), `#592` (CLI inspection of the multi-source memory bridge
config). **333 tests (+2) · 29 tools · no migrations · no breaking changes.**

### #217 part 2: Graph.jsx view extraction

Builds on the v4.7.1 layout-extraction precedent. Three top-level views and
their private helpers move from `client/src/modules/Graph.jsx` to per-view
files under `client/src/modules/graph/`. The dispatch in `GraphModule` is
unchanged — only the imports moved.

- **`client/src/modules/graph/CentralityView.jsx`** (NEW, 238L) — degree-
  centrality table with sortable columns, project filter, pagination. Co-
  locates its private `SortableHeader` helper.
- **`client/src/modules/graph/ContradictionsView.jsx`** (NEW, 497L) — the
  whole Conflicts tab. Bundles `ResolveConflictCard` (v4.6.5 #311 resolution
  workflow), `ScanContradictionsPanel`, `SuggestedContradictionCard`, and
  `FlagContradictionForm` — all 5 components in one cohesive file.
- **`client/src/modules/graph/HolesView.jsx`** (NEW, 435L) — fragmentation
  detection, orphan listing, batch auto-link, cross-project drill-down.
  Bundles `ClusterMiniViz` (v4.5.8 #318 deterministic-circle mini-diagram).

**Net result**: `Graph.jsx` shrinks **2426L → 1327L (−1099 / −45%)**. Beats
the v4.7.1 handover estimate (~1500L target). The pattern from v4.7.1 layouts
replicated cleanly for stateful views with cross-tab navigation, fetch
effects, and the new ResolveConflictCard plumbing — all unchanged.

### #591: encodedProject derivation for Cowork sandbox paths

The v4.7.0 multi-source memory bridge's `buildEntry()` derived `encodedProject`
via `basename(dirname(memoryDir))`. For the CC dev layout (`~/.claude/projects/
<encoded>/memory/file.md`) this correctly returns `<encoded>`. For Cowork
sandbox paths (`/sessions/<id>/mnt/.auto-memory/file.md`) the same logic
returned `'mnt'` — losing the sandbox id. The comment in the code claimed
otherwise; the comment lied.

Practical impact at v4.7.0/v4.7.1 was low because `inferProject` falls through
to `tryClassifyProject(content)` content-pattern matching when `DIR_HINTS`
misses, so memories still classified — but the field was misleading and would
trip up any downstream code reading `encodedProject` directly.

**Fix** (`server/lib/memoryIndex.ts`): detect the sandbox shape by spotting
the dot-prefixed `memoryDir` name (`.auto-memory`) AND the literal `mnt`
parent, and walk one extra `dirname()` level up in that case. CC dev shape
unchanged (`memoryDir` name `memory` doesn't start with `.`).

**Tests** (`tests/memoryBridgeMultiSource.test.js`): adds 2 specs to the new
`encodedProject derivation (#591)` block. CC-dev assertion verifies the
unchanged path; sandbox assertion checks both the negative (`!== 'mnt'`) and
the positive (`=== 'epic-bold-ptolemy'`).

### #592: CLI `nexus memory sources` subcommand

Listed in the v4.7.0-M1 spec; deferred at v4.7.0 ship. Adds `commands.memory`
to `cli/nexus.js`. `nexus memory sources` reads `~/.nexus/nexus.json`
directly (no server hop, works offline) and prints the configured sources
with status, name, glob, and machine hint, plus the dedup strategy and the
file path to edit.

`nexus memory` (no args) prints a short usage block pointing at
`nexus_import_cc_memories` (the MCP tool that runs an actual import) and the
`_memoryBridge.sources[]` editing path.

### Bonus: store.test.js date-expired test fixed

The "returns usage sorted newest first" spec hardcoded `2026-04-06`
timestamps inside the store's 30-day retention filter. It started silently
failing on **2026-05-07** (today, 31 days later — both seeded entries fell
off the back). Switched to relative timestamps (`Date.now() - 1h/2h`) so
the test never expires.

### Files touched

- `server/lib/memoryIndex.ts` — #591 fix + comment correction
- `client/src/modules/Graph.jsx` — three view extractions, 2426L → 1327L
- `client/src/modules/graph/CentralityView.jsx` — NEW (238L)
- `client/src/modules/graph/ContradictionsView.jsx` — NEW (497L)
- `client/src/modules/graph/HolesView.jsx` — NEW (435L)
- `cli/nexus.js` — #592 `memory` subcommand (+72L)
- `tests/memoryBridgeMultiSource.test.js` — 2 new specs for #591
- `tests/store.test.js` — date-expired test fixed
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
- `README.md`, `CONCEPT.md` — test count 331 → 333
- `CHANGELOG.md`, `ROADMAP.md` — this entry

### What's next

`#310` (semantic-opposition auto-suggest) remains blocked on LM Studio. Tier-4
sweep (~13 polish items) and `#240` (Today fusion view) are the next visible
features when Overseer is offline.

Structural debt: `cli/nexus.js` is now 2049L, `server/mcp/index.ts` is still
1700L+. Same extraction pattern (lib + per-feature file) would work for both,
but neither has the same per-tab natural seams Graph.jsx had.

## v4.7.1 — Graph Layouts + Algorithm Extraction

Rides on top of v4.7.0. Half-session Tier-3 batch closing `#332` from the
v4.6.5 handover, originally built locally as v4.6.6 and rebased onto v4.7.0
when the multi-source memory bridge was discovered to have shipped from
another machine. **331 tests (+31) · 29 tools · no migrations · no breaking
changes.**

### #332 Tier-3: alternative graph layouts

The Visual decision graph had a single force-directed layout. Adds two
alternative layouts and a switcher.

- **New** `client/src/lib/graphLayouts.js` — pure-function module exporting
  `forceDirectedLayout` (the v4.4.x spring-embedder lifted as-is),
  `circularLayout` (deterministic ring sorted by id, top of canvas anchored at
  the lowest id), `hierarchicalLayout` (BFS-layered top-to-bottom from each
  component's highest-degree node, with multiple components allocated
  proportional horizontal slabs). All three return the same
  `{ positions, degree, components, nodeComponent }` shape so VisualView's
  render code is layout-agnostic.
- **`client/src/modules/Graph.jsx`** — VisualView's `useMemo` shrunk from
  ~120L to a 9-line dispatch (`LAYOUT_FNS[layoutMode]({...})`). Net file size
  2495 → 2426L (−69), partial groundwork for `#217` (split oversized files).
  New layout-pill toolbar mirrors the by-project / by-cluster style.
- **`localStorage` persistence** — choice saved under
  `nexus.graph.visual.layout`, validated against the registry on read, silent
  fallback to `force` when localStorage is unavailable (SSR / sandboxed
  contexts).

### Why the extraction matters

The handover had `#217` (split oversized files) flagged as the highest
structural debt — `Graph.jsx` at ~2400L, `cli/nexus.js` 1969L,
`mcp/index.ts` 1700L+. This release ships a Tier-3 feature *and* demonstrates
the extraction pattern: pure-function lib with a single dispatch import, no
React in the lib, render code unchanged. Future `#217` passes can lift
HolesView / CentralityView / ContradictionsView to `client/src/modules/graph/`
the same way.

### Tests

`tests/graphLayouts.test.js` adds **31 specs**: 7 shared-contract specs × 3
layouts (positions present, in-bounds, degree match, components match,
empty-graph handling, single-node handling, determinism) + geometry checks
(circular ring radius equality, top-of-ring at lowest id), hierarchical
layering (chain depth ordering, star hub-on-top, separated component slabs),
force-directed physics (mean edge length < mean disconnected distance), and a
registry-sanity block. Total 300 → **331 tests**.

### Files touched

- `client/src/lib/graphLayouts.js` — NEW (~275L)
- `client/src/modules/Graph.jsx` — useMemo replaced + layout state + selector
- `tests/graphLayouts.test.js` — NEW (~248L, 31 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json` — version bump
- `README.md` — test count 300 → 331
- `CONCEPT.md` — test count synced
- `CHANGELOG.md` — this entry
- `ROADMAP.md` — v4.7.1 entry

### What's next

Next batch (preplanned in the Continuous Handover): `#217` Graph.jsx split —
lift HolesView, CentralityView, ContradictionsView into per-view files under
`client/src/modules/graph/`. Layout extraction here is the proof of concept;
the views are bigger and trickier (cross-tab navigation, fetch effects, the
new ResolveConflictCard). Half- to full-session.

Also queued: `encodedProject` derivation for Cowork sandbox paths in
`memoryIndex.ts buildEntry()` — `dirname(memoryDir)` returns `mnt`, not the
sandbox id, when the source is `/sessions/<id>/mnt/.auto-memory/*.md`. Low
impact (content-pattern fallback still classifies the project), but the
field name lies. Half-hour fix.

If `#310` (semantic-opposition auto-suggest) is desired sooner, LM Studio
needs to come up first — Overseer was unavailable at the v4.7.1 dock.

## v4.7.0 — Multi-source CC memory bridge

Spec: `v4.7.0-M1_multi_source_memory_bridge.md` (Nalira's proposal from a
TUL-sandbox session, 2026-05-02). Problem in one sentence: pre-v4.7
`nexus_import_cc_memories` only knew about a single hardcoded path
(`~/.claude/projects/*/memory/*.md`), so memories written by Cowork sessions
from other machines (sandbox-internal paths like
`/sessions/<id>/mnt/.auto-memory/*.md`) never reached the Ledger. Same user,
two surfaces, no continuity between them.

### Added
- **`MemoryBridgeConfig`** in `NexusData._memoryBridge` — array of named
  sources, each with its own glob pattern, optional `machineHint`, and enable
  flag. Edit `~/.nexus/nexus.json` to append a Cowork-sandbox source or a
  custom path; restart Nexus and the next import sees them.
- **`server/lib/memoryBridge.ts`** — minimal cross-platform glob expander
  (`*` segments + intra-segment `*.md` patterns), `~` expansion via `HOME`/
  `USERPROFILE`, default-source factory.
- **Per-source try/catch** in `scanCCMemories` — an unreachable source (e.g.
  a Cowork sandbox path that doesn't exist on the home PC) yields an empty
  list and a `sourceErrors[]` entry instead of crashing the whole import.
- **Content-hash dedup** (opt-in via `_memoryBridge.dedup.strategy =
  'content-hash'`) — the same persona/feedback memory file replicated across
  two machines collapses into one Decision; with `trackAllSources: true` the
  entry's `allSources[]` records every path it was found at.
- **`source_filter` parameter** on `nexus_import_cc_memories` — scope a scan
  to one named source for debugging (e.g. `source_filter: 'cowork-sandbox'`).
- **Provenance in import samples** — every sample line now ends with
  `← <source-name>/<machine-hint>` so you can tell at a glance which surface
  each memory came from.

### Changed
- `nexus_import_cc_memories` response gains `totalFilesScanned`,
  `uniqueScanned`, `sourcesScanned`, and `sourceErrors[]` alongside the
  existing `totalScanned` (which still means "post-filter, ready to import"
  — backward-compatible).
- MCP tool description updated; tool count unchanged at 29.

### Migration
- **`v4.7.0-M1`** runs at the next cold start. If `_memoryBridge` doesn't
  exist yet, populates a single-source default exactly equivalent to the
  v4.6.5 hardcoded path. Honors `NEXUS_CC_PROJECTS_DIR`. Idempotent — a
  user-edited config is left untouched (the migration only writes when the
  field is absent).

### Tests
- New `tests/memoryBridgeMultiSource.test.js` — 17 specs covering
  `expandHome` cross-platform behavior, `expandGlob` walks (including
  unreachable-path resilience and intra-segment globs), multi-source
  aggregation, `sourceFilter`, disabled sources, content-hash dedup,
  `trackAllSources`, and the v4.7.0-M1 migration's idempotence.
- **300 active tests green** (was 283 + 17 new).

### Compatibility
- No breaking changes. Existing v4.6.5 installs migrate automatically and
  see identical behavior unless they edit `_memoryBridge.sources[]`.
- The `glob` npm package was *not* added — the small built-in
  `expandGlob` covers the documented patterns and avoids a new dependency.

## v4.6.5 — Foundation Fix + Polish Sweep

Final batch before the nexus-driven handover takeover. **Twelve items
landed**: 1 priority-structural (#399 store-reload race), 1 Tier-3 closer
(#311 Conflicts resolution workflow), 10 Tier-4 polish wins. **283 tests
(+1) · 29 tools · no migrations · no breaking changes.**

### #399 Foundation: store-reload race fixed (priority 1)

The bug class that quietly undid v4.5.8's phantom-project cleanup. Root
cause confirmed: dashboard had a file watcher but **MCPB did not**. Each
process loaded its own copy of `nexus.json`; whichever wrote last
won, even with stale data.

Fix: moved the watcher INTO `NexusStore` itself so every process gets it
for free.

- New private fields: `_lastFlushAt: number`, `_watcher: FSWatcher | null`
- New constructor step: `_initWatcher()` runs after migrations, skipped
  when `NODE_ENV=test` or `NEXUS_DISABLE_WATCHER=1`
- New API: `store.onExternalReload(cb)` for callers (dashboard) to hook
  the broadcast
- `_flush()` records `_lastFlushAt = Date.now()`; watcher compares mtime
  to that + 100ms grace, ignores our own writes
- `dashboard.ts` simplified: removed manual `fs.watch` block, replaced with
  `store.onExternalReload(() => broadcast({ type: 'reload', ... }))`

This means the MCPB process now reloads automatically when the dashboard
writes (fixed the half of the race that was missing) AND the dashboard
still reloads + broadcasts when the MCPB writes (existing behavior preserved).

### #311 Tier-3 closer: Conflicts structured resolution workflow

The Conflicts tab had a "flag" form but no "resolve" UI. Conflicts
accumulated.

- **Backend**: `/api/impact/contradictions` now emits `activeConflicts:
  [{edge, from_decision, to_decision}]` for `rel='contradicts'` edges
  where neither side is deprecated. New `PATCH /api/ledger/link/:id`
  accepts `{rel, note}` for in-place edge updates (used by the
  "Mark as evolution" action).
- **Frontend**: new `ResolveConflictCard` component renders both
  decisions side-by-side with five resolution actions:
  - **Deprecate A** / **Deprecate B** — mark one side `lifecycle: 'deprecated'`
  - **Evolution: A → B** — change edge `rel` from `contradicts` to `replaced`
  - **B → A** — same direction flipped (delete + re-create with swapped from/to)
  - **Keep both** — delete the edge (false positive)

Cards render in a new "Active conflicts (N)" panel above the historical
counter row in `ContradictionsView`.

### Tier-4 polish wins (10 items)

| # | Where | What |
|---|---|---|
| #312 | Conflicts empty-state | Real-codebase example patterns ("REST vs GraphQL", "v3 vs v4 unmarked", cross-project opposing paths) |
| #324 | Holes copy | "1 have disconnected sub-clusters" → "1 has..." (single-fragment grammar fix) |
| #255 | Fleet heat tiles | Hover tooltips spell out Active/Recent/Dormant thresholds |
| #256 | Fleet card sort | New sort pills: Heat (default) / Recency / Decisions / Tasks / A→Z, persisted in localStorage |
| #269 | Fuel session history | Burn bars now use INVERTED color scale (high burn = red, low = green) — was using the fuel-remaining scale, exact opposite semantic |
| #281 | Graph Overview By-Project | Sort pills: Count ↓ (default) / A→Z / Count ↑ |
| #282 | Graph edge-type legend | Hover tooltips explain semantic meaning of each rel type (sourced from new `EDGE_STYLES.tooltip` field) |
| #291 | Blast Radius | Collapsible "ⓘ What is Blast Radius?" info banner explaining purpose + workflow |
| #303 | Centrality columns | Sortable headers via new `SortableHeader` component: ID / Centrality / WoW (click to sort, click again to flip direction) |
| #367 | Log icons | Disambiguation pass: `task_moved` Compass → ArrowRightLeft (was clashing with Command tab nav), `auto_summary` BookOpen → ScrollText, `session` BookOpen → Hourglass, `predict` AlertTriangle → Sparkles. Each type now has a distinct silhouette. |

### Tests

- `tests/routes.test.ts` adds 1 spec for `PATCH /api/ledger/link/:id`
  (rel update + invalid-rel rejection + 404 for missing edge)

### Files touched

- `server/db/store.ts` — file watcher (init, debounce, mtime guard, hook)
- `server/dashboard.ts` — removed manual watcher, added hook callback
- `server/routes/impact.ts` — `activeConflicts` in /contradictions
- `server/routes/ledger.ts` — `PATCH /link/:id` endpoint
- `client/src/hooks/useApi.js` — `updateEdge`, `removeEdge`, `updateDecision`
- `client/src/lib/theme.js` — `EDGE_STYLES.tooltip` per rel type
- `client/src/modules/Graph.jsx` — `ResolveConflictCard`, examples copy,
  Holes copy fix, By-Project sort, edge legend tooltips, Blast info
  banner, sortable Centrality headers
- `client/src/modules/Fleet.jsx` — heat tooltips, sort-mode pills
- `client/src/modules/Fuel.jsx` — `burnBarColor`, `Bar` `invert` prop
- `client/src/modules/Log.jsx` — `TYPE_CONFIG` icon disambiguation
- `tests/routes.test.ts` — PATCH /link/:id spec
- version files + this CHANGELOG

### What's next

This is the last traditional dock. The Continuous Handover (v4.6.0 #398)
is the canonical mechanism going forward — `nexus_update_handover` writes
the live card; the next instance reads it via `nexus_brief` auto-prepend
or the Handover tab.

Remaining backlog: 5 deferred Tier-3 (#240, #301, #310, #332, #363), 1
structural carry-over (#217 split files + #219 Zod), ~13 Tier-4 polish.

## v4.6.4 — Hotfix: Double-Stringified POST Bodies

User-reported: clicking "Scan for contradictions" on the Conflicts tab 400'd
with `SyntaxError: Unexpected token '"', "{\"max_pa..." is not valid JSON`.
**231 → 282 tests · 29 tools · no schema/migration changes.**

**Root cause**

Two `useApi.js` methods pre-stringified their body before handing to
`request()` — which then stringified AGAIN, producing a JSON-encoded string
instead of a JSON object. body-parser saw `'"{\"max_pairs\":...}"'` and
correctly rejected it.

```js
// Pre-fix:
scanContradictions: (opts = {}) => request('/overseer/scan-contradictions', {
  method: 'POST', body: JSON.stringify(opts),  // ← request() stringifies again
}),
// Same bug in linkDecisions (FlagContradictionForm path — never tested via UI).
```

**Fix**

Pass plain objects; let `request()` handle the single stringify pass:

```js
scanContradictions: (opts = {}) => request('/overseer/scan-contradictions', {
  method: 'POST', body: opts,  // ← single-stringify in request()
}),
linkDecisions: ({ from, to, rel = 'related', note = '' }) =>
  request('/ledger/link', { method: 'POST', body: { from, to, rel, note } }),
```

**Regression guard**

`tests/routesUncovered.test.ts` adds a spec posting a real object body
to `/api/overseer/scan-contradictions` and asserting the response is NOT
a body-parser 400. Catches the same class of bug if anyone re-introduces
the pre-stringify pattern.

**Files touched**

- `client/src/hooks/useApi.js` — drop pre-stringify on both methods
- `tests/routesUncovered.test.ts` — regression guard
- `package.json`, `cli/package.json`, `mcpb/manifest.json`, `CHANGELOG.md`, `ROADMAP.md` — bumps

## v4.6.3 — Orphan Resolution + Reference-Layer Honesty

User-driven follow-up to v4.6.2. The post-cleanup orphan count was 35
"orphans" — but **32 of those were intentional reference imports** (cc-memory)
that the design says should NOT be in the typed graph. This release fixes the
metric to be honest, prevents auto-link from polluting the graph with
false-positive `led_to` chains across reference imports, and links the 3
real orphans to their natural parents. **281 tests · 29 tools · no
migrations · no breaking changes.**

**The metric problem**

Before v4.6.3, the Holes view + Overseer risk scanner counted every decision
without graph edges as an "orphan", including the cc-memory reference layer
(imported with `autoLink: false` by design). This inflated the metric and
hid the actual graph fragmentation:

| | Pre-v4.6.3 | Post-v4.6.3 |
|---|---|---|
| Reported "orphans" | 35 | **3 → 0** |
| Actual graph orphans | 3 | 0 |
| Reference imports | counted | excluded (correct layer) |

**Code changes — exclude `lifecycle=reference` everywhere it inflates signal**

- `server/routes/impact.ts /holes` — `getAllDecisions().filter(d => d.lifecycle !== 'reference')` before the union-find pass.
- `server/routes/overseer.ts /risks` — `orphanCount` calc same filter; the orphans-risk message now reflects real fragmentation.
- `server/routes/ledger.ts /auto-link` — pool excludes reference decisions. **This was the bigger fix**: a dry-run preview showed auto-link would have generated 45 `led_to` edges chaining cc-memory imports as a temporal sequence ("Level Magazine → Fedora Dual-Boot → DIREWOLF system info..."), all of which are semantically wrong. Now the auto-link tool stays in the typed-graph layer.

**Manual links applied to the live store** (the 3 real orphans found):

- `#158` "P1 TypeScript any reduction reached practical zero (262 → 4, 98.5%)" — `led_to → #159` "v4.3.5 polish pile closed" (the achievement is what #159 documents)
- `#157` "Decision records in The Ledger are historical references" — `informs → #59` "The Ledger is the strategic memory layer" (#157 informs how to read entries)
- `#76` "Captain says go bigger — burn rate is efficient enough for medium-large tasks" — `related → #3` "weekly fuel identified as tighter constraint" (both about pacing work against fuel)

After: **0 active/proposed orphans in Nexus**. The 32 cc-memory imports stay as a clean reference layer, properly tagged + lifecycle-marked but not muddying the typed graph.

**Tests added**

`tests/routes.test.ts` — 1 new spec verifying `/api/impact/holes` excludes
`lifecycle=reference` from the per-project decision count.

**Files touched**

- `server/routes/impact.ts` — reference filter on `/holes`
- `server/routes/overseer.ts` — reference filter on orphan risk count
- `server/routes/ledger.ts` — reference filter on auto-link pool
- `tests/routes.test.ts` — new spec
- `package.json`, `cli/package.json`, `mcpb/manifest.json`, `CHANGELOG.md`, `ROADMAP.md`

## v4.6.2 — Knowledge Graph Hygiene

Audit of the live decision/tag knowledge graph found 4 issues; this release
fixes 3 with code-side migrations (so the store-reload race that undid v4.5.8
can't undo them again) and patches the source code so future imports don't
re-introduce the problems. **264 → 280 tests (+16) · 29 MCP tools · 2 new
migrations · no breaking changes.**

**The audit findings**

- **Phantom projects re-emerged after v4.5.8**: `general` had 39 decisions
  (was 1), `claude` had 9 (was 0 — re-renamed to family-coop), `claude-md`
  had 5 new (synthetic-project leak from `inferProject` DIR_HINTS).
  Root cause: v4.5.8 was a one-shot script, not a code migration; the
  running dashboard's in-memory data later flushed back to disk.
- **Path-encoded "tags"**: 6 unique × 30 uses of `'C--*'` strings (Windows-
  encoded directory names) had been added as decision tags by the
  `importCCMemory` codepath — polluting the tag namespace with metadata.
- **Edge-graph itself**: PERFECT (0 dangling endpoints, 0 self-loops, 0
  non-canonical rels, 0 duplicates). v4.5.7-E1 still holding.

**Migration v4.6.2-D1** (idempotent, pattern-based for portability)

- `project='claude'` → `'family-coop'` when content matches Alpha/Beta
  protocol signals (`alpha|beta|outbox\.json|agent_alpha|agent_beta|
  profile\.json|conflict resolution|consent boundary|cooperative agent`)
- `project='claude-md'` → `'Nexus'` (treat as Nexus reference notes)
- `project='general'`:
  - `decision === '--help'` → DELETE (junk from CLI flag leak)
  - Content starts with `SR3`/`Shadowrun` → `'Shadowrun'`
  - Content matches `Firewall-Godot:` → `'Firewall-Godot'`
  - Content starts with `Noosphere` → `'noosphere'`
  - Has `cc-memory` tag → `'Nexus'`
  - Else: leave (truly miscellaneous, user can sort)
- All decisions: strip tags matching `/^[A-Z]--/` (path-encoded leakage)
- Sessions + thoughts: same project renames

**Migration v4.6.2-D2** (pattern expansion for stragglers)

- Broader regex catches Alpha/Beta decisions D1 missed
  (`relationship-first|secrets policy|coordination layer is shared|
  communication translation|agents (?:surface|communicate|preserve)|
  M:\\claude|\\\\192\.168\.1\.229`)
- Specific-string match: `Captain says go bigger.*burn rate is efficient`
  → `Nexus` (the v4.5.8-confirmed leftover)

**Source fixes (prevent recurrence)**

- `server/lib/memoryIndex.ts` — `DIR_HINTS` collapses `Claude-MD/i` and
  `C--Projects$/i` both into project `Nexus`. The synthetic `claude-md`
  project label is gone.
- `server/db/store.ts` — `importCCMemory` no longer adds `entry.encodedProject`
  to `tags`. The encoded path stays in `_memoryImports[path]` for dedup +
  audit, but doesn't pollute the tag namespace anymore.

**Live-store outcome (verified)**

| Project | Before | After | Δ |
|---|---|---|---|
| Nexus | 86 | **113** | +27 |
| Firewall-Godot | 24 | 30 | +6 |
| Shadowrun | 18 | 23 | +5 |
| noosphere | 8 | 13 | +5 |
| family-coop | 1 | **10** | +9 |
| general | 39 | **0** | −39 |
| claude | 9 | **0** | −9 |
| claude-md | 5 | **0** | −5 |
| **Path-encoded tags** | 6 unique / 30 uses | **0** | scrubbed |

Plus 1 junk decision (`#81 '--help'`) deleted.

**Test additions**

`tests/graphHygieneMigration.test.ts` — 16 specs covering rename rules,
content-pattern reassignment, junk deletion, tag scrubbing, session +
thought renames, migration stamping, and idempotency.

**Out of scope (separate task)**

- The store-reload race itself (in-memory flush overwriting on-disk edits)
  needs its own fix — file-watcher on `nexus.json` or single-writer lock.
  Tracked as a follow-up; this release prevents the symptom by making
  cleanup code-side instead of script-side.

**Files touched**

- `server/db/store.ts` — D1 + D2 migrations, `importCCMemory` tag fix
- `server/lib/memoryIndex.ts` — `DIR_HINTS` consolidation
- `tests/graphHygieneMigration.test.ts` — NEW (16 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json`, `CHANGELOG.md`,
  `ROADMAP.md` — version bumps

## v4.6.1 — Overseer Sweep + Route Tests

Five-item Overseer-themed batch closing one structural carry-over (#218),
one already-done Tier-3 (#239 verified), and three Tier-4 polish items
(#351/#352/#353). **231 → 264 tests (+33 specs)** across the three
previously-uncovered route files. **29 MCP tools · no migrations · no
breaking changes.**

**#218 — Route tests for `github` / `overseer` / `webhooks`**

The audit's longest-deferred structural item. New file
`tests/routesUncovered.test.ts` covers all three route modules with
hermetic supertest fixtures. Highlights:
- `/api/overseer/risks` — shape contract, level-vocabulary, memory-threshold
  conditional behavior
- `/api/overseer/status`, `/ask` validation (400 missing question), `/ask/result/:id`
  404, `/scan-contradictions` no-AI fallback
- `/api/github/repos`, `/commits`, `/commits/:project` (path-traversal guard),
  `/commit` (validation + sanitization + nonexistent-project graceful failure),
  `/diff/:project`, `/sync`
- `/api/webhooks` GET/POST/DELETE/test/inbound — including the 4 GitHub event
  parsers (push, pull_request, release, unknown)

One test marked `.skip()` with a documentation note: the AI-dependent
`/ask` happy path can't run reliably in CI (depends on whether LM Studio
is up locally; when up the inference exceeds the per-test timeout).

**#239 — Memory/VRAM > 85% as Overseer risks** — closed as **already-done**.
v4.3.9 #341 implemented the exact 85%/95% thresholds; today's audit confirmed
the code matches the spec. No code change needed.

**#351 — Per-response metadata (latency · tokens · VRAM peak)**

New `askWithMeta()` wrapper around the existing `ask()` helper. Captures
`{latencyMs, tokens?, vramPeakMib?, model}` for each Overseer Q/A turn and
threads it through:
- `POST /api/overseer/ask` returns `meta` alongside `answer`
- Client `chatHistory[i].meta` rendered as a compact badge:
  `2.3s · 1247t · +480M`
- Tooltip spells out: `Latency: 2.3s · Tokens: 412 prompt + 835 completion = 1247 total · VRAM delta: +480 MiB during call · Model: gemma-4-31b`
- Token usage decoded from Anthropic, OpenAI-compatible (LM Studio), and
  Ollama response shapes
- VRAM "peak" computed as `vram_used at end − vram_used at start` from the
  GPU history slice (defensive: undefined if no GPU samples)

`ask()` itself is unchanged; only `/ask` uses the wrapper. Other call sites
(analysis, contradiction-scan, propose-edges) still get plain string returns.

**#352 — Question-input history (↑ arrow recall)**

The Ask-the-Overseer textbox now responds to:
- **↑** — recall previous user question (walks backward through `chatHistory`)
- **↓** — walk forward; at the end, restores the live draft buffer
- **Esc** — abort history nav, restore live draft
- **Type** — exits history mode (preserves the recalled question as the
  starting point for editing)
- Sending a question resets the cursor

State: `historyIdx` (-1 = live draft) + `draftBuffer` (preserves what was
typed before ↑). Placeholder updated to `(↑ recalls last question)`.

**#353 — Risk-category legend + manual Refresh trigger**

Risk Scanner panel header gains a `RefreshCw` icon button next to the
title that re-runs `/api/overseer/risks` without a full page reload.
A new collapsible `<details>` "Categories ▾" expands to a 2-column grid
showing all 8 risk categories with color-coded level dot + description:

```
● fuel        · session/weekly fuel low      ● memory      · system RAM ≥85%
● vram        · GPU VRAM ≥85%                ● stale       · project gone cold
● uncommitted · unsaved changes at risk      ● stuck       · task stuck in progress
● blocker     · session blocker logged       ● orphans     · graph fragmenting
```

Self-documenting — users no longer need to grep server code to understand
what triggers each risk.

**Files touched**

- `server/routes/overseer.ts` — `askWithMeta()` helper, `/ask` returns `meta`
- `client/src/modules/Overseer.jsx` — meta badge, ↑/↓/Esc input nav, Refresh
  button, categories legend
- `tests/routesUncovered.test.ts` — NEW (+33 specs)
- `package.json`, `cli/package.json`, `mcpb/manifest.json`, `CHANGELOG.md`,
  `ROADMAP.md` — version bumps

**What's next**

Tier 3 deferred down to **6 items** (#239 closed): #240, #301, #310, #311,
#332, #363. Tier 4: 23 polish items remaining. Structural carry-overs
(#217 split files, #219 Zod) untouched. The sliding fuel model + continuous
handover are settled; v4.6.x can be a small-batch polish track until the
next headline feature.

## v4.6.0 — Continuous Handover

The headline `#398` shipped. Per-project markdown card stored in Nexus
replaces the dated `HANDOVER-YYYY-MM-DD.md` workflow. Each instance writes
its handover before docking; the next instance reads it on session start
(auto-injected by `nexus_brief`). Two new MCP tools (27 → **29**); new
Handover dashboard tab with per-project cards; new `docs/ARCHITECTURE.md`
for slow-moving content. **231/231 tests · bundle 478KB (gzip 132KB).**

**The change**

- New schema field: `NexusData._handovers: Record<string, HandoverEntry>`
  (stored in `nexus.json`). `HandoverEntry: { content, updated_at, updated_by? }`.
- New store methods: `getHandover`, `getAllHandovers`, `setHandover`,
  `deleteHandover`.
- New REST routes (`server/routes/handover.ts`): `GET /api/handover` (all),
  `GET /api/handover/:project` (one), `PUT /api/handover/:project`,
  `DELETE /api/handover/:project`. Mirror in standalone `localApi.ts`.
- New MCP tools (28 + 29):
  - `nexus_read_handover(project)` → returns card, defaults to "Nexus"
  - `nexus_update_handover(project, content, updated_by?)` → writes/replaces
- `nexus_brief` extended: when a handover exists for the project, prepends
  it to the brief output so the next instance reads the live card before
  the structured tasks/sessions/risks block.
- Migration **v4.6.0-E1**: seeds the Nexus project's handover from a TL;DR
  template. Idempotent — won't overwrite user edits.

**Dashboard — new Handover tab**

`client/src/modules/Handover.jsx` — grid of cards, one per project
discovered from the fleet (plus any projects with handover but no fleet
card). Each card:
- Header: project name, "updated Nm/h/d ago · updated_by · N chars · N words"
- Soft-cap warning when content > 500 words
- Inline edit (textarea) with Save / Cancel
- Empty state with "Write first handover" affordance
- Refresh button at top-level

Wired into `App.jsx` nav as the 8th module (`shortcut: '8'`). Sidebar icon:
`book-marked`.

**docs/ARCHITECTURE.md (new)**

The slow-moving content that used to live in dated handovers — architecture
spine, recurring patterns, known issues + gotchas, commands/rituals, fuel
model, the v4.5.x → v4.6.0 arc. Update when patterns change, not per
release. The live per-project handover card is for live state only.

**Backwards compatibility**

- `_handovers` is additive — stores without it (i.e. before this release)
  load fine; the migration seeds Nexus's card on first run.
- Dated `docs/HANDOVER-YYYY-MM-DD.md` files stay in the repo as historical
  markers. New ones won't be created.
- All v4.5.x MCP tools unchanged. `nexus_brief` output gains a prepended
  handover block when one exists; existing consumers ignore it cleanly.

**Files touched**

- `server/types.ts` — `_handovers`, `HandoverEntry`
- `server/db/store.ts` — store methods + v4.6.0-E1 migration
- `server/routes/handover.ts` — NEW route module
- `server/dashboard.ts` — wires `/api/handover`
- `server/mcp/index.ts` — 2 new tool specs + handlers; `nexus_brief` prepend
- `server/mcp/localApi.ts` — standalone `/api/handover` shape
- `server/lib/version.ts` — `TOOL_COUNT_EXPECTED: 27 → 29`
- `mcpb/manifest.json` — version, long_description, +2 tool entries
- `mcpb/README.md`, `README.md`, `plugin/README.md`, `cli/nexus.js`,
  `CONCEPT.md`, `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`
  — count drift updates (27 → 29)
- `client/src/components/WelcomeScreen.jsx` — `TOOL_COUNT: 27 → 29`
- `client/src/hooks/useApi.js` — `getAllHandovers`, `getHandover`,
  `putHandover`, `deleteHandover`
- `client/src/modules/Handover.jsx` — NEW module
- `client/src/App.jsx`, `client/src/components/Sidebar.jsx` — 8th nav slot
- `docs/ARCHITECTURE.md` — NEW reference doc

**What's next**

The dated-handover lifecycle ends here. Next instance picking up Nexus dev
reads the live card via `nexus_brief`. Tier 2 = 0; 7 deferred Tier-3 items
still on the slate. Structural carry-overs unchanged (`#217` split files,
`#218` route tests, `#219` Zod).

## v4.5.12 — Hotfix: Residual Thursday Hardcodes

Audit of v4.5.11 found four places where the old Thursday-21:00 fallback
still leaked through after the sliding-window switch. **231/231 tests · 27
tools · no migrations · no breaking changes.**

**The four leaks**

1. **`DEFAULT_CONFIG` still defaulted to Thursday/21** — first-run stores
   would carry the legacy schedule even though Anthropic moved everyone
   to Saturday/10. New default: `weeklyResetDay: 6 (Sat), weeklyResetHour: 10`.
2. **`weeklyResetDay/Hour` weren't auto-derived from `weeklyResetTime`** — once
   the recorded reset passed, fallback would revert to whatever was on the
   config (Thursday for legacy stores). Now: every time
   `nexus_log_usage` records a `weekly_reset_in_hours` or `weekly_reset_at`,
   we also derive the day-of-week and hour from the resulting Date (in the
   user's timezone) and persist them — so the cycle continues correctly
   after the recorded reset expires.
3. **`clock.ts` calendar hardcoded `dayOfWeek === 4`** for the weekly-reset
   marker on the week-ahead strip. Now derives from `nextWeeklyReset.getDay()`.
4. **`clock.ts` calendar note hardcoded "Weekly fuel reset 21:00"**. Now
   derives the time string from `nextWeeklyReset` (e.g. "Weekly fuel reset 10:00").

**Verification**

- Test dashboard fed `weekly_reset_in_hours: 162` (next Sat 10am).
  Stored fields: `weeklyResetDay: 6, weeklyResetHour: 10` (auto-derived).
  Timing payload: `resetsAt: 'Sat 10:44 Europe/Prague', source: 'reported'`.
  Calendar week-strip marks Saturday with `isWeeklyReset: true` and note
  "Weekly fuel reset 10:44".

**Files touched**

- `server/lib/fuelConfig.ts` — DEFAULT_CONFIG flipped to Sat/10.
- `server/routes/usage.ts` — `weeklyResetDay/Hour` auto-derive on save.
- `server/mcp/localApi.ts` — same auto-derive in standalone path.
- `server/routes/clock.ts` — calendar marker + note + outdated comment.

**No new memory rule** — `feedback/usage_schedule.md` from v4.5.11 already
spells out the sliding model. This is purely the implementation matching
what the docs say.

## v4.5.11 — Sliding Weekly Window

Anthropic moved the weekly limit from a fixed Thursday-21:00-CET reset to a
per-user **sliding 7-day window** (confirmed 2026-04-25). Nexus's session
window already slid via the user-supplied `reset_in_minutes`; this release
brings the weekly window to parity. **231/231 tests green · 27 MCP tools ·
no migrations.**

**The change**

- New optional `weeklyResetTime: string` (ISO) on `FuelConfig`. When set, it
  IS the next reset and slides on every `nexus_log_usage` call that includes
  weekly timing. The legacy `weeklyResetDay/Hour` (Thursday 21:00) becomes
  fallback only — used pre-first-report or when the recorded reset has
  passed and no fresh reading exists.
- `nexus_log_usage` accepts two new args: **`weekly_reset_in_hours`** (relative)
  or **`weekly_reset_at`** (ISO). The relative form is the common case —
  user reads "Resets Sat 10:00 AM" off `https://claude.ai/settings/usage`,
  computes hours, passes them.
- `POST /api/usage` accepts the same. `localApi.ts` handles them in
  standalone mode.
- `getNextWeeklyReset(config)` prefers `config.weeklyResetTime` if it's in
  the future; falls back to the day-of-week + hour computation otherwise.
- `buildTimingInfo()` derives the `resetsAt` label from the actual next-reset
  Date (no more hardcoded "Thu 21:00"). Adds `source: 'reported' | 'estimated'`
  so the UI can distinguish.

**Why the change matters**

Pre-v4.5.11 Nexus's brief said "weekly resets Thursday 21:00 CET" regardless
of what the user actually saw on Anthropic's billing page. After Anthropic
moved to sliding, the brief drifted from reality — sometimes by days. The
SessionStart hook would inject "27% weekly remaining, Thursday reset" when
the actual reset was Saturday. Pacing decisions based on the wrong reset
made the brief actively misleading.

**No breaking changes**

The legacy `weeklyResetDay/Hour` fields stay on `FuelConfig` for backwards
compatibility. Stored values from earlier releases keep working until the
user logs a fresh reading with `weekly_reset_in_hours`.

**CC memory updated**

`feedback/usage_schedule.md` rewritten to reflect the sliding model, with
the new `nexus_log_usage` call shape and explicit "no more Thursday" note.

**Files touched**

- `server/types.ts` — `FuelConfig.weeklyResetTime?: string`
- `server/lib/fuelConfig.ts` — sliding-aware `getNextWeeklyReset`
- `server/routes/usage.ts` — accepts new args; derives `resetsAt` from next-reset
- `server/mcp/index.ts` — `nexus_log_usage` schema + handler
- `server/mcp/localApi.ts` — same shape in standalone mode
- `~/.claude/projects/C--Projects/memory/usage_schedule.md` — model rewrite

## v4.5.10 — Tier 3 Sweep

Eighteen Tier-3 items in a single pass across Graph (11), Overseer (3), Log (3),
and Pulse (1). Zero new MCP tools (still 27), zero new migrations, zero new
tests — all surface polish on existing endpoints plus a couple of thin new
routes. **231/231 tests green · bundle 468KB (gzip 129KB).**

**Graph — Overview (2)**
- `#279` Orphan count stat card is now clickable when orphans > 0, jumping
  straight to the Holes tab. Zero-state card stays decorative.
- `#280` Auto-link similarity threshold setting. New `AUTOLINK_THRESHOLD_*`
  controls backed by localStorage with a range slider in Overview. Advisory
  for now — server hookup queued as a follow-up; the surface matters today.

**Graph — Blast Radius (2)**
- `#289` Recent-analyses quick-pick chips, cached in localStorage (last 6).
  Populated automatically when an analysis completes; a "× clear" removes
  the cache.
- `#290` "Highly connected (from Centrality)" strip in the Blast empty state.
  Five one-click chips with top centrality IDs so users jumping from
  Centrality don't have to re-pick.

**Graph — Centrality (2)**
- `#300` Per-entry edge-type breakdown. `/api/impact/centrality` now returns
  `byType: { typed, keyword, semantic, manual }` per entry. UI renders four
  colored dots (amber / cyan / purple / gray) sized by count. Surfaces the
  signal-vs-noise ratio at a glance.
- `#302` Per-entry week-over-week delta. Response adds `priorTotal` (edges
  as-of 7 days ago) + `weeklyDelta`. UI shows ±N chip in green/red/muted.

**Graph — Holes (3)**
- `#320` Fragmentation score metric. Response adds `fragmentationScore`
  per project (0 = fully connected, 1 = every decision orphaned). Formula:
  `(components − 1) / (decisions − 1)`. Rendered inline on each fragmented
  card with severity color.
- `#321` "Auto-link all orphans" batch action. New `orphans_only=true` param
  on `POST /ledger/auto-link` restricts to decisions with zero edges. Two-
  phase UI: Preview (dry run, shows proposed edges + sample notes) then
  Commit. Activity stream logs the write.
- `#322` Cross-project link drill-down. New `GET /api/impact/cross-links/:a/:b`
  returns hydrated edge list with both endpoints. Pills in the "Cross-
  project links" section now expand to show the actual edges (rel type +
  decision titles) instead of just a count.

**Graph — Visual (1)**
- `#333` Filter-vs-highlight clarity. Project chips caption rewritten —
  previously ambiguous ("click to filter") now explicit: chips
  **hide/show** projects; search input **highlights**. Users kept asking
  which was which.

**Graph — MCP (1)**
- `#278` `nexus_link_decisions` suggests a more specific type when caller
  picks the generic `related`. The ledger is ~76% `related` edges today;
  the tool's response now nudges toward `led_to / depends_on / informs /
  supersedes / experimental` with brief semantics. No change to the write
  path.

**Overseer (3)**
- `#347` Per-bullet "→ task" conversion. In the RECOMMENDATIONS /
  ACTIONS / NEXT STEPS / PRIORITIES sections (regex-matched by title),
  every bullet gets a hover-revealed button that creates a Nexus task with
  the bullet text as title. Immediate feedback: ✓ task / err / busy.
- `#348` Inline commit-all affordance. When the analysis mentions
  "uncommit" or "commit", an `InlineCommitRow` appears under the analysis
  listing every fleet project with uncommitted changes as one-click commit
  buttons (reuses `/api/github/commit` via `api.commitProject`). Prompts
  for a message, shows inline success/failure.
- `#350` Export conversation as markdown. Button next to the "N questions
  asked" counter triggers a download of the full `chatHistory` as a
  `.md` file with Q/A sections. Uses `Blob` + `URL.createObjectURL`.

**Log (3)**
- `#361` Export activity as CSV / JSON / MD. Three small buttons in the
  time-range row; exports `filteredActivityAll` so current filters apply.
  CSV escaping handles quotes, commas, newlines.
- `#362` 24-hour heat strip. Tiny bar chart (24 hourly buckets) at the top
  of the activity view. Opacity scales with count; per-bucket tooltip.
  Quick density read without scrolling.
- `#364` Live-tail indicator. Green pulse when activity arrived in the
  last minute, amber for 1–10 min quiet, gray beyond. Re-ticks every 5s
  so the indicator ages visibly between WS messages.

**Pulse — CUDA Engine (1)**
- `#349` Overseer-VRAM badge. GpuPanel polls `/api/pulse/gpu` every 10s,
  matches known AI process names (`lm studio|ollama|koboldcpp|
  text-generation|llama`) against the `processes` list, and shows a
  "◈ lmstudio · 4.2 GB" chip in the CUDA Engine header. Tooltips spell
  out the Overseer-VRAM relationship.

**Deferred from the 25-item Tier 3 triage**

Seven items needed dedicated focus (M/L complexity, algorithm work, or
multi-step UX) and were explicitly deferred from v4.5.10:
- `#239` Memory/VRAM as Overseer risks (couples to risk pipeline)
- `#240` "Today" fusion view (big UX)
- `#301` Alternative ranking metrics — betweenness/eigenvector (algo)
- `#310` Semantic-opposition auto-suggest via embeddings (model plumbing)
- `#311` Conflicts structured resolution workflow (multi-step UI)
- `#332` Graph alternative layouts — hierarchical/circular/force-directed (algo)
- `#363` Log burst-grouping collapse (needs design)

These become v4.5.11 / v4.6 polish candidates.

**Backend changes**

- `server/routes/impact.ts` — centrality `byType/weeklyDelta/priorTotal`;
  holes `fragmentationScore`; new `/cross-links/:a/:b` endpoint.
- `server/routes/ledger.ts` — `auto-link` accepts `orphans_only=true`.
- `server/mcp/index.ts` — `nexus_link_decisions` appends edge-type
  suggestion when caller picks `related`.

**Client changes**

- `client/src/hooks/useApi.js` — `autoLinkOrphansPreview/Commit`, `getCrossLinks`.
- `client/src/modules/Graph.jsx` — threshold setting, orphan card link,
  Blast recent + highly-connected strips, Centrality byType + WoW columns,
  Holes fragmentation + auto-link batch + cross-link drill, Visual caption
  clarity.
- `client/src/modules/Overseer.jsx` — AnalysisBlock convert-to-task,
  InlineCommitRow, Export MD.
- `client/src/modules/Log.jsx` — live indicator, heat strip, export row.
- `client/src/modules/Pulse.jsx` — Overseer-VRAM badge in CUDA Engine header.

## v4.5.9 — Fleet Polish + Cascade Hygiene

Five Tier-2/3 items closing the Fleet-focused backlog plus two hygiene fixes
(#266 label SSOT, #360 Log display sanitize). One item closed as already-done
(#254). **231/231 tests green · 27 MCP tools · bundle 450KB (gzip 124KB).**
No new tools, no new migrations.

**Fleet (4 items)**

- `#248` Activity sparklines on project cards. `/api/pulse/projects` now emits
  `activity.daily: number[7]` (index 0 = 6 days ago, 6 = today). New
  `Sparkline` component in Fleet.jsx renders a 56×14 polyline with a last-day
  dot so "today" is visible even when the line ends at zero. Hidden for quiet
  projects; color picks up heat (green for hot, amber for warm).
- `#252` Staleness list unified. Previously titled "Project Staleness" but
  listed only non-card projects (nexus-client, level, direwolf, etc. — tracked
  via sessions/decisions but with no folder in PROJECTS_DIR). Relabeled to
  **"Other tracked projects"** with a subtitle spelling out what qualifies.
  Also now filtered to exclude any project already shown as a card, so there's
  no duplication with the grid above.
- `#253` Inline git actions (Diff / Commit) on cards with uncommitted changes.
  New `GET /api/github/diff/:project` returns `{files, stat, diff, truncated}`
  (diff capped at 64KB). **Diff** button toggles an expandable drawer under
  the card with the `--stat` summary + raw patch. **Commit** button prompts
  for a message (default `Nexus auto-commit`), reuses existing
  `POST /api/github/commit`, and shows success/failure inline. Closes the
  fleet-oversight loop without leaving the dashboard.
- `#254` **already done via v4.4.5 #380** (Network icon on each card jumps to
  Graph/Visual filtered to the project). Closed with no additional work.

**Hygiene (2 items)**

- `#266` Fuel label single source of truth. The "session window expired" copy
  fixed in v4.3.9 #234 lived in two files (ClockWidget, Fuel). Extracted to
  `client/src/lib/fuelLabels.js` with three exports (`SESSION_EXPIRED_SHORT`,
  `SESSION_EXPIRED_LONG`, `SESSION_EXPIRED_TOOLTIP`) so the two surfaces can't
  drift again. Also added the tooltip to ClockWidget — previously only Fuel
  explained *why* "window expired" doesn't mean "fuel paused".
- `#360` Log `(_project)` display sanitize. 11 historical activity entries
  carry `Session ended (_project)` from the pre-v4.3.9-H1 blank-project bug.
  Store keeps history immutable, so Log now applies a display-time
  `sanitizeMessage` helper that rewrites `(_project)` → `(—)` and bare
  `_project` → `(unknown)`. Applied at both the list render and the timeline
  item transform.

**Backend changes**

- `server/routes/pulse.ts` — per-project `activity.daily[7]` array in
  `/api/pulse/projects`.
- `server/routes/github.ts` — new `GET /diff/:project` endpoint (`execFileSync`
  with argv to avoid injection; 64KB cap with truncation flag).
- `server/routes/ledger.ts`, `server/routes/impact.ts`, `server/mcp/localApi.ts`
  — no changes.

**Client changes**

- `client/src/hooks/useApi.js` — added `getGitDiff` + `commitProject`.
- `client/src/lib/fuelLabels.js` — new. Single source of truth.
- `client/src/modules/Fleet.jsx` — sparklines, inline git actions, staleness
  list rewrite.
- `client/src/components/ClockWidget.jsx` — import label constants.
- `client/src/modules/Fuel.jsx` — import label constants.
- `client/src/modules/Log.jsx` — `sanitizeMessage` helper + two call sites.

**What's next**

Tier 3 long tail (Centrality #300s, Holes #320s, Conflicts #310s, Blast
#289/#290, Log #361-#364, Overseer export #347-#350, Today fusion #240) —
orthogonal to v4.6. `#398` Continuous Handover is the natural v4.6 headline.

## v4.5.8 — Graph Polish II + Data Hygiene

Two Graph drilldowns (Tier 2 batch) plus two user-reported hygiene fixes and a
live-store cleanup. No new tests (but 231/231 still green); no new tools (still 27).

**Graph (2 items — closes Tier 2 drilldowns for Visual + Holes)**
- `#318` Holes: inline mini node-link viz per cluster. `/api/impact/holes` now
  emits `edges: [{from, to, rel}]` per cluster (intra-cluster only). A new
  `ClusterMiniViz` component renders a 180×100 SVG with deterministic circle
  layout and rel-typed edge colors. Non-orphan clusters only; orphans keep the
  existing "Link →" shortcut. Clicking a node jumps to Visual tab with that
  decision focused.
- `#328` Visual tab: click-to-detail side panel grew from thin metadata pill to
  a real drilldown. `/api/ledger/:id/connections` now includes `linkedTasks:
  [{id, title, status, priority}]`. Panel fetches on selectedId change with
  race-guarded `useEffect` and renders: full decision text (not truncated),
  project + lifecycle + `last_reviewed_at`, tag pills, edges **grouped by rel
  type** (led_to/depends_on/contradicts/informs/experimental/replaced/related
  with per-group counts), and linked tasks. Width 256 → 288px, max-height
  400 → 600px.

**User-reported fixes (2)**
- Client route rename `/api/memory` → `/api/cc-memory` in
  `client/src/hooks/useApi.js`. Dashboard Command tab was throwing
  `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` because the two
  Memory Bridge call sites disagreed with the canonical server mount path
  (confirmed against `server/dashboard.ts`, `localApi.ts`, MCP `nexusFetch`,
  CHANGELOG, and the `cc-memory` tag convention). Express fell through to
  the SPA catch-all. Same shape-drift family as the v4.5.6 `nexus_search`
  hotfix.
- `/api/pulse/projects` regression fix. Post-cleanup activity entry had
  `text:` instead of the canonical `message:` key; `pulse.ts:59` does
  `.message.toLowerCase()` over every row so the one malformed entry 500'd
  the endpoint. Entry repaired in place with correct shape plus `[Nexus]`
  prefix so the project-card substring match counts it. Lesson captured in
  CC memory (`feedback_nexus_store_shape.md`): sample existing keys or call
  `store.addActivity()` from a script that imports NexusStore — don't hand-
  construct entries.

**Data cleanup (live store, not a code migration)**
- Phantom project buckets eliminated. `claude` → `family-coop` (9 ledger + 2
  sessions — all Alpha/Beta agent-protocol content). `general` ledger split
  by content: 5 Shadowrun (SR3 Digital Table), 6 Firewall-Godot, 5 Noosphere,
  1 Nexus, 1 deleted (`#81` was literal `--help` junk). `general` sessions
  (18) → all Nexus. `general` thoughts (1) → deleted (stale auto-resolve
  test stub). Stamped `_appliedMigrations['data-phantom-projects-2026-04-22']`;
  backup at `~/.nexus/nexus.json.bak-phantom-projects-20260422-111625`.
  Script preserved at `scripts/migrate-phantom-projects.mjs` for audit trail.

**v4.6 queued**: Task `#398` — Continuous Handover. Replaces dated
`HANDOVER-YYYY-MM-DD.md` files with a live per-project handover card stored in
Nexus (two new MCP tools: 28 + 29) + a slow-moving `docs/ARCHITECTURE.md` for
architecture/gotchas/rituals. Removes the duplication between markdown
handovers and Nexus state that's already auto-injected via SessionStart.

**Tests:** 231/231 green. **Tools:** 27. **Bundle:** 445KB (gzip 122KB,
+3KB for both Graph features).

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

## v4.5.7 — Graph Batch + Command Tier 3

11 long-queued UI-audit items across Graph + Command. No breaking changes.
Plus one data-hygiene migration (`v4.5.7-E1`).

**Graph (6 items)**
- `#276` Edge-type enum hygiene: 5 orphan rels (`supports/enables/implements/embodies`)
  were in historical data but not in the `GraphEdge.rel` union. New migration
  `v4.5.7-E1` remaps them to `related` and preserves provenance in the edge note.
- `#275` Conflicts stat-card zero-state: "All clear" (green, reassuring) →
  "None flagged yet" (dim, honest) when decisions ≥ 10. Prevents false
  reassurance: 162 decisions with zero `contradicts` edges usually means
  nobody has flagged any, not that nothing conflicts.
- `#274` Edge-type counts clickable: each row in OverviewView's Edge Types
  panel expands inline to show a sample of 8 edges with decision endpoints
  + note snippets. Full paginated drill-down with bulk ops remains a
  follow-up; this closes the "dead number" UX.
- `#297` Centrality project color-bar: 1px left-edge stripe colored by
  project (from `PROJECT_PALETTE`) so the top-15 list scans by domain
  without reading every line.
- `#299` Centrality project filter: filter chips above the list, "All"
  + one per represented project. Dynamic — only rendered when ≥ 2
  projects are in the data. Resets page to top-15 on filter change.
- `#288` Blast Radius pre-submit preview: when a valid decision ID is in
  the textbox but Analyze hasn't been clicked, render "Will analyze:
  [decision text]" in a blue-tinted preview panel below the input. Uses
  already-loaded `graph.nodes` so no extra fetch.

**Command Tier 3 (5 items)**
- `#226` Overseer risks surfaced on Command as dismissible cards between
  the view header and the Now/Next/Later/Done grid. Fetched from
  `/api/overseer/risks` (cheap heuristic scan, no AI inference).
  Per-risk dismissal persists in localStorage.
- `#228` Memory Bridge UI affordance: header chip shows "Memory Bridge:
  imported/total" with inline [dry run] and [import] buttons when new
  memories exist. Fresh result ("+N imported") flashes for 5s after.
- `#229` Done items augmented with estimated fuel cost (`~N% fuel` in
  dim amber). Derived from `estimateMinutes(title)` × `fuel.rates.sessionPerHour`.
  Test delta + commit SHA deferred — need cross-data plumbing beyond
  this batch's scope.
- `#231` Gap cards hover preview: full `reason` text + linked decision
  ID (when present) shown in the native `title` tooltip. Zero extra
  fetches; `cursor-help` + amber-border hover signals interactivity.
- `#241` Activity Digest drill-downs: busiest-day, blockers count, and
  sessions count are now clickable — each navigates to the Log view.
  `Pulse` passes `onNavigate` through to `DigestWidget`.

228 → **231 tests** (+3 from v4.5.6 regression guard, none new here). 27 MCP tools.

## v4.5.6 — Hotfix: `nexus_search` in standalone mode

**User-visible symptom**: `nexus_search` in Claude Desktop returned "No results"
for every query, across every project. The dashboard SearchModal worked fine.

**Root cause**: `/api/smart-search` on the full dashboard returns
`{ query, method, results, stats }`. The MCP `nexus_search` handler reads
`data.results`. But in **standalone mode** (how the MCPB runs inside Claude
Desktop), `server/mcp/localApi.ts` was returning a flat array from
`store.search(q)` for BOTH `/api/search` and `/api/smart-search` — so
`data.results` was always `undefined` → `|| []` → zero hits. Regression
dated back to when `/api/smart-search` was introduced alongside the plain
`/api/search` (dashboard UI continued to work because it hits `/api/search`
which correctly returns the flat array).

**Fix**: split the two paths in `localApi.ts`:
- `/api/search` → unchanged flat array (dashboard SearchModal contract)
- `/api/smart-search` → `{ query, method: 'keyword', results, stats: { total } }`
  (MCP `nexus_search` contract)

**Regression guard** (`tests/localApiSearch.test.ts`): three new specs lock
both shapes, including an empty-query edge case. Any future refactor that
accidentally collapses them fails CI instead of silently producing the same
"No results" issue.

**Tests:** 228 → **231** (+3).

## v4.5.5 — Command Polish II

Eight Tier 2/3/4 polish items from the long-queued Command-view audit batch.
No breaking changes. Visible-on-every-session surfaces get cleaner.

**Tier 2 (Command view anticipation)**
- `#223` Auto-generate Session Plan on mount when cache is missing or stale
  (>1h old). Silent auto-fetch; manual Refresh button preserved. Closes
  "passive feature that should feel anticipatory" friction.
- `#224` Cross-project distribution strip at top of Later panel — horizontal
  proportional bars showing fleet shape at a glance, click-to-toggle group
  expansion. Replaces the "+N more" fold with something legible.
- `#225` Staleness badges on each project group header. "today" (green),
  "Nd ago" colored by age (neutral/amber/red). Derived from max task
  `updated_at` per group; no extra fetch.

**Tier 3**
- `#227` Thought Stack actions — pop (top-of-stack only) and abandon (any
  entry) now inline on the Command-view thought rows. Hover reveals actions
  so the panel stays quiet when you're not triaging. "+N more" footer points
  at the Ctrl+T modal for deeper stacks.

**Tier 4**
- `#230` Live feed scrollable — was hard-capped at 4 visible rows; now shows
  up to 20 in a `max-h-48` scroll container. "N recent" header stamp.
- `#232` New-events-since-last-view badge — stores last-seen activity id in
  `localStorage`, diffs against current slice on mount, renders "◈ N new
  events" in the header (dismissible). Row-reveal animated.
- `#242` Fuel freshness stamp rewording — "Nm since report" → "read Nm ago"
  (matches how users think about the delta). Richer tooltip explains
  static-snapshot semantics. "fresh" threshold tightened from 15m → 10m.
- `#244` CUDA Engine panel — Core clock / VRAM clock / Fan collapsed into
  a `Details` toggle. Power stays visible at-a-glance; full depth one click
  away.

228 tests. 27 MCP tools.

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
