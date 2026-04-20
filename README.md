# ◈ Nexus — The Cartographer

**AI Cowork Metabrain for Claude Code**

A local-first metabrain that gives every Claude Code instance persistent memory, a Knowledge Graph, and a strategic AI advisor. 27 native MCP tools. Ambient-telemetry hook layer injects rich context on every session start. Zero cloud dependencies.

## Install as Claude Code Plugin

```bash
/plugin marketplace add kronosderet/Nexus
/plugin install nexus@nexus-marketplace
```

That's it. Every conversation now has access to the Nexus metabrain.

## Getting Started (First 5 Minutes)

After installing, just **talk to Claude Code normally**. Nexus works in the background:

1. **Session starts** → Nexus auto-injects your project context (tasks, decisions, recent sessions)
2. **You work** → Claude uses Nexus tools naturally when relevant
3. **Session ends** → Nexus auto-logs what happened + pushes a handoff for the next conversation

**Try these prompts to see it in action:**

```
"What's the current state of my project?"     → triggers nexus_brief
"Remember this decision: we chose X because Y" → triggers nexus_record_decision
"Create a task for fixing the auth bug"        → triggers nexus_create_task
"What did we do last session?"                 → triggers nexus_search
"What should I work on next?"                  → triggers nexus_get_plan (needs LM Studio)
"Wrap up this session"                         → triggers nexus_bridge_session
```

Or use slash commands directly: `/nexus-brief`, `/nexus-status`, `/nexus-plan`

**No configuration needed.** Data is stored at `~/.nexus/nexus.json`. No server to run. No accounts. Everything local.

## What It Does

Nexus solves the biggest problem with AI-assisted development: **Claude forgets everything between conversations.** Nexus doesn't.

- **Session Memory** — every conversation is automatically logged with decisions, blockers, and outcomes
- **Knowledge Graph** — 160+ architectural decisions with 7 typed edges (led_to, depends_on, contradicts, replaced, related, informs, experimental), blast-radius analysis, and cross-tab navigation (Centrality → Blast Radius, Visual focused on node)
- **Thought Stack** — push context before interruptions, pop when you return. Works across Claude instances.
- **Decision Guard** — checks for redundant work before you start
- **Fuel Intelligence** — tracks Claude usage, burn rates, and session planning
- **Self-Critique** — identifies slow tasks, stuck items, completion patterns
- **Local AI Overseer** (optional) — strategic analysis via LM Studio with up to 200k context

## 27 Native MCP Tools

After installing, Claude Code can call these directly — no shell-outs, no CLI:

**Read:** `nexus_brief`, `nexus_get_plan`, `nexus_check_guard`, `nexus_search`, `nexus_get_critique`, `nexus_predict_gaps`, `nexus_get_blast_radius`, `nexus_ask_overseer`, `nexus_version`

**Write:** `nexus_create_task`, `nexus_complete_task`, `nexus_log_activity`, `nexus_log_session`, `nexus_log_usage`, `nexus_record_decision`, `nexus_update_decision`, `nexus_link_decisions`, `nexus_push_thought`, `nexus_pop_thought`, `nexus_import_cc_memories`

**Async AI:** `nexus_ask_overseer_start`, `nexus_get_overseer_result`, `nexus_propose_edges`

**Composite:** `nexus_bridge_session`, `nexus_fleet_overview`, `nexus_calendar_runway`

## Dashboard (Optional)

The plugin works standalone — no server needed. For visualization, run the dashboard:

```bash
git clone https://github.com/kronosderet/Nexus
cd Nexus
npm install && cd server && npm install && cd ../client && npm install && npm run build && cd ..
npm run dashboard
```

