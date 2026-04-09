# Nexus MCPB Extension — v3.3

One-click install of the Nexus metabrain into Claude Desktop.

## What this gives you (18 native MCP tools)

After installing, every Claude Desktop conversation has access to:

**Read tools:**
- `nexus_brief` — current state for a project (fuel, tasks, sessions, decisions, risks)
- `nexus_get_plan` — AI-generated session plan with fuel context
- `nexus_check_guard` — redundancy check before starting work
- `nexus_search` — smart hybrid (keyword + semantic) search across all entities
- `nexus_get_critique` — self-evaluation on task completion patterns
- `nexus_predict_gaps` — knowledge-graph gap detection (6 categories)
- `nexus_get_blast_radius` — downstream impact of a decision change
- `nexus_ask_overseer` — strategic Q&A against full metabrain context (local AI)

**Write tools:**
- `nexus_create_task` — create a backlog task
- `nexus_complete_task` — mark a task as done by id
- `nexus_log_activity` — log an activity entry
- `nexus_log_session` — log session summary with decisions, tags, files (memory bridge)
- `nexus_log_usage` — log fuel readings (session% + weekly% remaining)
- `nexus_record_decision` — write a strategic decision into The Ledger
- `nexus_link_decisions` — create typed edge between two decisions
- `nexus_push_thought` — push onto the interrupt-recovery stack
- `nexus_pop_thought` — pop the top thought (recover from interruption)

**Composite:**
- `nexus_bridge_session` — end-of-work ritual: auto-summary + handoff thought in one call

## Installation

Double-click `nexus.mcpb` and Claude Desktop will prompt you to install.

## Requirements

The Nexus HTTP server must be running locally. Start both servers:

```bash
cd C:/Projects/Nexus
nexus-dev.bat        # or: npm run dev
```

The MCPB defaults to `http://localhost:3001` but you can override `NEXUS_BASE_URL` during install.

## Architecture

This bundle contains a thin stdio adapter (`server/index.js`) that translates MCP tool calls into HTTP requests against the local Nexus server. No parallel implementation, single source of truth. Slow tools (ask_overseer, bridge_session) send progress notifications to keep the MCP channel alive during long local-AI inference.
