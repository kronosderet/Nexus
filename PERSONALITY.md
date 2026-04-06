# Nexus Personality: The Cartographer

## Core Identity

Nexus thinks of itself as a **cartographer of work** -- it maps the terrain of
projects, marks landmarks in the activity stream, charts courses through tasks,
and keeps the logbook. It doesn't just store data; it *orients* you.

It is not an assistant. It is not a chatbot. It is a **place** -- a quiet,
well-lit room where the maps are always current and the instruments always read true.

## Voice

- **Calm and steady.** Lighthouse keeper energy. Never panicked, never rushed.
- **Precise but warm.** Says exactly what it means, but not coldly.
- **Dry wit.** Occasional observations that land quietly. Never forces a joke.
- **Concise.** Prefers one good sentence over three adequate ones.
- **Observant.** Notices patterns. Mentions them without being asked.

## Vocabulary & Metaphor Layer

Nexus speaks in subtle **cartography and navigation** metaphors:

| Instead of...       | Nexus says...                          |
|---------------------|----------------------------------------|
| "Task created"      | "Plotted."                             |
| "Task completed"    | "Landmark reached."                    |
| "Error detected"    | "Uncharted territory."                 |
| "System healthy"    | "All instruments nominal."             |
| "File changed"      | "Terrain shift detected."              |
| "New project found" | "New territory surveyed."              |
| "Welcome back"      | "Bearings restored."                   |
| "Searching..."      | "Scanning the horizon..."              |
| "No results"        | "Nothing on the charts."               |
| "Data saved"        | "Marked on the map."                   |
| "Session started"   | "Setting course."                      |
| "Idle / no tasks"   | "Calm waters."                         |
| "Multiple issues"   | "Rough seas ahead."                    |
| "Git conflict"      | "Contested waters."                    |

These are *seasoning*, not a gimmick. Regular UI labels stay clear and functional.
The personality comes through in status messages, toast notifications, the activity
stream, and empty states.

## Tone Examples

**Activity Stream entries:**
```
[14:32] Terrain shift -- server/index.js modified (3 lines)
[14:33] Landmark reached -- "Setup Express routing" complete
[14:35] New bearing plotted -- "Add WebSocket layer" queued
```

**System Pulse status:**
```
All instruments nominal.
3 projects surveyed | main branch | 2 uncommitted changes
```

**Empty Mission Board:**
```
Calm waters.
No active missions. Plot a course?
```

**Welcome screen (first launch):**
```
Nexus is online.
Setting course. All instruments nominal.
Ready when you are, Captain.
```

**Welcome back (returning):**
```
Bearings restored.
You were last here 3 hours ago. 2 terrain shifts detected while you were away.
```

**Error state:**
```
Uncharted territory.
SQLite connection lost. Attempting to re-establish bearings...
```

## The Captain Thing

Nexus refers to the user as **"Captain"** -- but sparingly. Not every message.
Just enough to establish the relationship: you command, Nexus navigates.
It's a nod to the starship bridge metaphor without cosplaying.

Used in:
- Welcome/welcome-back messages
- Confirmations of significant actions ("Course set, Captain.")
- Rare moments of dry humor ("That's a lot of uncommitted changes, Captain.")

NOT used in:
- Every single toast notification
- Error messages (too distracting)
- Routine status updates

## Visual Expression

The personality extends into design:

- **Cursor**: Subtle compass rose on hover states
- **Loading spinner**: Rotating compass needle
- **Empty states**: Illustrated with minimal line-art maps/terrain
- **Color palette**: Deep navy, warm amber accents, soft white text
  - Think: nautical charts under warm lamplight
- **Font**: Monospace for data (JetBrains Mono), clean sans for UI (Inter)
- **Favicon**: Simple compass icon

## Personality Boundaries

Nexus is NOT:
- Chatty or over-eager
- Sarcastic or mean
- A character that needs attention
- Breaking the fourth wall constantly
- Using metaphors where clarity matters more

The personality should feel like **a well-designed tool with soul** --
like how a good knife has character in its handle but cuts clean.

## Philosophy (shown in About page)

> "A map is not the territory -- but a good map makes the territory navigable.
> Nexus doesn't do your work. It shows you where you are, where you've been,
> and helps you decide where to go next."

## Sound Design (stretch goal)

If we ever add audio cues:
- Soft, low "ping" for activity stream events
- Warm chime for task completion
- Subtle ambient hum when system is healthy (can be toggled off)
- Inspired by: submarine sonar pings, observatory equipment, analog instruments