Open [http://localhost:3001](http://localhost:3001). Seven modules:

| Module | Key | What it shows |
|---|---|---|
| **Command** | ^1 | Strategic view (Now/Next/Later/Done) + Kanban board with drag-drop |
| **Dashboard** | ^2 | System pulse, GPU telemetry, calendar, digest |
| **Fleet** | ^3 | Per-project cards: health, git, tasks, staleness, cross-project priority |
| **Fuel** | ^4 | Plan-aware session + weekly gauges, usage intensity, forecast, insights |
| **Graph** | ^5 | Knowledge Graph: blast radius, centrality, conflicts, holes, interactive visual |
| **Overseer** | ^6 | Local AI strategist with chat history + scheduled scans |
| **Log** | ^7 | Activity stream + Session history + Timeline view |

Plus: `Ctrl+K` search, `Ctrl+T` thought stack, `Ctrl+/` keyboard shortcuts.

## Claude Code Lifecycle Hooks

The SessionStart hook fires automatically and injects a rich ambient-telemetry
context block at the top of every new Claude Code conversation:

- **Project** auto-detected (CLAUDE.md marker → `package.json` → `git remote` → cwd), normalized through a canonical casing map
- **Fuel** — session + weekly percentages with freshness stamp ("read Nm ago") and stale warning when >2h old
- **Tasks** — in-progress items + backlog count + recovery of the top active thought via LIFO pop
- **Sessions** + **Key decisions** — last 3 sessions + 5 most recent decisions, project-scoped
- **Tests** — "N/N green" greped from the latest commit message
- **Git** — branch, uncommitted count, working-tree diff shortstat, commits since last Nexus session
- **Fleet uncommitted** — top-5 most-active projects' dirty working trees (bounded scan)
- **Overseer snapshot** — latest digest + risk scan if fresh (<24h)
- **Services** — parallel TCP probes for LM Studio (:1234), Ollama (:11434), Dashboard (:3001), Vite (:5173)
- **System** — memory pressure warning at ≥85% / ≥95%; `nexus.json` size + backup age
- **Chapter** suggestion — priority: resumed thought → in-progress task → default

Total hook latency under 100ms combined. All probes fail-silent — the hook never crashes session start.

Also: **UserPromptSubmit** (currently a no-op stub; reserved for semantic classification work), **Stop** (auto-generates session summary + pushes handoff thought for the next instance).

Install hooks: `nexus hooks install` (from the CLI).

## Local AI (Optional)

For AI-powered features (Overseer, session plan, code audit), install [LM Studio](https://lmstudio.ai) and load a model. Tested with Gemma 4 31B and Gemma 4 26B A4B (Q4_K_M). Nexus auto-detects LM Studio at `localhost:1234`. GPU-aware inference with AI semaphore — adapts to any hardware.

Without LM Studio, all 22 non-AI tools work normally (4 AI-dependent tools: `nexus_ask_overseer`, `nexus_ask_overseer_start`, `nexus_get_overseer_result`, `nexus_propose_edges` require a local model).

## Architecture

| Layer | Stack |
|---|---|
| MCP | 27 tools, stdio, standalone (no server needed) |
| Dashboard | React 19 + Vite + Tailwind CSS 4 (optional, 7 modules) |
| Server | Express 5 + TypeScript (dashboard only) |
| Store | JSON at `~/.nexus/nexus.json` (atomic writes, 3-gen backup, idempotent migrations) |
| AI | LM Studio / Ollama (optional, auto-detected, GPU-aware) |
| Scheduler | Risk scan (6h) + digest (24h), automated |
| Hooks | SessionStart ambient telemetry (12+ context injections), <100ms latency |
| Tests | 189 Vitest (store, routes, graph, CC scaffolding, estimator, memory bridge, hygiene migrations) |

## Data & Privacy

All data stored locally at `~/.nexus/`. No cloud, no external services, no telemetry. The MCP server runs in-process. The only network call is to the optional local AI model at localhost.

## CLI

```bash
nexus brief                       # full metabrain briefing
nexus task "Add caching layer"    # create a backlog task
nexus record "Switched to JSON"   # record a decision to the Ledger
nexus overseer "what's risky?"    # ask the local AI strategist
nexus hooks install               # install Claude Code lifecycle hooks
nexus mcp                         # print MCP server config
nexus help                        # full command list (46 commands)
```

## The Story

Nexus was built as an answer to: *"What tool would you want if you could build anything for your own development?"* It started as a dashboard, became an MCP server, then a Claude Code plugin with lifecycle hooks. The Overseer — a local AI model — audits its own source code and proposes fixes. The Knowledge Graph auto-links decisions by semantic similarity. The metabrain grows passively through hooks that fire on every conversation start and end.

The recursion is the real story. The tool that tracks decisions was built by an AI making decisions about itself, recorded in the tool it was building.

## Feedback & Contributing

Found a bug? Have an idea? Open an issue on [GitHub Issues](https://github.com/kronosderet/Nexus/issues).

Pull requests are welcome — especially for new skills, dashboard modules, or Overseer prompts.

## License

MIT — see [LICENSE](./plugin/LICENSE).
