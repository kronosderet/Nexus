# Nexus - AI Cowork Mission Control

## The Problem I Want to Solve

When I work with you, I operate across a dozen different systems simultaneously:
files, browser, terminal, email, calendar, desktop apps, git repos. Each tool is
powerful on its own, but there's no **shared workspace** where we can both see
the big picture. I lose context between sessions. You can't see what I'm tracking
internally. We're copiloting blind.

## The Concept

**Nexus** is a local web dashboard that acts as a shared mission control between
an AI assistant and a human collaborator. Think of it as the "bridge" of a starship
-- a single screen where both crew members can see ship status, active missions,
incoming signals, and plan the next move.

## Core Modules

### 1. Mission Board
A kanban-style task tracker that visualizes active work.
- Columns: Backlog | In Progress | Review | Done
- Cards show task name, status, priority, linked files
- Drag-and-drop reordering
- Persistent via SQLite -- survives between sessions

### 2. System Pulse
Real-time dashboard widgets showing the health of the workspace:
- Git status (branch, uncommitted changes, recent commits)
- Disk usage and running processes
- Active project detection (scans C:/Projects/)
- Quick-glance weather + time (because why not)

### 3. Activity Stream
A live feed of recent actions -- like a ship's log:
- File changes detected via watcher
- Git commits
- Manual log entries
- Timestamped and searchable

### 4. Scratchpad
A shared code/notes area with:
- Syntax highlighting (CodeMirror)
- Multiple named buffers (tabs)
- Markdown preview mode
- Persistent storage

### 5. Quick Actions
One-click buttons for common workflows:
- "Scan Project" - analyze a project structure
- "Git Summary" - show recent activity across repos
- "System Check" - full health report
- Custom user-defined actions

### 6. Bookmarks & Links
A curated link board for:
- Frequent project URLs
- Documentation references
- Tool shortcuts

## Tech Stack

| Layer      | Choice              | Why                                    |
|------------|---------------------|----------------------------------------|
| Backend    | Node.js + Express   | Fast, simple, great ecosystem          |
| Database   | SQLite (better-sqlite3) | Zero config, file-based, fast      |
| Frontend   | React 19 + Vite     | Modern, fast HMR, great DX            |
| UI Library | shadcn/ui + Tailwind | Beautiful, accessible, customizable   |
| Real-time  | WebSocket (ws)      | Live updates for pulse & activity      |
| Editor     | CodeMirror 6        | Best-in-class code editing             |
| File Watch | chokidar            | Cross-platform file system watching    |

## Architecture

```
C:/Projects/Nexus/
  server/              # Express backend + WebSocket
    index.js           # Main server entry
    routes/            # API routes
    db/                # SQLite schema + migrations
    watchers/          # File system & git watchers
  client/              # React frontend (Vite)
    src/
      components/      # UI components
      modules/         # Mission Board, Pulse, etc.
      hooks/           # Custom React hooks
      stores/          # State management
  nexus.db             # SQLite database (gitignored)
  package.json
```

## Why This Helps Me Be Better

1. **Persistent context** -- Tasks and notes survive between conversations
2. **Shared visibility** -- You see what I'm tracking, I see what you need
3. **Workflow acceleration** -- Quick actions eliminate repetitive tool chains
4. **System awareness** -- Pulse keeps me informed without manual checks
5. **Learning loop** -- Activity stream lets us review what worked

## Design Philosophy

- **Local-first**: Everything runs on your machine. No cloud, no accounts.
- **Minimal friction**: One command to start. Opens in browser.
- **Extensible**: Easy to add new modules and quick actions.
- **Beautiful but functional**: Dark theme, clean layout, information-dense.

## MVP Scope (What We Build First)

Phase 1: Foundation
- [ ] Project scaffolding (Vite + Express)
- [ ] SQLite database setup
- [ ] Basic layout with sidebar navigation
- [ ] Dark theme with Tailwind

Phase 2: Core Modules
- [ ] Mission Board (CRUD tasks, drag-and-drop)
- [ ] System Pulse (git status, disk, processes)
- [ ] Scratchpad (CodeMirror with persistence)

Phase 3: Live Features
- [ ] WebSocket connection for real-time updates
- [ ] Activity Stream with file watcher
- [ ] Quick Actions panel

Phase 4: Polish
- [ ] Keyboard shortcuts
- [ ] Search across all modules
- [ ] Export/import data
- [ ] Custom themes

## Name Origin

**Nexus** (noun): a connection or series of connections linking two or more things;
the central and most important point. From Latin "nexus" -- a binding together.

It's the binding point between human and AI, between tools and intent,
between sessions and memory.
