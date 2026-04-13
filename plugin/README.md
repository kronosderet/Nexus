# Nexus — The Cartographer

AI Cowork metabrain for Claude Code. Persistent session memory, Knowledge Graph, Thought Stack, Fuel Intelligence, and a local AI Overseer that reads your codebase.

## What it does

Nexus gives Claude Code a persistent brain across conversations:

- **Session Memory** — every conversation is automatically logged (decisions, blockers, outcomes)
- **Knowledge Graph** — 5 typed edge relationships between architectural decisions (led_to, depends_on, contradicts, replaced, related) with blast-radius analysis
- **Thought Stack** — LIFO interrupt-recovery memory. Push before switching context, pop when you return.
- **Decision Guard** — redundancy check before creating tasks or decisions
- **Fuel Intelligence** — tracks Claude usage, burn rates, and session planning
- **Self-Critique** — identifies slow tasks, stuck items, completion patterns
- **Local AI Overseer** (optional) — strategic analysis via LM Studio / Ollama with 200k context

## Install

```bash
/plugin marketplace add kronosderet/Nexus
/plugin install nexus@nexus-marketplace
```

## Available tools (22)

**Read:** nexus_brief, nexus_get_plan, nexus_check_guard, nexus_search, nexus_get_critique, nexus_predict_gaps, nexus_get_blast_radius, nexus_ask_overseer

**Write:** nexus_create_task, nexus_complete_task, nexus_log_activity, nexus_log_session, nexus_log_usage, nexus_record_decision, nexus_update_decision, nexus_link_decisions, nexus_push_thought, nexus_pop_thought

**Async AI:** nexus_ask_overseer_start, nexus_get_overseer_result

**Composite:** nexus_bridge_session, nexus_fleet_overview

## Skills

- `/nexus-brief` — full metabrain state
- `/nexus-plan` — AI session plan
- `/nexus-audit` — code audit via local AI
- `/nexus-status` — quick 3-line status
- `/nexus-health` — installation verification
- `/nexus-dashboard` — launch visual dashboard

## Data

All data stored at `~/.nexus/nexus.json` with automatic backup rotation (3 generations). No cloud, no external services. Your data stays on your machine.

## Local AI (optional)

For AI-powered features (Overseer, session plan, code audit), install [LM Studio](https://lmstudio.ai) and load a model. Recommended: Gemma 4 26B A4B (Q4_K_M). Nexus auto-detects LM Studio at `localhost:1234`. Without it, all non-AI tools still work normally.

## Privacy

Nexus stores all data locally at `~/.nexus/`. No data is sent to external servers. The MCP server runs in-process — no network calls except to the optional local AI model at localhost. See [PRIVACY.md](PRIVACY.md) for details.

## Examples

### Example 1: Start a work session
```
User: /nexus-brief
Claude: [calls nexus_brief] Shows fuel state, active tasks, recent sessions, key decisions, risks.
```

### Example 2: Track a decision
```
User: Let's use PostgreSQL for the session store instead of SQLite
Claude: [calls nexus_record_decision with decision text + rationale]
  Decision #42 recorded. Auto-linked to 3 related decisions via keyword overlap.
```

### Example 3: End-of-session handoff
```
User: Let's wrap up
Claude: [calls nexus_bridge_session] Generates AI summary, pushes handoff thought for next instance.
  Next session will automatically see what we did and where we stopped.
```

## Support

Issues: https://github.com/kronosderet/Nexus/issues
