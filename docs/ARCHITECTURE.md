# Nexus Architecture & Conventions

Slow-moving reference. Lives here so the per-session handover card can stay
short. Update when patterns change, not per release.

## Architecture spine

- **`server/db/store.ts`** — `NexusStore`. JSON file at `~/.nexus/nexus.json`
  (or `NEXUS_DB_PATH`). 6+ idempotent migrations stamped via
  `_appliedMigrations`. Single mutex for graph edges; everything else is
  effectively single-threaded by the JSON-flush pattern.
- **`server/mcp/index.ts`** — MCP tool specs + `handleTool` switch.
  ~1700L. `TOOLS[]` array is canonical; `mcpb/manifest.json` mirrors it.
  `TOOL_COUNT_EXPECTED` in `server/lib/version.ts` is the SSoT — drift test
  fails if any of the 12+ surfaces disagree.
- **`server/mcp/localApi.ts`** — standalone-mode HTTP adapter. Mimics the
  Express routes for MCP-only use. **Shape contract critical** — every new
  endpoint with both a dashboard route AND a localApi branch needs a
  regression spec (precedent: `tests/localApiSearch.test.ts`).
- **`server/lib/fuelConfig.ts`** — sliding-aware `getNextWeeklyReset`,
  `DEFAULT_CONFIG` (Sat/10:00 Prague). Plan multipliers in `PLAN_INFO`.
- **`server/routes/usage.ts`** — `buildTimingInfo()` is the single source of
  truth for session+weekly timing. Auto-derives day-of-week + hour fallback
  when storing `weeklyResetTime` so the cycle continues after expiry.
- **`server/routes/clock.ts`** — calendar week-strip. Reset marker derives
  from `nextWeeklyReset.getDay()`; never hardcoded.
- **`server/routes/impact.ts`** — centrality (with `byType/weeklyDelta/priorTotal`),
  holes (with `fragmentationScore` + per-cluster `edges`),
  `/cross-links/:a/:b` drill.
- **`server/routes/ledger.ts`** — `/:id/connections` returns
  `decision + connected + linkedTasks`. Auto-link supports `orphans_only=true`.
- **`server/routes/pulse.ts:59`** — iterates activity with
  `.message.toLowerCase()` dotted access. ANY malformed activity entry breaks
  `/api/pulse/projects` (lesson learned in v4.5.8).
- **`server/routes/github.ts`** — `/repos`, `/commits`, `/diff/:project`,
  `/commit`, `/sync`. All execFileSync with argv to avoid injection.
- **`server/routes/handover.ts`** — v4.6.0 #398. Per-project markdown cards.
- **`server/types.ts`** — central type defs. `FuelConfig.weeklyResetTime?: string`,
  `HandoverEntry`, `GraphEdge.rel` is a 7-type union.

## Client spine

- **`client/src/modules/Graph.jsx`** — biggest client file, ~2050L. Houses
  HolesView (ClusterMiniViz, fragmentation, batch auto-link, cross-link
  drill), VisualView (stateful fetch side panel, threshold setting),
  OverviewView (orphan link card), CentralityView (byType + WoW columns),
  BlastView (recent + highly-connected strips), ConflictsView,
  FlagContradictionForm.
- **`client/src/modules/Handover.jsx`** — v4.6.0 #398. Per-project cards,
  inline edit, character/word count + 500-word soft-cap warning.
- **`client/src/modules/Fleet.jsx`** — sparkline + inline git actions +
  staleness unify (v4.5.9). Network-icon Graph jump (v4.4.5).
- **`client/src/modules/Overseer.jsx`** — AnalysisBlock convert-to-task,
  InlineCommitRow, MD export (all v4.5.10).
- **`client/src/modules/Log.jsx`** — sanitizeMessage (v4.5.9), live-tail
  indicator + 24h heat strip + CSV/JSON/MD export (v4.5.10).
- **`client/src/modules/Pulse.jsx`** — Overseer-VRAM badge in CUDA Engine
  header (v4.5.10).
- **`client/src/components/ClockWidget.jsx`** — sliding-aware via
  `nextWeeklyReset`.
- **`client/src/lib/fuelLabels.js`** — single source of truth for fuel state
  copy (`SESSION_EXPIRED_*`).
- **`client/src/hooks/useApi.js`** — canonical client path list. Notable:
  `/cc-memory` not `/memory`, `/handover` for v4.6.0 cards.

## Recurring patterns

**Race-guarded `useEffect` fetch on selection change.** Capture a `cancelled`
flag; check before every `setState`; clean up on teardown. Prevents stale
responses overwriting fresh state when user clicks through quickly. See
VisualView side panel (Graph.jsx).

**Intra-cluster edge subset in parent response.** `/api/impact/holes` emits
per-cluster `edges` (only edges where both endpoints are in the cluster).
Reusable anywhere a parent response needs a "local subset of the full graph"
without the client recomputing.

**Deterministic circle layout for small graphs.** `theta = (i / size) * 2π - π/2`
— stable across renders, zero iteration cost, readable for N ≤ 10. Prefer
over force-directed for tiny SVGs. See ClusterMiniViz (Graph.jsx).

**Sparkline component.** 56×14 SVG polyline with last-day dot. Stable
deterministic shape from a fixed-length count array. Reusable for any
"trend in N buckets" UI. See Fleet.jsx `Sparkline`.

**Live-tail indicator.** Three-state pulse (live / quiet / stale) re-ticking
every 5s so age drifts visibly without WS hookup through the provider. See
Log.jsx `liveState`. Useful anywhere "is this thing fresh?" matters.

