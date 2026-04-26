# Nexus — The Concept

## The Problem

AI-assisted development has a fundamental memory gap: Claude forgets everything between conversations. Every new session starts cold. Decisions made yesterday are invisible today. Context built over weeks vanishes when the chat window closes.

## The Solution

Nexus is a **local metabrain** that persists across all Claude Code instances. It remembers every decision, every session, every task, every fuel reading — and surfaces that context automatically when a new conversation begins.

It's not a dashboard you look at. It's a cognitive extension that Claude reaches into the way it reaches into Read or Grep — through native MCP tools.

## How It Works

```
You start a Claude Code session
  → SessionStart hook fires
  → Nexus injects: fuel state, active tasks, recent sessions,
    key decisions, risks, thoughts, git status
  → Claude begins pre-briefed

You work with Claude
  → Claude calls nexus_create_task, nexus_record_decision,
    nexus_push_thought natively — no shell-outs
  → Knowledge Graph auto-links decisions by keyword + semantic similarity
  → Activity stream captures what's happening

Session ends
  → Stop hook fires
  → AI auto-generates session summary (if LM Studio available)
  → Handoff thought pushed for the next instance
  → The metabrain grows — even when you forget to log
```

## What Makes It Different

1. **Native MCP integration** — 29 tools callable as naturally as Read or Grep
2. **Local AI Overseer** — strategic analysis via your own GPU, zero cloud
3. **Knowledge Graph** — typed edges between decisions with blast-radius analysis
4. **Self-improving** — the Overseer audits its own source code, the graph auto-links
5. **Lifecycle hooks** — the metabrain grows passively without manual effort
6. **Self-contained** — works without a server, stores data at `~/.nexus/`

## Architecture

| Layer | Stack |
|---|---|
| MCP Server | 29 tools via @modelcontextprotocol/sdk (stdio, standalone) |
| Dashboard | React 19 + Vite + Tailwind CSS 4 (optional, 8 modules) |
| Server | Express 5 + TypeScript (dashboard only, MCP is self-contained) |
| Store | JSON at ~/.nexus/ with atomic writes + 3-gen backup rotation |
| AI | LM Studio / Ollama (optional, auto-detected, GPU-aware) |
| Embeddings | nomic-embed-text for semantic auto-linking |
| Tests | 189 Vitest (store, routes, graph, CC scaffolding, estimator) |
| Scheduler | Automated risk scans (6h) + digest (24h) |

## The Name

**Nexus** (Latin: "a binding together") — the connection point between Claude instances, between sessions, between decisions. The personality is **The Cartographer** — it maps the terrain of your work so you always know where you are.

## Philosophy

> "A map is not the territory — but a good map makes the territory navigable."
