# Nexus MCPB Extension

One-click install of the Nexus metabrain into Claude Desktop.

## What this gives you

After installing, every Claude Desktop conversation has access to native MCP tools:

- `mcp__nexus__brief` — current state for a project (fuel, tasks, sessions, decisions, risks)
- `mcp__nexus__get_plan` — AI-generated session plan with fuel context
- `mcp__nexus__check_guard` — redundancy check before starting work
- `mcp__nexus__record_decision` — write a strategic decision into The Ledger
- `mcp__nexus__push_thought` — push onto the interrupt-recovery stack
- `mcp__nexus__pop_thought` — pop the top thought (recover from interruption)

## Installation

Double-click `nexus.mcpb` and Claude Desktop will prompt you to install.

## Requirements

The Nexus HTTP server must be running locally. Start it with:

```bash
cd C:/Projects/Nexus
npm run dev:server
```

The MCPB defaults to `http://localhost:3001` but you can override `NEXUS_BASE_URL` during install if your server runs on a different port.

## Architecture

This bundle contains a thin stdio adapter (`server/index.js`) that translates MCP tool calls into HTTP requests against the local Nexus server. No parallel implementation, single source of truth.
