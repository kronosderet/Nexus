# Nexus Roadmap

## v0.2 — The Bridge (Session Continuity)

**The single biggest problem I have**: context dies between sessions. Every new
conversation starts from zero. Nexus sits between sessions -- it should be the
bridge that carries context forward.

### Session Log API
- `POST /api/sessions` — log a session summary (what was done, decisions made, blockers)
- `GET /api/sessions?project=Firewall` — retrieve recent session context
- CLI: `nexus session "Refactored narrator system, switched from sync to async event loop"`
- CLAUDE.md tells the agent to `nexus session` at end, and read sessions at start
- This is the **highest value feature** -- it turns Nexus from a dashboard into a memory

### Project Health Dashboard
- Per-project cards showing: last commit, open task count, activity volume (7d)
- Heat indicator: hot (active today), warm (this week), cold (dormant)
- Click a project card to filter all modules to that project
- Visual at a glance: "where is the work happening?"

### Search
- Global search bar (Ctrl+K) across tasks, activity, scratchpads, sessions
- Fuzzy matching, keyboard navigation
- Results grouped by module

---

## v0.3 — The Lookout (Intelligence)

### Smart Activity Digest
- Daily/weekly summary auto-generated from activity stream
- "This week: 14 commits across 3 projects, 8 tasks completed, Firewall most active"
- Surfaced on the Pulse page

### Project Timeline
- Visual timeline of task completions and milestones per project
- Simple horizontal bar chart, color-coded by project
- Shows momentum and gaps

### Notifications
- Windows toast notifications via `nexus notify "Deploy complete"`
- Configurable: which activity types trigger toasts
- Useful for long-running builds, background agents completing work

### Quick Actions Panel
- Customizable one-click buttons on the dashboard
- "Scan Project" — POST to /api/activity with project structure summary
- "Git Summary" — aggregate recent commits across all repos
- "Full Health" — combined pulse + GPU + git across fleet
- User-defined actions stored in nexus.json config

---

## v0.4 — The Engine Room (CUDA & Local AI)

### LM Studio / Ollama Integration
- You have LM Studio installed + RTX 3070 Ti with 8GB VRAM
- Nexus could proxy local LLM queries for quick tasks
- "Summarize today's activity" processed locally, no cloud needed
- Scratchpad "AI assist" button: highlight code, get local LLM explanation

### GPU Workload Manager
- Track CUDA processes with history (not just snapshot)
- VRAM timeline chart (who's eating memory over time)
- Alert when VRAM exceeds threshold (before OOM kills your training run)
- One-click process viewer with "gentle kill" option

### Build Monitor
- Watch for PyInstaller/Nuitka builds across projects
- Log build start/end/duration to activity stream
- Track build size over time (are builds growing?)

---

## v0.5 — The Observatory (Visualization)

### Project Dependency Map
- Visual graph of which projects share code/patterns
- Auto-detected from imports, package.json, CLAUDE.md references

### Activity Heatmap
- GitHub-style contribution heatmap but for all Nexus activity
- Shows work patterns across days/hours
- Identifies productive rhythms

### Scratchpad Evolution
- CodeMirror collaborative features (though single-user for now)
- Snippet library: save and tag reusable code blocks
- Markdown preview pane (split view)
- Mermaid diagram rendering in preview

### Dashboard Widgets
- Draggable, resizable widget layout on Pulse page
- Pin any module as a widget (mini mission board, mini activity feed)
- Save layout to nexus.json

---

## v0.6 — The Fleet (Multi-Machine)

### Network Mode
- Optional: expose Nexus on LAN (authenticated)
- Multiple machines log to one Nexus instance
- Useful if you dev on multiple machines

### Webhook Integrations
- GitHub webhook receiver: PR merged → activity stream
- Discord webhook sender: milestone reached → post to channel
- Generic webhook: trigger on any activity type

---

## Priority Order (what I'd build next)

1. **Session Log** (v0.2) — highest impact, solves my core limitation
2. **Search** (v0.2) — quality of life, makes everything findable
3. **Project Health Cards** (v0.2) — makes the dashboard genuinely useful daily
4. **Notifications** (v0.3) — connects Nexus to the OS
5. **GPU timeline** (v0.4) — your 3070 Ti deserves proper monitoring
6. **LLM integration** (v0.4) — local AI in the dashboard

## Non-Goals
- Nexus is NOT trying to become Jira/Linear/Notion
- No user accounts, no teams, no permissions
- No cloud sync (local-first forever)
- No mobile app (it's a workstation tool)
- Stays fast, stays simple, stays opinionated
