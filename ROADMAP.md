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

## Current — v4.2

### Dashboard Polish
- Shared React state (modules fetch independently, should share)
- Log module: debounced session search

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
