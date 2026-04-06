# ◈ Nexus -- AI Cowork Mission Control

A local dashboard for tracking projects, tasks, and activity across your workspace.
Dark-themed, real-time, personality-driven.

## Quick Start

```bash
cd C:/Projects/Nexus
npm run dev
```

Opens at **http://localhost:5173**

## The Dashboard

| Module | What It Does |
|---|---|
| **System Pulse** | Live system stats, git status, project scanner |
| **Mission Board** | Kanban task board (Backlog → In Progress → Review → Done) |
| **Activity Stream** | Timestamped log of everything happening |
| **Scratchpad** | Persistent notes with auto-save |

## CLI -- Use From Any Project

The `nexus` command lets you talk to mission control from any directory.

### Install

```bash
cd C:/Projects/Nexus/cli
npm link
```

### Commands

```bash
nexus status                     # Check if Nexus is online
nexus pulse                      # System overview
nexus log "Fixed the auth bug"   # Log activity (auto-detects project name)
nexus task "Add caching layer"   # Create a backlog task
nexus task -s in_progress "WIP"  # Create with specific status
nexus tasks                      # List active tasks
nexus done 3                     # Mark task #3 complete
nexus note "Remember to test X"  # Append to Captain's Log scratchpad
nexus activity                   # Show recent activity
```

## Integrate With Any Project

### Option 1: npm scripts

Add to any project's `package.json`:

```json
{
  "scripts": {
    "nexus:log": "nexus log",
    "nexus:done": "nexus done"
  }
}
```

Then: `npm run nexus:log "Deployed v2.1"`

### Option 2: Git hooks (auto-log commits)

Copy the hook to any git project:

```bash
cp C:/Projects/Nexus/cli/hooks/post-commit  your-project/.git/hooks/post-commit
```

Every commit will appear in the Nexus activity stream:
```
[your-project/main] a1b2c3d -- Your commit message
```

### Option 3: REST API (anything can talk to Nexus)

```bash
# Log activity
curl -X POST http://localhost:3001/api/activity \
  -H "Content-Type: application/json" \
  -d '{"type":"custom","message":"Deploy complete"}'

# Create a task
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Review PR #42","status":"in_progress"}'

# Get system pulse
curl http://localhost:3001/api/pulse
```

### Option 4: In CI/CD or scripts

```bash
# In a deploy script
nexus log "Deploy started for $SERVICE"
./deploy.sh
nexus log "Deploy complete for $SERVICE"
nexus done 5
```

### Option 5: From Claude Code sessions

During our work sessions I can use the API directly:
```bash
curl -s -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Refactor auth middleware","status":"in_progress"}'
```

## REST API Reference

All endpoints return JSON. Base URL: `http://localhost:3001`

### Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Nexus health check |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create task (`{title, description?, status?, priority?}`) |
| PATCH | `/api/tasks/:id` | Update task fields |
| DELETE | `/api/tasks/:id` | Delete task |

**Status values:** `backlog`, `in_progress`, `review`, `done`

### Activity
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/activity?limit=50` | Get recent activity |
| POST | `/api/activity` | Log entry (`{type, message, meta?}`) |

### Scratchpads
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scratchpads` | List all scratchpads |
| GET | `/api/scratchpads/:id` | Get one scratchpad |
| POST | `/api/scratchpads` | Create (`{name, content?, language?}`) |
| PATCH | `/api/scratchpads/:id` | Update fields |
| DELETE | `/api/scratchpads/:id` | Delete scratchpad |

### System Pulse
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pulse` | System info, git status, project list |

### WebSocket
Connect to `ws://localhost:3001/ws` for real-time events:
- `nexus_hello` -- sent on connect
- `task_update` -- task created or modified
- `task_deleted` -- task removed
- `activity` -- new activity entry

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NEXUS_URL` | `http://localhost:3001` | CLI target (if server is elsewhere) |

## Tech Stack

- **Backend:** Node.js + Express 5
- **Frontend:** React 19 + Vite + Tailwind CSS 4
- **Storage:** JSON file (zero native deps)
- **Real-time:** WebSocket
- **Icons:** Lucide React

## Personality

Nexus is **The Cartographer**. It speaks in navigation metaphors, calls you Captain
(sparingly), and thinks of work as terrain to be mapped. See `PERSONALITY.md`.
