# ◈ Nexus

**The Cartographer — AI Cowork Mission Control**

A local-first workspace dashboard that turns scattered AI-assisted sessions into a navigable map: decisions, fuel, and code.

---

## What is Nexus?

Nexus is the operations bridge for working with AI agents across many projects at once. Where most chat tools forget what happened yesterday, Nexus remembers — every decision, every session, every gram of session fuel — and projects that history forward into the next move.

It is written end-to-end in TypeScript and React 19, runs entirely on your machine, and pairs a small dashboard UI with a 47-command CLI. There is nothing in the cloud. The only network call it ever makes is to the local language model loaded inside LM Studio.

The metaphor is navigation. Sessions are voyages. Decisions are bearings. Tasks are missions. The Overseer — the local Gemma model — is the lookout in the crow's nest. The whole thing speaks in compass icons and amber on navy because the captain deserves a proper bridge.

## Features

The dashboard ships with nine modules, each accessible via `Ctrl+1` through `Ctrl+9`:

- **Pulse** — system overview, GPU telemetry, recent activity
- **Fuel** — session and weekly Claude budget with rolling 5-hour windows
- **Graph** — knowledge graph of decisions with blast-radius, centrality, conflict detection, structural holes, and a force-directed visual view
- **Overseer** — the local AI strategist; ask it anything about your workspace
- **Missions** — Kanban board for tasks with priorities and links
- **Activity** — chronological feed of every meaningful event
- **Sessions** — voyage log; the bridge between agent runs
- **Bookmarks** — curated links grouped by category
- **Terminal** — embedded shell for the brave

## The Knowledge Graph

The Ledger holds every architectural decision Nexus has ever been told about — currently **76 decisions** wired together with **129 typed edges** (`led_to`, `replaced`, `depends_on`, `contradicts`, `related`). The Graph module visualizes that web and answers questions you cannot answer in a chat scrollback: *if I rip out SQLite, what breaks?* *which decisions are loadbearing?* *where are two projects making opposing bets?*

## The Overseer

The Overseer is Gemma 4 26B running locally inside LM Studio. It reads the dashboard's state — fuel, tasks, decisions, recent activity — and gives strategic answers in seconds, without sending a byte off the box. It also drives the AI-narrated impact forecast: feed it a decision id and it tells you, in three or four sentences, what would actually break if you reversed it.

## Smart Fuel Intelligence

Nexus tracks your Claude usage as a rolling 5-hour session window with a separate weekly cap. The Fuel module estimates remaining minutes from observed burn rate, predicts the empty-time, and the Workload Planner translates "you have 35% session fuel and 4h on the clock" into concrete task slots: how many small refactors, how many big features, how many code reviews fit before reset.

## Quick Start

```bash
git clone https://github.com/kronosderet/Nexus
cd Nexus
npm install && cd server && npm install && cd ../client && npm install && cd ..
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

The server runs on `:3001`, the Vite dev server on `:5173`, and the WebSocket bridge piggybacks on the API port.

## CLI Commands

The `nexus` CLI ships with **47 commands** — log activity, create tasks, record decisions, forecast impact, or talk to the Overseer from any project directory. Run `nexus help` for the full list, or `nexus onboard` to generate complete agent-facing documentation.

```bash
nexus brief                       # full agent briefing
nexus task "Add caching layer"    # create a backlog task
nexus record "Switched to JSON"   # record a decision
nexus impact forecast 44          # AI-narrated downstream impact
nexus overseer "what should I do next?"
```

## Architecture

| Layer    | Stack                                       |
| -------- | ------------------------------------------- |
| Server   | Express 5 + TypeScript (tsx watch runtime)  |
| Client   | React 19 + Vite + Tailwind CSS 4            |
| Store    | JSON file (`nexus.json`)                    |
| AI       | LM Studio + Gemma 4 26B (Anthropic API)     |
| Tests    | 114 Vitest tests                            |
| CLI      | Pure Node, zero dependencies                |

## Built In 2 Nights

Nexus was built from scratch in two sessions. The first night went from `npm init` to v1.0 — Pulse, Missions, Activity, Sessions, the CLI, the WebSocket bridge, the JSON store. The second night the Overseer came online and started directing its own development: from v0.7 onward, every architectural decision was first run past Gemma, recorded in The Ledger, and then implemented.

That recursion is the real story. The dashboard that tracks decisions was built by an AI making decisions about itself. Forty-seven plus commits, version history climbing from `v0.1` to `v1.0` on night one and `v1.1` to `v3.0-alpha2` on night two.

## The Cartographer Personality

Nexus speaks like a navigator on a long voyage. The brand mark is the compass rose `◈`. The palette is amber on navy — the warm glow of an instrument panel against a cold sea. Empty states say things like "Nothing on the charts." Loading messages say "Setting course." It is a small thing, but it is the difference between a tool you use and a bridge you stand on.

## License

MIT — see [LICENSE](./LICENSE).