**Per-row dots breakdown.** Four colored dots sized by count. Compact way to
show breakdowns inline in dense lists. See Centrality `byType` (Graph.jsx).

**Auto-derive cycle from one observation.** When storing a sliding-window
target time, also derive the cyclic fallback (day-of-week + hour) so the
cycle continues after expiry. See `usage.ts` for weekly reset.

**Single source of truth for shared copy.** When a string drifts between
modules, extract to `client/src/lib/<feature>Labels.js`. Two precedents:
`fuelLabels.js` (v4.5.9), label imports in ClockWidget + Fuel.

**Display-time data sanitize.** For legacy bad data we can't (or shouldn't)
rewrite in place, scrub at render time. See Log.jsx `sanitizeMessage` for
the `(_project)` cleanup. Store stays immutable; UI never shows the bug.

**Drift guard on every count surface.** `tests/versionDrift.test.ts` scans
12+ files for "N native MCP tools" / "Available tools (N)" patterns and
fails when any disagree with `TOOL_COUNT_EXPECTED`. Add a new surface there
when adding a count claim.

**Sample shape before writing.** Before constructing any object to insert
into nexus.json arrays, sample `Object.keys(d.<array>[0])` OR prefer
`store.add*()` from a script that imports `NexusStore`. The Pulse projects
route iterates activity with dotted field access; one malformed entry 500s
the endpoint. CC memory: `feedback_nexus_store_shape.md`.

## Known issues + gotchas

1. **Dashboard does not hot-reload.** `npx tsx server/dashboard.ts` runs
   the source but caches modules. After server-side route changes, restart
   `npm run dashboard`.
2. **MCPB lags repo.** Installed bundle in Claude Desktop is a snapshot —
   reinstall after each release for `nexus_version` to report the new
   build and for new MCP args to work in standalone mode.
3. **Client bundle is served statically** from `client/dist/`. Client
   changes pick up on hard-reload after `npm run build` — no dashboard
   restart needed.
4. **Pre-existing `AIConnection` type drift** in `server/routes/overseer.ts`
   and `server/dashboard.ts` — ~9 errors. Visible via `npx tsc --noEmit -p
   server/tsconfig.json`. Pre-dates v4.5.x.
5. **Vitest workers eject under memory pressure** at 97%+ RAM. Individual
   test files always work; full `npm run test` may need a retry. OS-level,
   not a code issue.
6. **Cross-project tasks misfiled to Nexus** — ~15 tasks under `project='Nexus'`
   that are actually Firewall-Godot/Shadowrun/Level work. Survived the
   v4.5.8 phantom-project cleanup. Low priority; could be reassigned in a
   small data sweep.
7. **Auto-link similarity threshold (v4.5.10 #280) is advisory** — the UI
   slider persists in localStorage but the server's auto-link still uses
   its hardcoded threshold. Server hookup is queued.

## Commands / rituals

```bash
npm run test              # 231/231 expected green
npm run mcpb:pack         # Build bundle to mcpb/nexus.mcpb
npm run mcpb:test         # Smoke test — confirms tool count, self-cleans
npm run dashboard         # Dashboard on :3001
npm run dev               # Dashboard + Vite HMR (:5173)
npx tsc --noEmit -p server/tsconfig.json   # Pre-existing drift NOT from recent work
```

## Release ritual (11 steps, works well)

1. Close tasks · 2. Log session · 3. Version bump in 3 files (`package.json`,
   `cli/package.json`, `mcpb/manifest.json` — `version.ts` auto-syncs via
   JSON import) · 4. `npm run test` · 5. `npm run mcpb:pack` ·
   6. `npm run mcpb:test` · 7. Release commit · 8. Push main · 9. Tag +
   push tag · 10. `gh release create v<X> --latest ... mcpb/nexus.mcpb` ·
   11. Log `[deploy]` activity for the digest.

## Fuel model (sliding both ways since v4.5.11)

- **Session**: 5h sliding from first usage of the session. `nexus_log_usage`
  with `reset_in_minutes` sets `startTime=now, resetTime=now+N`.
- **Weekly**: 7d sliding (default Sat 10:00 Prague — Anthropic's current
  schedule). `weekly_reset_in_hours` or `weekly_reset_at` to record the
  user-reported next reset; `weeklyResetDay/Hour` auto-derived as fallback.
- **Always read fuel** from `https://claude.ai/settings/usage` at
  fresh-session start; never extrapolate. See
  `feedback_fuel_display.md` and `usage_schedule.md`.

## v4.5.x → v4.6.0 arc (compressed)

- v4.5.4–v4.5.7: Fuel correctness · Command Polish II · `nexus_search`
  hotfix · Graph Batch + Command T3
- v4.5.8: Graph Polish II + Data Hygiene (Tier 2 mostly closed +
  phantom-project cleanup)
- v4.5.9: Fleet Polish + Cascade Hygiene (Tier 2 = 0)
- v4.5.10: Tier 3 Sweep — 18 items in one pass
- v4.5.11: Sliding Weekly Window (`weeklyResetTime`,
  `weekly_reset_in_hours/at`)
- v4.5.12: Hotfix — 4 residual Thursday-21:00 hardcodes
- **v4.6.0 (current)**: Continuous Handover — replaces this whole
  dated-markdown pattern with a live per-project card stored in Nexus.

For per-release detail see `CHANGELOG.md`. For day-by-day handover history
see `docs/HANDOVER-*.md` (kept as historical markers; superseded by the
live Handover card going forward).
