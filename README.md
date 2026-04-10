# ◈ Nexus — The Cartographer

**AI Cowork Metabrain for Claude Code**

A local-first metabrain that gives every Claude Code instance persistent memory, a Knowledge Graph, and a strategic AI advisor. 20 native MCP tools. Zero cloud dependencies.

## Install as Claude Code Plugin

```bash
/plugin marketplace add kronosderet/Nexus
/plugin install nexus@nexus-marketplace
```

That's it. Every conversation now has access to the Nexus metabrain.

## What It Does

Nexus solves the biggest problem with AI-assisted development: **Claude forgets everything between conversations.** Nexus doesn't.

- **Session Memory** — every conversation is automatically logged with decisions, blockers, and outcomes
- **Knowledge Graph** — 90+ architectural decisions with typed edges (led_to, depends_on, contradicts, replaced, related) and blast-radius analysis
- **Thought Stack** — push context before interruptions, pop when you return. Works across Claude instances.
- **Decision Guard** — checks for redundant work before you start
- **Fuel Intelligence** — tracks Claude usage, burn rates, and session planning
- **Self-Critique** — identifies slow tasks, stuck items, completion patterns
- **Local AI Overseer** (optional) — strategic analysis via LM Studio with up to 200k context

## 20 Native MCP Tools

After installing, Claude Code can call these directly — no shell-outs, no CLI:

**Read:** `nexus_brief`, `nexus_get_plan`, `nexus_check_guard`, `nexus_search`, `nexus_get_critique`, `nexus_predict_gaps`, `nexus_get_blast_radius`, `nexus_ask_overseer`

**Write:** `nexus_create_task`, `nexus_complete_task`, `nexus_log_activity`, `nexus_log_session`, `nexus_log_usage`, `nexus_record_decision`, `nexus_link_decisions`, `nexus_push_thought`, `nexus_pop_thought`

**Async AI:** `nexus_ask_overseer_start`, `nexus_get_overseer_result`

**Composite:** `nexus_bridge_session`

## Dashboard (Optional)

The plugin works standalone — no server needed. For visualization, run the dashboard:

```bash
git clone https://github.com/kronosderet/Nexus
cd Nexus
npm install && cd server && npm install && cd ../client && npm install && cd ..
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Seven modules:

| Module | Key | What it shows |
|---|---|---|
| **Command** | ^1 | Strategic view (Now/Next/Later/Done) + Kanban board with drag-drop |
| **Dashboard** | ^2 | System pulse, GPU telemetry, calendar, digest, quick actions |
| **Fuel** | ^3 | Session + weekly fuel gauges, burn rate, workload planner |
| **Graph** | ^4 | Knowledge Graph: blast radius, centrality, conflicts, holes, visual |
| **Overseer** | ^5 | Local AI strategist with auto-remediation |
| **Log** | ^6 | Activity stream + Session history with search/filter |
| **Terminal** | ^7 | Embedded PowerShell shell |

Plus: `Ctrl+K` search, `Ctrl+T` thought stack, `Ctrl+/` keyboard shortcuts.

## Claude Code Lifecycle Hooks

Three hooks fire automatically:

- **SessionStart** — injects metabrain context (fuel, tasks, sessions, decisions, risks, git status)
- **UserPromptSubmit** — logs each prompt to the activity stream
- **Stop** — auto-generates session summary + pushes handoff thought for the next instance

Install hooks: `nexus hooks install` (from the CLI).

## Local AI (Optional)

For AI-powered features (Overseer, session plan, code audit), install [LM Studio](https://lmstudio.ai) and load a model. Recommended: Gemma 4 26B A4B (Q4_K_M). Nexus auto-detects LM Studio at `localhost:1234`. GPU-aware inference signal adapts to any hardware — no fixed timeouts.

Without LM Studio, all 20 non-AI tools work normally.

## Architecture

| Layer | Stack |
|---|---|
| Server | Express 5 + TypeScript (tsx watch) |
| Client | React 19 + Vite + Tailwind CSS 4 |
| Store | JSON file at `~/.nexus/nexus.json` (with 3-gen backup rotation) |
| AI | LM Studio / Ollama (optional, auto-detected) |
| MCP | 20 tools via @modelcontextprotocol/sdk, stdio transport |
| Tests | 153 Vitest tests (store + route-level integration) |
| CLI | 46 commands, ESM, zero external deps |

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

## License

MIT — see [LICENSE](./plugin/LICENSE).
