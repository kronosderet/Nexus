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

## Current — v4.3 (in flight)

### Philosophy pivot (Decision #144)
Nexus becomes the reasoning layer ON TOP of CC's native scaffolding (memory, plans, scheduled-tasks, chapters, spawn-task, hooks, skills) — not a parallel universe. Every v4.3 item buckets into HARMONIZE (integrate with CC), AMPLIFY (compose on top), or OWN (Nexus-unique).

### Shipped in v4.3
- **#205-#207 Housekeeping** — version bump 4.2.0 → 4.3.0, MCPB rebuild, digest filter case-insensitive + trim
- **#189 HARMONIZE: Plan Archaeology** — `nexus_brief` reads `~/.claude/plans/` and surfaces recent plans, project-filtered
- **#190 HARMONIZE: Kill redundant activity logging** — UserPromptSubmit hook now a no-op stub; CC session JSONL is the raw log
- **#191 AMPLIFY: Chapter Narrator (advisory)** — SessionStart hook emits `mark_chapter()` suggestions; `/nexus-brief` skill documents the convention
- **#195 OWN: Knowledge Graph v3** — 2 new edge types: `informs` (context without dependency), `experimental` (tentative, revisit). Graph visualizer updated with distinct styles.

### Queued for v4.3
- **#188 HARMONIZE: Memory Bridge** — read/write `~/.claude/projects/*/memory/` in brief + record_decision
- **#192 AMPLIFY: Thought Stack ⇄ spawn_task** — bidirectional
- **#193 AMPLIFY: Migrate Overseer scans to `mcp__scheduled-tasks__*`**
- **#194 AMPLIFY: Calendar-aware fuel**
- **#196 OWN+HARMONIZE: Overseer reads CC scaffolding** — plans, memory, session JSONLs
- **#197 OWN: KG auto-edge generation** — Overseer-powered edge suggestions beyond keyword/embedding overlap
- Remaining AI endpoint consolidation (ai.ts, plan.ts, autoSummary.ts, smartSearch.ts)
- Task project field support in Command/Kanban
- family-coop scheduled message checking

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
